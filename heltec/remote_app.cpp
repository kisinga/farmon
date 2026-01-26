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

// Edge Rules Engine
#include "lib/message_schema.h"
#include "lib/edge_rules.h"

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

    // Edge Rules Engine
    MessageSchema::Schema _schema;
    std::unique_ptr<EdgeRules::EdgeRulesEngine> _rulesEngine;

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
    uint32_t _lastRegAttemptMs = 0;  // Track last registration attempt for retry logic
    static constexpr uint32_t REG_RETRY_INTERVAL_MS = 30000;  // Retry registration every 30s until ACK
    bool _registrationSent = false;  // Track if registration message has been sent after join
    bool _registrationPending = false;  // Flag to trigger registration from main loop (avoid stack overflow)
    bool _registrationComplete = false;  // True when server has ACKed registration (persisted in NVS)

    // Test mode state
    float _testDistance = 100.0;
    float _testVolume = 1000.0;

    // Message protocol methods (Phase 4: Device-centric framework)
    void sendRegistration();      // Send device registration on join (fPort 1)
    void sendTelemetryJson(const std::vector<SensorReading>& readings);  // Send telemetry as JSON (fPort 2)
    void sendCommandAck(uint8_t cmdPort, bool success);  // Send command ACK (fPort 4)
    void sendDiagnostics();  // Send device diagnostics/status (fPort 6)

    // LoRaWAN downlink command handler
    void onDownlinkReceived(uint8_t port, const uint8_t* payload, uint8_t length);
    static void staticOnDownlinkReceived(uint8_t port, const uint8_t* payload, uint8_t length);
    static RemoteApplicationImpl* callbackInstance;

    void setupUi();
    void setupSensors();
    void generateTestData(std::vector<SensorReading>& readings, uint32_t nowMs);
};

RemoteApplicationImpl* RemoteApplicationImpl::callbackInstance = nullptr;

// =============================================================================
// Control Executor Functions (for Edge Rules Engine)
// =============================================================================
// These functions are called when a rule triggers a control action.
// Each function handles the actual hardware control logic.

static bool setPumpState(uint8_t state_idx) {
    // TODO: RS485 implementation when hardware ready
    LOGI("Control", "Pump -> %s", state_idx ? "on" : "off");
    return true;
}

static bool setValveState(uint8_t state_idx) {
    // TODO: GPIO/RS485 implementation when hardware ready
    LOGI("Control", "Valve -> %s", state_idx ? "open" : "closed");
    return true;
}

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

    // Load registration state from NVS
    persistenceHal->begin("reg_state");
    uint32_t magic = persistenceHal->loadU32("magic", 0);
    uint32_t regVersion = persistenceHal->loadU32("regVersion", 0);
    bool registered = persistenceHal->loadU32("registered", 0) == 1;
    persistenceHal->end();

    if (magic == REG_MAGIC && regVersion == CURRENT_REG_VERSION && registered) {
        _registrationComplete = true;
        LOGI("Remote", "Registration state loaded: already registered");
    } else {
        _registrationComplete = false;
        LOGI("Remote", "Registration state: not registered (magic=0x%08X, ver=%u, reg=%d)",
             magic, regVersion, registered);
    }

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

    // Build message schema (defines fields and controls)
    _schema = MessageSchema::SchemaBuilder(1)
        // Telemetry fields (order matches registration format)
        .addField("bp", "Battery", "%", MessageSchema::FieldType::FLOAT, 0, 100)
        .addField("pd", "PulseDelta", "", MessageSchema::FieldType::UINT32, 0, 65535)
        .addField("tv", "TotalVolume", "L", MessageSchema::FieldType::FLOAT, 0, 999999)
        .addField("ec", "ErrorCount", "", MessageSchema::FieldType::UINT32, 0, 4294967295)
        .addField("tsr", "TimeSinceReset", "s", MessageSchema::FieldType::UINT32, 0, 4294967295)
        // System fields (read-write where applicable)
        .addSystemField("tx", "TxInterval", "s", MessageSchema::FieldType::UINT32,
                        10, 3600, true)  // writable
        .addSystemField("ul", "UplinkCount", "", MessageSchema::FieldType::UINT32, 0, 4294967295)
        .addSystemField("dl", "DownlinkCount", "", MessageSchema::FieldType::UINT32, 0, 4294967295)
        .addSystemField("up", "Uptime", "s", MessageSchema::FieldType::UINT32, 0, 4294967295)
        .addSystemField("bc", "BootCount", "", MessageSchema::FieldType::UINT32, 0, 4294967295)
        // Controls
        .addControl("pump", "Water Pump", {"off", "on"})
        .addControl("valve", "Valve", {"closed", "open"})
        .build();

    LOGI("Remote", "Schema built: %d fields, %d controls, version %d",
         _schema.field_count, _schema.control_count, _schema.version);

    // Initialize edge rules engine
    _rulesEngine = std::make_unique<EdgeRules::EdgeRulesEngine>(_schema, persistenceHal.get());
    _rulesEngine->loadFromFlash();

    // Register control executors
    _rulesEngine->registerControl(0, setPumpState);
    _rulesEngine->registerControl(1, setValveState);

    LOGI("Remote", "Edge rules engine initialized with %d rules", _rulesEngine->getRuleCount());

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

        // Send registration message after every successful join (ensures schema sync)
        // This implements Phase 4 device-centric protocol: device announces its capabilities
        // Server handles duplicates gracefully (ON CONFLICT DO NOTHING for schema)
        // Note: Set flag here, actual send deferred to run() to avoid stack overflow in scheduler task
        if (isConnected && !_registrationSent && !_registrationPending) {
            LOGI("Remote", "Device joined network - scheduling registration message");
            _registrationPending = true;
        }

        // Update main status text
        if (statusTextElement) {
            char statusStr[48];
            const char* connStr;
            if (!isConnected) {
                connStr = (connectionState == ILoRaWANService::ConnectionState::Connecting) ? "Joining..." : "Offline";
            } else if (!_registrationComplete) {
                connStr = _registrationSent ? "Registering..." : "Joined";
            } else {
                connStr = "Ready";
            }
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

            // Gate telemetry until registration is confirmed by server
            if (!_registrationComplete) {
                LOGD("Remote", "Telemetry skipped - awaiting registration ACK from server");
                return;
            }

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

                // Evaluate edge rules after telemetry collection
                if (_rulesEngine && !readings.empty()) {
                    // Convert readings to float array for rule evaluation
                    float fieldValues[16];
                    uint8_t fieldCount = 0;
                    for (const auto& reading : readings) {
                        if (fieldCount >= 16) break;
                        fieldValues[fieldCount++] = reading.value;
                    }
                    _rulesEngine->evaluate(fieldValues, fieldCount, state.nowMs);
                }
            }
        }, config.communication.lorawan.txIntervalMs);
    }

    // State change transmission task - sends pending state changes on fPort 3
    scheduler.registerTask("state_tx", [this](CommonAppState& state){
        if (!lorawanService->isJoined() || !_registrationComplete) return;
        if (!_rulesEngine || !_rulesEngine->hasPendingStateChange()) return;

        uint8_t buffer[16];
        size_t len = _rulesEngine->formatStateChange(buffer, sizeof(buffer));

        if (len > 0) {
            LOGI("Remote", "Sending state change (%d bytes): %s",
                 len, _rulesEngine->stateChangeToText().c_str());

            bool success = lorawanService->sendData(FPORT_STATE_CHANGE, buffer, len, true);
            if (success) {
                _rulesEngine->clearPendingStateChange();
                LOGI("Remote", "State change sent on fPort %d", FPORT_STATE_CHANGE);
            } else {
                LOGW("Remote", "Failed to send state change");
            }
        }
    }, 5000);  // Check every 5 seconds

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
        _lastRegAttemptMs = millis();
        LOGI("Remote", "Sending registration message from main loop");
        sendRegistration();
    }

    // Retry registration if not yet ACKed (Class A needs uplinks to receive downlinks)
    if (_registrationSent && !_registrationComplete && lorawanService && lorawanService->isJoined()) {
        uint32_t now = millis();
        if (now - _lastRegAttemptMs >= REG_RETRY_INTERVAL_MS) {
            _lastRegAttemptMs = now;
            LOGI("Remote", "Retrying registration (awaiting ACK)");
            sendRegistration();
        }
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
    // Registration format with schema versioning:
    // v=1|sv=1|type=water_monitor|fw=2.0.0|fields=...|sys=...|states=...|cmds=...
    // - sv: schema version (increment when fields/controls change)
    // - fields: telemetry sensors (key:name:unit:min:max)
    // - sys: system fields (key:name:unit:min:max:rw) - rw=read-write, r=read-only
    // - states: controls (key:name:val1;val2;...) - semicolon separates enum values
    // - cmds: downlink commands (key:port)
    char buffer[384];
    int len = snprintf(buffer, sizeof(buffer),
        "v=1|sv=%d|type=%s|fw=%s|"
        "fields=bp:Battery:%%:0:100,pd:PulseDelta,tv:TotalVolume:L,ec:ErrorCount,tsr:TimeSinceReset:s|"
        "sys=tx:TxInterval:s:10:3600:rw,ul:UplinkCount:::r,dl:DownlinkCount:::r,up:Uptime:s::r,bc:BootCount:::r|"
        "states=pump:WaterPump:off;on,valve:Valve:closed;open|"
        "cmds=reset:10,interval:11,reboot:12,clearerr:13,forcereg:14,status:15,ctrl:20,rule:30",
        _schema.version, DEVICE_TYPE, FIRMWARE_VERSION);

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

void RemoteApplicationImpl::sendDiagnostics() {
    // Send device diagnostics on fPort 6
    // Format: reg:1,err:5,uptime:3600,bat:85,rssi:-80,snr:7.5,fw:2.0.0
    char buffer[128];

    uint32_t uptimeSec = millis() / 1000;
    int batteryPercent = batteryService ? batteryService->getBatteryPercent() : -1;
    int rssi = lorawanService ? lorawanService->getLastRssiDbm() : 0;
    float snr = lorawanService ? lorawanService->getLastSnr() : 0.0f;
    uint32_t uplinks = lorawanService ? lorawanService->getUplinkCount() : 0;
    uint32_t downlinks = lorawanService ? lorawanService->getDownlinkCount() : 0;

    int len = snprintf(buffer, sizeof(buffer),
        "reg:%d,err:%u,up:%lu,bat:%d,rssi:%d,snr:%.1f,ul:%lu,dl:%lu,fw:%s",
        _registrationComplete ? 1 : 0,
        _errorCount,
        uptimeSec,
        batteryPercent,
        rssi,
        snr,
        uplinks,
        downlinks,
        FIRMWARE_VERSION);

    if (len < 0 || len >= (int)sizeof(buffer)) {
        LOGW("Remote", "Diagnostics message truncated");
        len = sizeof(buffer) - 1;
    }

    LOGI("Remote", "Sending diagnostics (%d bytes) on fPort %d", len, FPORT_DIAGNOSTICS);
    LOGD("Remote", "Diagnostics: %s", buffer);

    bool success = lorawanService->sendData(FPORT_DIAGNOSTICS, (const uint8_t*)buffer, len, false);
    if (success) {
        LOGI("Remote", "Diagnostics sent successfully");
    } else {
        LOGW("Remote", "Failed to send diagnostics");
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

        case FPORT_REG_ACK:  // Registration acknowledgment from server
            LOGI("Remote", "Registration ACK received from server");
            // Save registration state to NVS
            persistenceHal->begin("reg_state");
            persistenceHal->saveU32("magic", REG_MAGIC);
            persistenceHal->saveU32("regVersion", CURRENT_REG_VERSION);
            persistenceHal->saveU32("registered", 1);
            persistenceHal->end();

            _registrationComplete = true;
            LOGI("Remote", "Registration confirmed - telemetry enabled");
            return;  // No ACK needed for registration ACK

        case FPORT_CMD_CLEAR_ERR:  // Clear error count only
            LOGI("Remote", "Clear error count command received");
            _errorCount = 0;
            persistenceHal->begin("app_state");
            persistenceHal->saveU32("errorCount", _errorCount);
            persistenceHal->end();
            success = true;
            break;

        case FPORT_CMD_FORCE_REG:  // Force re-registration (clear NVS)
            LOGI("Remote", "Force re-registration command received");
            // Clear registration state from NVS
            persistenceHal->begin("reg_state");
            persistenceHal->saveU32("magic", 0);
            persistenceHal->saveU32("registered", 0);
            persistenceHal->end();

            _registrationComplete = false;
            _registrationSent = false;
            _registrationPending = true;  // Trigger registration on next loop
            LOGI("Remote", "Registration cleared - will re-register");
            success = true;
            break;

        case FPORT_CMD_STATUS:  // Request device status uplink
            LOGI("Remote", "Status request command received");
            sendDiagnostics();
            success = true;
            break;

        case FPORT_DIRECT_CTRL:  // Direct control command (7 bytes)
            if (_rulesEngine && length >= 3) {
                uint8_t ctrl_idx = payload[0];
                uint8_t state_idx = payload[1];
                bool is_manual = (payload[2] & 0x01) != 0;
                uint32_t timeout_sec = 0;

                if (length >= 7) {
                    timeout_sec = payload[3] | (payload[4] << 8) |
                                  (payload[5] << 16) | (payload[6] << 24);
                }

                LOGI("Remote", "Direct control: ctrl=%d, state=%d, manual=%d, timeout=%u",
                     ctrl_idx, state_idx, is_manual, timeout_sec);

                // Set control state
                if (_rulesEngine->setControlState(ctrl_idx, state_idx,
                        EdgeRules::TriggerSource::DOWNLINK, 0, millis())) {
                    if (is_manual) {
                        _rulesEngine->setManualOverride(ctrl_idx, timeout_sec * 1000, millis());
                    }
                    success = true;
                } else {
                    LOGW("Remote", "Failed to set control state");
                }
            } else {
                LOGW("Remote", "Invalid direct control payload (len=%d)", length);
            }
            break;

        case FPORT_RULE_UPDATE:  // Rule management (12 bytes per rule)
            if (_rulesEngine && length >= 2) {
                // Check for special commands
                if (payload[0] == 0xFF && payload[1] == 0x00) {
                    // Clear all rules
                    _rulesEngine->clearAllRules();
                    _rulesEngine->saveToFlash();
                    LOGI("Remote", "All rules cleared");
                    success = true;
                } else if ((payload[1] & 0x80) != 0) {
                    // Delete specific rule
                    uint8_t rule_id = payload[0];
                    if (_rulesEngine->deleteRule(rule_id)) {
                        _rulesEngine->saveToFlash();
                        LOGI("Remote", "Rule %d deleted", rule_id);
                        success = true;
                    } else {
                        LOGW("Remote", "Failed to delete rule %d", rule_id);
                    }
                } else if (length >= 12) {
                    // Add or update rule
                    if (_rulesEngine->addOrUpdateRule(payload, length)) {
                        _rulesEngine->saveToFlash();
                        success = true;
                    } else {
                        LOGW("Remote", "Failed to add/update rule");
                    }
                } else {
                    LOGW("Remote", "Invalid rule payload length: %d", length);
                }
            }
            break;

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
