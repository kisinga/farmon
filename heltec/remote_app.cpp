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
    bool _registrationSent = false;  // Track if registration message has been sent after join
    bool _registrationPending = false;  // Flag to trigger registration from main loop (avoid stack overflow)

    // Test mode state
    float _testDistance = 100.0;
    float _testVolume = 1000.0;

    // Message protocol methods (Phase 4: Device-centric framework)
    void sendRegistration();      // Send device registration on join (fPort 1)
    void sendTelemetryJson(const std::vector<SensorReading>& readings);  // Send telemetry as JSON (fPort 2)
    void sendCommandAck(uint8_t cmdPort, bool success);  // Send command ACK (fPort 4)

    // LoRaWAN downlink command handler
    void onDownlinkReceived(uint8_t port, const uint8_t* payload, uint8_t length);
    static void staticOnDownlinkReceived(uint8_t port, const uint8_t* payload, uint8_t length);
    static RemoteApplicationImpl* callbackInstance;

    void setupUi();
    void setupSensors();
    void generateTestData(std::vector<SensorReading>& readings, uint32_t nowMs);
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

        // Send registration message after first successful join
        // This implements Phase 4 device-centric protocol: device announces its capabilities
        // Note: Set flag here, actual send deferred to run() to avoid stack overflow in scheduler task
        if (isConnected && !_registrationSent && !_registrationPending) {
            LOGI("Remote", "Device joined network - scheduling registration message");
            _registrationPending = true;
        }

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
        // Transmission task: pulls fresh data and transmits as JSON (Phase 4 protocol)
        scheduler.registerTask("lorawan_tx", [this](CommonAppState& state){
            // Caller checks connection
            if (!lorawanService->isJoined()) return;

            // Caller collects fresh data from services
            std::vector<SensorReading> readings;

            if (config.testModeEnabled) {
                // Generate random test data
                generateTestData(readings, state.nowMs);
            } else {
                // Use real sensor data
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
            }

            // Send telemetry as JSON on fPort 2 (Phase 4 protocol)
            if (!readings.empty()) {
                sendTelemetryJson(readings);
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

    // Handle deferred registration (sent from main loop to avoid stack overflow in scheduler tasks)
    if (_registrationPending) {
        _registrationPending = false;
        _registrationSent = true;  // Set BEFORE sending to prevent re-entry during TX
        LOGI("Remote", "Sending registration message from main loop");
        sendRegistration();
    }

    delay(1);
}

void RemoteApplicationImpl::generateTestData(std::vector<SensorReading>& readings, uint32_t nowMs) {
    // Random distance reading (50-200cm for water level)
    _testDistance += random(-10, 10) / 10.0;
    if (_testDistance < 50) _testDistance = 50;
    if (_testDistance > 200) _testDistance = 200;
    readings.push_back({"pd", _testDistance, nowMs});

    // Random total volume (increasing slowly)
    _testVolume += random(0, 50) / 10.0;  // Add 0-5 liters each reading
    readings.push_back({"tv", _testVolume, nowMs});

    // Random battery (70-100%)
    float testBattery = random(70, 100);
    readings.push_back({"bp", testBattery, nowMs});

    // Error count (usually 0)
    readings.push_back({"ec", 0.0f, nowMs});

    // Time since reset
    uint32_t timeSinceResetSec = (nowMs - _lastResetMs) / 1000;
    readings.push_back({"tsr", (float)timeSinceResetSec, nowMs});

    LOGI("TestMode", "Generated test data: distance=%.1fcm, volume=%.1fL, battery=%.0f%%",
         _testDistance, _testVolume, testBattery);
}

// =============================================================================
// Message Protocol Implementation (Phase 4: Device-centric framework)
// =============================================================================
// Uses simple text format instead of JSON to minimize stack usage.
// Format is parsed by Node-RED backend which can handle both JSON and text.

void RemoteApplicationImpl::sendRegistration() {
    // Simple text registration format (parsed by ChirpStack codec → Node-RED):
    // v=1|type=water_monitor|fw=2.0.0|fields=bp:Battery:%:0:100,...|states=ps:PumpState:off;on|cmds=reset:10,...
    // - fields: continuous sensors (key:name:unit:min:max)
    // - states: controllable fields (key:name:val1;val2;...) - semicolon separates enum values
    // - cmds: downlink commands (key:port)
    char buffer[256];
    int len = snprintf(buffer, sizeof(buffer),
        "v=1|type=%s|fw=%s|fields=bp:Battery:%%:0:100,pd:PulseDelta,tv:TotalVolume:L,ec:ErrorCount|states=ps:PumpState:off;on|cmds=reset:10,interval:11,reboot:12",
        DEVICE_TYPE, FIRMWARE_VERSION);

    if (len < 0 || len >= (int)sizeof(buffer)) {
        LOGW("Remote", "Registration message truncated");
        len = sizeof(buffer) - 1;
    }

    LOGI("Remote", "Sending registration (%d bytes) on fPort %d", len, FPORT_REGISTRATION);
    LOGD("Remote", "Registration: %s", buffer);

    bool success = lorawanService->sendData(FPORT_REGISTRATION, (const uint8_t*)buffer, len, false);
    if (success) {
        LOGI("Remote", "Registration sent successfully");
    } else {
        LOGW("Remote", "Failed to send registration");
    }
}

void RemoteApplicationImpl::sendTelemetryJson(const std::vector<SensorReading>& readings) {
    if (readings.empty()) {
        LOGW("Remote", "No readings to send");
        return;
    }

    // Simple key:value format (same as original CSV but on fPort 2)
    // Example: bp:85,pd:42,tv:1234.56,ec:0,tsr:3600
    char buffer[128];
    int offset = 0;

    for (size_t i = 0; i < readings.size() && offset < (int)sizeof(buffer) - 20; ++i) {
        if (isnan(readings[i].value)) continue;

        if (offset > 0) {
            buffer[offset++] = ',';
        }

        // Use integer for counters, 2 decimal places for floats
        if (strcmp(readings[i].type, "pd") == 0 ||
            strcmp(readings[i].type, "bp") == 0 ||
            strcmp(readings[i].type, "ec") == 0 ||
            strcmp(readings[i].type, "tsr") == 0) {
            offset += snprintf(buffer + offset, sizeof(buffer) - offset,
                              "%s:%d", readings[i].type, (int)readings[i].value);
        } else {
            offset += snprintf(buffer + offset, sizeof(buffer) - offset,
                              "%s:%.2f", readings[i].type, readings[i].value);
        }
    }

    if (offset == 0) {
        LOGW("Remote", "No valid readings to send");
        return;
    }

    LOGD("Remote", "Sending telemetry (%d bytes) on fPort %d: %s", offset, FPORT_TELEMETRY, buffer);

    bool success = lorawanService->sendData(FPORT_TELEMETRY, (const uint8_t*)buffer, offset,
                                            config.communication.lorawan.useConfirmedUplinks);
    if (success) {
        LOGI("Remote", "Telemetry sent: %d bytes on fPort %d", offset, FPORT_TELEMETRY);
    } else {
        LOGW("Remote", "Failed to send telemetry");
    }
}

void RemoteApplicationImpl::sendCommandAck(uint8_t cmdPort, bool success) {
    // Simple format: "port:status" e.g. "10:ok" or "11:error"
    char buffer[16];
    int len = snprintf(buffer, sizeof(buffer), "%d:%s", cmdPort, success ? "ok" : "err");

    LOGD("Remote", "Sending ACK on fPort %d: %s", FPORT_COMMAND_ACK, buffer);

    bool sent = lorawanService->sendData(FPORT_COMMAND_ACK, (const uint8_t*)buffer, len, false);
    if (sent) {
        LOGI("Remote", "ACK sent for port %d (%s)", cmdPort, success ? "ok" : "error");
    } else {
        LOGW("Remote", "Failed to send ACK");
    }
}

// LoRaWAN downlink command handler - routed by port
// Phase 4: Commands send ACK responses on fPort 4
void RemoteApplicationImpl::onDownlinkReceived(uint8_t port, const uint8_t* payload, uint8_t length) {
    LOGI("Remote", "Downlink received on port %d, length %d", port, length);
    bool success = false;

    // Port-based command routing per Phase 4 protocol
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
            success = true;
            break;

        case 11:  // Set reporting interval
            if (length >= 4) {
                uint32_t interval = (payload[0] << 24) | (payload[1] << 16) |
                                   (payload[2] << 8) | payload[3];
                LOGI("Remote", "Set reporting interval to %u ms", interval);
                // Note: Dynamic interval change would require scheduler modification
                success = true;
            } else {
                LOGW("Remote", "Invalid interval payload length: %d (expected 4)", length);
            }
            break;

        case 12:  // Reboot device
            LOGI("Remote", "Reboot command received");
            // Send ACK before reboot (won't get response otherwise)
            sendCommandAck(port, true);
            delay(100);
            ESP.restart();
            return;  // No further processing after reboot

        default:
            LOGD("Remote", "Unknown command port: %d", port);
            // Don't send ACK for unknown commands
            return;
    }

    // Send ACK response for processed commands (Phase 4 protocol)
    sendCommandAck(port, success);
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
