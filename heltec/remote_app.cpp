#include "remote_app.h"

// Core includes
#include "lib/core_config.h"
#include "lib/core_system.h"
#include "lib/core_scheduler.h"
#include "lib/core_logger.h"

// HAL includes
#include "lib/hal_display.h"
#include "lib/hal_lorawan.h"
#include "lib/hal_battery.h"
#include "lib/hal_persistence.h"

// Service includes
#include "lib/svc_ui.h"
#include "lib/svc_comms.h"
#include "lib/svc_battery.h"
#include "lib/svc_lorawan.h"

// Config and sensors
#include "remote_sensor_config.h"
#include "config.h"
#include "sensor_interface.hpp"
#include "sensor_implementations.hpp"

// UI includes
#include "lib/ui_battery_icon_element.h"
#include "lib/ui_header_status_element.h"
#include "lib/ui_main_content_layout.h"
#include "lib/ui_screen_layout.h"
#include "lib/ui_top_bar_layout.h"
#include "lib/ui_text_element.h"
#include "lib/ui_icon_element.h"


class RemoteApplicationImpl {
public:
    RemoteApplicationImpl();
    void initialize();
    void run();

private:
    // Configuration must be initialized first
    RemoteConfig config;
    RemoteSensorConfig sensorConfig;

    CoreSystem coreSystem;
    CoreScheduler scheduler;
    CommonAppState appState;

    // HALs
    std::unique_ptr<IDisplayHal> displayHal;
    std::unique_ptr<ILoRaWANHal> lorawanHal;
    std::unique_ptr<IBatteryHal> batteryHal;
    std::unique_ptr<IPersistenceHal> persistenceHal;

    // Services
    std::unique_ptr<UiService> uiService;
    std::unique_ptr<CommsService> commsService;
    std::unique_ptr<IBatteryService> batteryService;
    std::unique_ptr<ILoRaWANService> lorawanService;

    // Sensors
    SensorManager sensorManager;
    std::unique_ptr<LoRaWANTransmitter> lorawanTransmitter;
    std::shared_ptr<YFS201WaterFlowSensor> waterFlowSensor;

    // UI Elements must be stored to manage their lifetime
    std::vector<std::shared_ptr<UIElement>> uiElements;
    std::shared_ptr<TextElement> idElement;
    std::shared_ptr<HeaderStatusElement> lorawanStatusElement;
    std::shared_ptr<BatteryIconElement> batteryElement;
    std::shared_ptr<TextElement> statusTextElement;

    // State tracking
    uint32_t _errorCount = 0;
    uint32_t _lastResetMs = 0;
    uint32_t _lastTxMs = 0;

    // LoRaWAN downlink command handler
    void onDownlinkReceived(uint8_t port, const uint8_t* payload, uint8_t length);
    static void staticOnDownlinkReceived(uint8_t port, const uint8_t* payload, uint8_t length);
    static RemoteApplicationImpl* callbackInstance;

    void setupUi();
    void setupSensors();
};

RemoteApplicationImpl* RemoteApplicationImpl::callbackInstance = nullptr;

RemoteApplicationImpl::RemoteApplicationImpl() :
    config(buildRemoteConfig()),
    sensorConfig(buildRemoteSensorConfig()) {
    callbackInstance = this;
}

void RemoteApplicationImpl::initialize() {
    // ---
    // Critical: HALs must be created FIRST
    // ---
    persistenceHal = std::make_unique<FlashPersistenceHal>();

    coreSystem.init(config);

    // Initialize display immediately after hardware setup to minimize delay
    LOGI("Remote", "Creating display HAL");
    displayHal = std::make_unique<OledDisplayHal>();
    displayHal->begin();
    LOGI("Remote", "Display initialized");
    
    // Create UI service and show splash screen immediately
    uiService = std::make_unique<UiService>(*displayHal);
    uiService->init();
    LOGI("Remote", "UI service initialized - splash screen shown");

    if (config.globalDebugMode) {
        Logger::setLevel(Logger::Level::Debug);
        LOGD("System", "Debug mode is ON. Log level set to DEBUG.");
    }

    // Load persistent state
    persistenceHal->begin("app_state");
    _errorCount = persistenceHal->loadU32("errorCount", 0);
    _lastResetMs = persistenceHal->loadU32("lastResetMs", 0);
    persistenceHal->end();

    LOGI("Remote", "Creating remaining HALs");
    lorawanHal = std::make_unique<LoRaWANHal>();
    batteryHal = std::make_unique<BatteryMonitorHal>(config.battery);

    LOGI("Remote", "Creating services");
    commsService = std::make_unique<CommsService>();
    commsService->setLoRaWANHal(lorawanHal.get());
    batteryService = std::make_unique<BatteryService>(*batteryHal);
    lorawanService = std::make_unique<LoRaWANService>(*lorawanHal);

    // Derive DevEUI from chip ID
    uint8_t devEui[8];
    getDevEuiFromChipId(devEui);
    
    LOGI("Remote", "DevEUI derived from chip ID: %02X:%02X:%02X:%02X:%02X:%02X:%02X:%02X",
         devEui[0], devEui[1], devEui[2], devEui[3],
         devEui[4], devEui[5], devEui[6], devEui[7]);

    // Initialize LoRaWAN with derived DevEUI and shared credentials
    lorawanHal->begin(devEui, 
                      config.communication.lorawan.appEui, 
                      config.communication.lorawan.appKey);
    LOGI("Remote", "LoRaWAN HAL initialized");

    // Configure LoRaWAN settings
    lorawanHal->setAdr(config.communication.lorawan.adrEnabled);
    lorawanHal->setDeviceClass(config.communication.lorawan.deviceClass);
    // Set initial data rate (before ADR takes over, ensures we can send payloads)
    // Ensure data rate is at least the configured minimum
    uint8_t dataRate = config.communication.lorawan.dataRate;
    if (dataRate < config.communication.lorawan.minDataRate) {
        LOGI("Remote", "Data rate %d below minimum %d, using minimum", dataRate, config.communication.lorawan.minDataRate);
        dataRate = config.communication.lorawan.minDataRate;
    }
    lorawanHal->setDataRate(dataRate);
    lorawanHal->setTxPower(config.communication.lorawan.txPower);
    
    // Set up downlink callback for commands
    lorawanHal->setOnDataReceived(&RemoteApplicationImpl::staticOnDownlinkReceived);

    setupUi();
    LOGI("Remote", "UI setup complete");

    setupSensors();
    LOGI("Remote", "Sensors setup complete");

    // Register scheduler tasks
    LOGI("Remote", "Registering scheduler tasks");
    
    // Heartbeat task
    scheduler.registerTask("heartbeat", [this](CommonAppState& state){
        state.heartbeatOn = !state.heartbeatOn;
    }, config.heartbeatIntervalMs);
    
    // Battery monitoring task
    scheduler.registerTask("battery", [this](CommonAppState& state){
        batteryService->update(state.nowMs);
    }, 1000);
    
    // Persistence task for water flow sensor
    if (sensorConfig.enableSensorSystem && sensorConfig.waterFlowConfig.enabled) {
        scheduler.registerTask("persistence", [this](CommonAppState& state){
            if (waterFlowSensor) {
                waterFlowSensor->saveTotalVolume();
            }
        }, 60000); // Save volume every minute
    }
    
    // Display update task
    scheduler.registerTask("display", [this](CommonAppState& state){
        uiService->tick();
    }, config.displayUpdateIntervalMs);
    
    // LoRaWAN service task - processes radio IRQs and state machine
    scheduler.registerTask("lorawan", [this](CommonAppState& state){
        lorawanService->update(state.nowMs);
        
        // Update UI elements with connection state
        auto connectionState = lorawanService->getConnectionState();
        bool isConnected = lorawanService->isJoined();
        lorawanStatusElement->setLoraStatus(isConnected, lorawanService->getLastRssiDbm());
        batteryElement->setStatus(batteryService->getBatteryPercent(), batteryService->isCharging());

        // Update main status text
        if (statusTextElement) {
            char statusStr[48];
            const char* connStr = isConnected ? "Joined" : 
                                  (connectionState == ILoRaWANService::ConnectionState::Connecting ? "Joining..." : "Offline");
            snprintf(statusStr, sizeof(statusStr), "%s\nUp:%lu Dn:%lu\nErr:%u", 
                     connStr,
                     lorawanService->getUplinkCount(),
                     lorawanService->getDownlinkCount(),
                     _errorCount);
            statusTextElement->setText(statusStr);
        }
    }, 50);
    
    // Debug task for water flow sensor interrupts
    if (config.globalDebugMode) {
        scheduler.registerTask("interrupt_debug", [](CommonAppState& state){
            if (YFS201WaterFlowSensor::getAndClearInterruptFlag()) {
                LOGD("Interrupt", "Water flow pulse detected!");
            }
        }, 10);
    }
    
    // Sensor telemetry transmission task
    if (sensorConfig.enableSensorSystem) {
        // Transmission task: pulls fresh data and transmits
        scheduler.registerTask("lorawan_tx", [this](CommonAppState& state){
            // Caller checks connection
            if (!lorawanService->isJoined()) return;
            
            // Caller collects fresh data from services
            std::vector<SensorReading> readings;
            
            // Water flow (atomic read, no data loss)
            if (waterFlowSensor) {
                waterFlowSensor->read(readings);
            }
            
            // Battery (cached state, always current)
            readings.push_back({
                TelemetryKeys::BatteryPercent,
                (float)batteryService->getBatteryPercent(),
                state.nowMs
            });
            
            // System state
            readings.push_back({
                TelemetryKeys::ErrorCount,
                (float)_errorCount,
                state.nowMs
            });
            uint32_t timeSinceResetSec = (state.nowMs - _lastResetMs) / 1000;
            readings.push_back({
                TelemetryKeys::TimeSinceReset,
                (float)timeSinceResetSec,
                state.nowMs
            });
            
            // Pure helper: format and transmit
            if (lorawanTransmitter && !readings.empty()) {
                bool success = lorawanTransmitter->transmit(readings);
                if (!success) {
                    LOGW("Remote", "Transmission failed, will retry on next interval");
                }
            }
        }, config.communication.lorawan.txIntervalMs);
    }
    
    // LoRaWAN rejoin watchdog - attempt rejoin if not connected for too long
    scheduler.registerTask("lorawan_watchdog", [this](CommonAppState& state){
        if (!lorawanService->isJoined() && !lorawanService->isJoinInProgress()) {
            LOGW("Remote", "Watchdog: Not joined to network, attempting rejoin...");
            lorawanService->forceReconnect();
        } else if (lorawanService->isJoinInProgress()) {
            LOGD("Remote", "Watchdog: Join already in progress, skipping");
        }
    }, 60000); // Check every minute

    // LoRaWAN join task - runs after scheduler starts to allow display updates during join
    scheduler.registerTask("lorawan_join", [this](CommonAppState& state){
        static bool joinAttempted = false;
        if (!joinAttempted && !lorawanHal->isJoined()) {
            joinAttempted = true;
            LOGI("Remote", "Starting LoRaWAN OTAA join...");
            lorawanHal->join();
        }
    }, 100); // Short interval for initial join attempt

    LOGI("Remote", "Starting scheduler");
    scheduler.start(appState);
    LOGI("Remote", "Scheduler started, initialization complete");
}

void RemoteApplicationImpl::setupUi() {
    auto& layout = uiService->getLayout();
    auto& topBar = layout.getTopBar();
    auto& mainContent = layout.getMainContent();

    // -- Top Bar --
    // [Device ID] [Battery] [LoRaWAN Status]
    idElement = std::make_shared<TextElement>();
    idElement->setText(String("ID: ") + String(config.deviceId, HEX));
    uiElements.push_back(idElement);
    topBar.setColumn(TopBarColumn::DeviceId, idElement.get());

    batteryElement = std::make_shared<BatteryIconElement>();
    uiElements.push_back(batteryElement);
    topBar.setColumn(TopBarColumn::Battery, batteryElement.get());

    // LoRaWAN status in Network column
    lorawanStatusElement = std::make_shared<HeaderStatusElement>();
    lorawanStatusElement->setMode(HeaderStatusElement::Mode::Lora);
    uiElements.push_back(lorawanStatusElement);
    topBar.setColumn(TopBarColumn::Network, lorawanStatusElement.get());

    // -- Main Content --
    // [Small Logo] [Status Text]
    mainContent.setLeftColumnWidth(logo_small_width + 8);
    auto mainLogoElement = std::make_shared<IconElement>(logo_small_bits, logo_small_width, logo_small_height);
    uiElements.push_back(mainLogoElement);
    mainContent.setLeft(mainLogoElement.get());

    statusTextElement = std::make_shared<TextElement>("Initializing...");
    uiElements.push_back(statusTextElement);
    mainContent.setRight(statusTextElement.get());
}

void RemoteApplicationImpl::setupSensors() {
    if (!sensorConfig.enableSensorSystem) {
        return;
    }

    // Create LoRaWAN transmitter with service and HAL references
    auto transmitter = std::make_unique<LoRaWANTransmitter>(lorawanService.get(), lorawanHal.get(), config);
    lorawanTransmitter = std::move(transmitter);

    // --- Sensor Creation ---
    auto batterySensor = SensorFactory::createBatteryMonitorSensor(
        batteryService.get(),
        sensorConfig.batteryConfig.enabled
    );
    sensorManager.addSensor(batterySensor);

    waterFlowSensor = SensorFactory::createYFS201WaterFlowSensor(
        sensorConfig.pins.waterFlow,
        sensorConfig.waterFlowConfig.enabled,
        persistenceHal.get(),
        "water_meter"
    );
    sensorManager.addSensor(waterFlowSensor);
}

void RemoteApplicationImpl::run() {
    // Main run loop - high-frequency, non-blocking tasks
    // The main application logic is handled by the scheduler
    delay(1);
}

// LoRaWAN downlink command handler - routed by port
void RemoteApplicationImpl::onDownlinkReceived(uint8_t port, const uint8_t* payload, uint8_t length) {
    LOGI("Remote", "Downlink received on port %d, length %d", port, length);

    // Port-based command routing per migration plan
    switch (port) {
        case 10:  // Reset water volume
            LOGI("Remote", "Received ResetWaterVolume command via port 10");
            if (waterFlowSensor) {
                waterFlowSensor->resetTotalVolume();
            }
            lorawanService->resetCounters();
            Messaging::Message::resetSequenceId();
            
            // Reset error counter and record reset time
            _errorCount = 0;
            _lastResetMs = millis();
            persistenceHal->begin("app_state");
            persistenceHal->saveU32("errorCount", _errorCount);
            persistenceHal->saveU32("lastResetMs", _lastResetMs);
            persistenceHal->end();
            break;

        case 11:  // Set reporting interval
            if (length >= 4) {
                uint32_t interval = (payload[0] << 24) | (payload[1] << 16) | 
                                   (payload[2] << 8) | payload[3];
                LOGI("Remote", "Set reporting interval to %u ms", interval);
                // Note: Dynamic interval change would require scheduler modification
            }
            break;

        case 12:  // Reboot device
            LOGI("Remote", "Reboot command received");
            delay(100);
            ESP.restart();
            break;

        default:
            LOGD("Remote", "Unknown command port: %d", port);
            break;
    }
}

void RemoteApplicationImpl::staticOnDownlinkReceived(uint8_t port, const uint8_t* payload, uint8_t length) {
    if (callbackInstance) {
        callbackInstance->onDownlinkReceived(port, payload, length);
    }
}

// PIMPL Implementation
RemoteApplication::RemoteApplication() : impl(new RemoteApplicationImpl()) {}
RemoteApplication::~RemoteApplication() { delete impl; }
void RemoteApplication::initialize() { impl->initialize(); }
void RemoteApplication::run() { impl->run(); }

// Force the Arduino build system to compile these implementation files
#include "lib/core_config.cpp"
#include "lib/core_system.cpp"
#include "lib/core_scheduler.cpp"
#include "lib/svc_ui.cpp"
#include "lib/svc_comms.cpp"
#include "lib/svc_battery.cpp"
#include "lib/svc_lorawan.cpp"
#include "lib/hal_lorawan.cpp"
#include "lib/ui_battery_icon_element.cpp"
#include "lib/ui_header_status_element.cpp"
#include "lib/ui_main_content_layout.cpp"
#include "lib/ui_screen_layout.cpp"
#include "lib/ui_top_bar_layout.cpp"
#include "sensor_implementations.hpp"
