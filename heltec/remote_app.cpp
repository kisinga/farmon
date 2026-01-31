#include "remote_app.h"
#include <stdarg.h>

// Core and HAL (before device setup so types are in scope once)
#include "lib/core_system.h"
#include "lib/core_scheduler.h"
#include "lib/core_logger.h"
#include "lib/hal_display.h"
#include "lib/hal_lorawan.h"
#include "lib/hal_battery.h"
#include "lib/hal_persistence.h"
#include "lib/svc_ui.h"
#include "lib/message_schema.h"
#include "lib/command_translator.h"
#include "lib/protocol_constants.h"
#include "lib/telemetry_keys.h"

// Sensors and edge rules (before device_setup.h which uses them)
#include "sensor_interface.hpp"
#include "sensor_implementations.hpp"
#include "lib/edge_rules.h"

// Device config (schema, config) and device setup (sensor/control wiring)
#include "device_config_include.h"

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

    // Sensors
    SensorManager sensorManager;
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

    // Registration state machine
    enum class RegistrationState : uint8_t {
        NotStarted,  // Waiting for join, no registration attempted
        Pending,     // Queued to send from main loop (avoids scheduler stack overflow)
        Sent,        // Sent, awaiting server ACK
        Complete     // Server ACKed, telemetry enabled (persisted in NVS)
    };
    RegistrationState _regState = RegistrationState::NotStarted;
    uint32_t _lastRegAttemptMs = 0;
    static constexpr uint32_t REG_RETRY_INTERVAL_MS = 30000;

    // State tracking
    uint32_t _errorCount = 0;
    uint32_t _lastResetMs = 0;
    uint32_t _lastTxMs = 0;

    // Connection status: "connected" = joined and at least one successful TX recently
    static constexpr uint32_t OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 min without success → Offline
    static constexpr uint32_t TX_FAIL_DISPLAY_MS = 4000;             // Show TX-fail indicator for 4s
    uint32_t _lastSuccessfulTxMs = 0;
    uint32_t _showTxFailUntilMs = 0;
    bool _persistErrorCount = false;

    // Deferred actions (handled in main loop to avoid timer daemon stack overflow)
    bool _notifyConnected = false;
    bool _notifyDisconnected = false;
    bool _notifyReady = false;
    bool _notifyTxFailPending = false;
    bool _shouldJoin = false;
    char _notifyCmd[24] = {0};

    // Connection state tracking (members, not static locals, for correct init)
    bool _wasConnected = false;
    RegistrationState _prevRegState = RegistrationState::NotStarted;

    // Join attempt counter (displayed to user during joining)
    uint16_t _joinAttempts = 0;

    // Test mode state (schema-aligned: pd=pulse delta, tv=total volume L)
    float _testPulseDelta = 5.0f;
    float _testVolume = 1000.0f;

    // Message protocol methods (Phase 4: Device-centric framework)
    void sendRegistration();      // Send device registration on join (fPort 1)
    void sendRegistrationFrame(const char* key, const char* format, ...);  // Send single registration frame
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

RemoteApplicationImpl::RemoteApplicationImpl() :
    config(buildDeviceConfig()),
    sensorConfig(buildDeviceSensorConfig()) {
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
        _regState = RegistrationState::Complete;
        _prevRegState = RegistrationState::Complete;
        LOGI("Remote", "Registration state loaded: already registered");
    } else {
        _regState = RegistrationState::NotStarted;
        LOGI("Remote", "Registration state: not registered (magic=0x%08X, ver=%u, reg=%d)",
             magic, regVersion, registered);
    }

    LOGI("Remote", "Creating remaining HALs");
    lorawanHal = std::make_unique<LoRaWANHal>();
    batteryHal = std::make_unique<BatteryMonitorHal>(config.battery);

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

    // TX success/failure callbacks for connection status and momentary TX-fail UI
    lorawanHal->setOnTxDone([this]() {
        _lastSuccessfulTxMs = millis();
    });
    lorawanHal->setOnTxTimeout([this]() {
        _showTxFailUntilMs = millis() + TX_FAIL_DISPLAY_MS;
        _errorCount++;
        _persistErrorCount = true;
        _notifyTxFailPending = true;
    });

    setupUi();
    LOGI("Remote", "UI setup complete");

    setupSensors();
    LOGI("Remote", "Sensors setup complete");

    // Build message schema (defines fields and controls)
    _schema = buildDeviceSchema();

    LOGI("Remote", "Schema built: %d fields, %d controls, version %d",
         _schema.field_count, _schema.control_count, _schema.version);

    // Initialize edge rules engine
    _rulesEngine = std::make_unique<EdgeRules::EdgeRulesEngine>(_schema, persistenceHal.get());
    _rulesEngine->loadFromFlash();

    // Register control drivers (device-specific: lib drivers and/or integrations)
    registerDeviceControls(*_rulesEngine);

    LOGI("Remote", "Edge rules engine initialized with %d rules", _rulesEngine->getRuleCount());

    // Register scheduler tasks
    LOGI("Remote", "Registering scheduler tasks");
    
    // Heartbeat task
    scheduler.registerTask("heartbeat", [this](CommonAppState& state){
        state.heartbeatOn = !state.heartbeatOn;
    }, config.heartbeatIntervalMs);
    
    // Battery monitoring task
    scheduler.registerTask("battery", [this](CommonAppState& state){
        batteryHal->update(state.nowMs);
    }, 1000);
    
    // Persistence task for water flow sensor
    if (sensorConfig.enableSensorSystem && sensorConfig.waterFlow.enabled) {
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
    
    // LoRaWAN task - processes radio IRQs and state machine
    scheduler.registerTask("lorawan", [this](CommonAppState& state){
        lorawanHal->tick(state.nowMs);

        // Connection status: "connected" = joined AND at least one successful TX within OFFLINE_THRESHOLD_MS
        auto connectionState = lorawanHal->getConnectionState();
        bool isJoined = lorawanHal->isJoined();
        bool hadSuccess = (_lastSuccessfulTxMs != 0);
        bool recentSuccess = hadSuccess && (state.nowMs - _lastSuccessfulTxMs <= OFFLINE_THRESHOLD_MS);
        bool considerConnected = isJoined && recentSuccess;
        // Icon: show bars when joined and (recent success OR not yet had first TX); show X when offline (had success but none recent)
        bool showBars = isJoined && (!hadSuccess || recentSuccess);

        lorawanStatusElement->setLoraStatus(showBars, lorawanHal->getLastRssiDbm());
        lorawanStatusElement->setTxFailMomentary(state.nowMs < _showTxFailUntilMs);
        batteryElement->setStatus(batteryHal->getBatteryPercent(), batteryHal->isCharging());

        // Detect connection state changes → queue notifications (deferred to main loop)
        if (isJoined && !_wasConnected) {
            _notifyConnected = true;
            _joinAttempts = 0;
        }
        if (!isJoined && _wasConnected) {
            _notifyDisconnected = true;
        }
        _wasConnected = isJoined;

        // Detect registration completion → queue "Ready" notification
        if (_regState == RegistrationState::Complete && _prevRegState != RegistrationState::Complete) {
            _notifyReady = true;
        }
        _prevRegState = _regState;

        // Schedule registration after join (deferred to run() to avoid scheduler stack overflow)
        if (isJoined && _regState == RegistrationState::NotStarted) {
            LOGI("Remote", "Device joined network - scheduling registration message");
            _regState = RegistrationState::Pending;
        }

        // Update main status text (use considerConnected for "Offline" when joined but no recent success)
        if (statusTextElement) {
            char statusStr[48];
            if (!isJoined) {
                if (connectionState == ILoRaWANHal::ConnectionState::Connecting) {
                    snprintf(statusStr, sizeof(statusStr), "Joining... (%u)\nUp:%lu Dn:%lu\nErr:%u",
                             _joinAttempts,
                             lorawanHal->getUplinkCount(),
                             lorawanHal->getDownlinkCount(),
                             _errorCount);
                } else {
                    snprintf(statusStr, sizeof(statusStr), "Offline\nUp:%lu Dn:%lu\nErr:%u",
                             lorawanHal->getUplinkCount(),
                             lorawanHal->getDownlinkCount(),
                             _errorCount);
                }
            } else if (!considerConnected) {
                // Joined but no recent success: "Offline" only if we had success before (was connected)
                if (hadSuccess) {
                    snprintf(statusStr, sizeof(statusStr), "Offline\nUp:%lu Dn:%lu\nErr:%u",
                             lorawanHal->getUplinkCount(),
                             lorawanHal->getDownlinkCount(),
                             _errorCount);
                } else {
                    snprintf(statusStr, sizeof(statusStr), "Joined\nUp:%lu Dn:%lu\nErr:%u",
                             lorawanHal->getUplinkCount(),
                             lorawanHal->getDownlinkCount(),
                             _errorCount);
                }
            } else {
                const char* connStr;
                if (_regState == RegistrationState::Sent) {
                    connStr = "Registering...";
                } else if (_regState != RegistrationState::Complete) {
                    connStr = "Joined";
                } else {
                    connStr = "Ready";
                }
                snprintf(statusStr, sizeof(statusStr), "%s\nUp:%lu Dn:%lu\nErr:%u",
                         connStr,
                         lorawanHal->getUplinkCount(),
                         lorawanHal->getDownlinkCount(),
                         _errorCount);
            }
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
            if (!lorawanHal->isJoined()) return;

            // Gate telemetry until registration is confirmed by server
            if (_regState != RegistrationState::Complete) {
                LOGD("Remote", "Telemetry skipped - awaiting registration ACK from server");
                return;
            }

            // Caller collects fresh data from services
            std::vector<SensorReading> readings;

            if (config.testModeEnabled) {
                // Generate random test data
                generateTestData(readings, state.nowMs);
            } else {
                // Use real sensor data: all sensors (lib + integrations) via SensorManager
                readings = sensorManager.readAll();

                // Append system state (not from sensors)
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

                // Evaluate edge rules after telemetry (skip in test mode: simulated values don't match schema semantics)
                if (_rulesEngine && !readings.empty() && !config.testModeEnabled) {
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

    // State change transmission task - sends batched pending state changes on fPort 3
    scheduler.registerTask("state_tx", [this](CommonAppState& state){
        if (!lorawanHal->isJoined() || _regState != RegistrationState::Complete) return;
        if (!_rulesEngine || !_rulesEngine->hasPendingStateChange()) return;

        uint8_t maxPayload = lorawanHal->getMaxPayloadSize();
        if (maxPayload < 11) return;  // Cannot send even one 11-byte event

        size_t max_events = maxPayload / 11;
        uint8_t buffer[256];  // 20*11=220 max; 256 for safety
        size_t max_len = (max_events * 11 < sizeof(buffer)) ? (max_events * 11) : (sizeof(buffer) / 11 * 11);
        size_t num_events = 0;
        size_t len = _rulesEngine->formatStateChangeBatch(buffer, max_len, &num_events);

        if (len > 0 && num_events > 0) {
            LOGI("Remote", "Sending state change batch (%d bytes, %d events): %s",
                 (int)len, (int)num_events, _rulesEngine->stateChangeToText().c_str());

            bool success = lorawanHal->sendData(FPORT_STATE_CHANGE, buffer, (uint8_t)len, true);
            if (success) {
                _rulesEngine->clearStateChangeBatch(num_events);
                _rulesEngine->saveStateChangeQueueToFlash();
                LOGI("Remote", "State change batch sent on fPort %d", FPORT_STATE_CHANGE);
            } else {
                LOGW("Remote", "Failed to send state change batch");
            }
        }
    }, 5000);  // Check every 5 seconds

    // LoRaWAN join task - detects "should join" and defers to main loop
    // join() blocks 30+ seconds (RadioLib activateOTAA); running it here would
    // starve all other timers.  The main run() loop calls join() instead.
    scheduler.registerTask("lorawan_join", [this](CommonAppState& state){
        if (!lorawanHal->isJoined() && !lorawanHal->isJoinInProgress()) {
            _shouldJoin = true;
        }
    }, 100);

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

    // Device-specific sensor setup (lib sensors + optional integrations)
    setupDeviceSensors(sensorManager, sensorConfig, batteryHal.get(), persistenceHal.get(), &waterFlowSensor);
}

void RemoteApplicationImpl::run() {
    // Main run loop - high-frequency, non-blocking tasks
    // The main application logic is handled by the scheduler

    // Handle deferred join (from main loop — join() blocks 30+ seconds)
    if (_shouldJoin) {
        _shouldJoin = false;
        _joinAttempts++;
        LOGI("Remote", "Starting LoRaWAN OTAA join (attempt %u)...", _joinAttempts);
        lorawanHal->join();
    }

    // Handle deferred notifications (from main loop to avoid callback stack overflow)
    if (_notifyConnected) {
        _notifyConnected = false;
        uiService->showNotification("Connected", "", 2000, true);
    }
    if (_notifyDisconnected) {
        _notifyDisconnected = false;
        uiService->showNotification("Disconnected", "", 1500, false);
    }
    if (_notifyReady) {
        _notifyReady = false;
        uiService->showNotification("Ready", "", 1500, false);
    }
    if (_notifyTxFailPending) {
        _notifyTxFailPending = false;
        uiService->showNotification("TX failed", "", 2000, false);
    }
    if (_persistErrorCount) {
        _persistErrorCount = false;
        persistenceHal->begin("app_state");
        persistenceHal->saveU32("errorCount", _errorCount);
        persistenceHal->end();
    }
    if (_notifyCmd[0] != '\0') {
        uiService->showNotification("Cmd:", _notifyCmd, 2000, false);
        _notifyCmd[0] = '\0';
    }

    // Handle deferred registration (sent from main loop to avoid stack overflow in scheduler tasks)
    if (_regState == RegistrationState::Pending) {
        _regState = RegistrationState::Sent;
        _lastRegAttemptMs = millis();
        LOGI("Remote", "Sending registration message from main loop");
        sendRegistration();
    }

    // Retry registration if not yet ACKed (Class A needs uplinks to receive downlinks)
    if (_regState == RegistrationState::Sent && lorawanHal->isJoined()) {
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
    // Schema-aligned test data: pd=pulse delta, tv=total volume (L), bp=%, ec=count, tsr=s
    _testPulseDelta = random(0, 20);  // Simulated pulses per interval
    _testVolume += _testPulseDelta / 450.0f;  // ~450 pulses/L
    readings.push_back({TelemetryKeys::PulseDelta, _testPulseDelta, nowMs});
    readings.push_back({TelemetryKeys::TotalVolume, _testVolume, nowMs});

    float testBattery = random(70, 100);
    readings.push_back({TelemetryKeys::BatteryPercent, testBattery, nowMs});
    readings.push_back({TelemetryKeys::ErrorCount, 0.0f, nowMs});

    uint32_t timeSinceResetSec = (nowMs - _lastResetMs) / 1000;
    readings.push_back({TelemetryKeys::TimeSinceReset, (float)timeSinceResetSec, nowMs});

    LOGI("TestMode", "Generated test data: pd=%.0f, tv=%.1fL, bp=%.0f%%",
         _testPulseDelta, _testVolume, testBattery);
}

// =============================================================================
// Message Protocol Implementation (Phase 4: Device-centric framework)
// =============================================================================
// Uses simple text format instead of JSON to minimize stack usage.
// Format is parsed by Node-RED backend which can handle both JSON and text.

void RemoteApplicationImpl::sendRegistration() {
    // Multi-frame registration format:
    // Split into 5 independent frames: header, fields, sys, states, cmds
    // Format: reg:<frameKey>|<data>
    
    sendRegistrationFrame("header", "v=1|sv=%d|type=%s|fw=%s", 
                         _schema.version, DEVICE_TYPE, FIRMWARE_VERSION);
    delay(100);
    
// Helper: Append formatted item with comma separator
auto appendItem = [](char* buf, int& pos, size_t bufSize, bool& isFirst, const char* item) {
    if (!isFirst) {
        int commaLen = snprintf(buf + pos, bufSize - pos, ",");
        if (commaLen < 0 || commaLen >= (int)(bufSize - pos)) {
            return false;  // Buffer overflow
        }
        pos += commaLen;
    }
    isFirst = false;
    int itemLen = snprintf(buf + pos, bufSize - pos, "%s", item);
    if (itemLen < 0 || itemLen >= (int)(bufSize - pos)) {
        return false;  // Buffer overflow
    }
    pos += itemLen;
    return true;
};

// Build registration frame data using schema formatting methods
char fieldsBuf[200] = {0};
char sysBuf[300] = {0};
char statesBuf[200] = {0};

int fieldsPos = snprintf(fieldsBuf, sizeof(fieldsBuf), "fields=");
int sysPos = snprintf(sysBuf, sizeof(sysBuf), "sys=");
int statesPos = snprintf(statesBuf, sizeof(statesBuf), "states=");

bool fieldsFirst = true;
bool sysFirst = true;
bool statesFirst = true;
char itemBuf[64];  // Reusable buffer

// Single loop: categorize and build all field arrays
uint8_t sysFieldCount = 0;
for (uint8_t i = 0; i < _schema.field_count; i++) {
    const auto& field = _schema.fields[i];
    const bool isSystemField = (field.category == MessageSchema::FieldCategory::SYSTEM);
    int written = field.formatForRegistration(itemBuf, sizeof(itemBuf));
    
    // Validate formatting result
    bool formatValid = (written > 0 && written < (int)sizeof(itemBuf));
    if (!formatValid && isSystemField) {
        LOGW("Remote", "System field %s failed to format: written=%d (bufSize=%d)", 
             field.key, written, sizeof(itemBuf));
        continue;
    }
    if (!formatValid) {
        continue;  // Skip invalid non-system fields silently
    }
    
    // Ensure null termination
    itemBuf[sizeof(itemBuf) - 1] = '\0';
    
    // Append to appropriate buffer based on category
    bool appended = false;
    switch (field.category) {
        case MessageSchema::FieldCategory::TELEMETRY:
            appended = appendItem(fieldsBuf, fieldsPos, sizeof(fieldsBuf), fieldsFirst, itemBuf);
            break;
        case MessageSchema::FieldCategory::SYSTEM:
            appended = appendItem(sysBuf, sysPos, sizeof(sysBuf), sysFirst, itemBuf);
            if (appended) {
                sysFieldCount++;
            } else {
                LOGW("Remote", "Failed to append system field %s to buffer", field.key);
            }
            break;
        default:
            break;  // Skip computed and unknown
    }
}

// Build states frame from controls
for (uint8_t i = 0; i < _schema.control_count; i++) {
    int written = _schema.controls[i].formatForRegistration(itemBuf, sizeof(itemBuf));
    if (written > 0) {
        appendItem(statesBuf, statesPos, sizeof(statesBuf), statesFirst, itemBuf);
    }
}

// Validate sysBuf has content (should have at least one system field)
if (sysFieldCount == 0) {
    LOGW("Remote", "WARNING: No system fields formatted! Schema has %d fields", _schema.field_count);
    // Log all field categories for debugging
    for (uint8_t i = 0; i < _schema.field_count; i++) {
        const auto& field = _schema.fields[i];
        LOGD("Remote", "Field[%d]: key='%s', category=%d, type=%d", 
             i, field.key, (int)field.category, (int)field.type);
    }
}

// Log buffer contents for debugging
LOGI("Remote", "Registration buffers: fields='%s' (%d bytes), sys='%s' (%d bytes, %d fields), states='%s' (%d bytes)", 
     fieldsBuf, fieldsPos, sysBuf, sysPos, sysFieldCount, statesBuf, statesPos);
    
// Send frames independently (always send, even if empty - server handles empty frames)
LOGI("Remote", "Sending registration frame: fields");
sendRegistrationFrame("fields", "%s", fieldsBuf);
delay(100);

// Send sys frame (now compacted to fit within limit)
LOGI("Remote", "Sending registration frame: sys (fieldCount=%d, %d bytes)", sysFieldCount, sysPos);
sendRegistrationFrame("sys", "%s", sysBuf);
delay(100);

LOGI("Remote", "Sending registration frame: states");
sendRegistrationFrame("states", "%s", statesBuf);
delay(100);

LOGI("Remote", "Sending registration frame: cmds");
sendRegistrationFrame("cmds", "cmds=reset:10,interval:11,reboot:12,clearerr:13,forcereg:14,status:15,ctrl:20,rule:30");

LOGI("Remote", "Registration frames sent (5 frames total)");
}

void RemoteApplicationImpl::sendRegistrationFrame(const char* key, const char* format, ...) {
    // Use static buffer to avoid stack overflow (ESP32 has limited stack)
    static char buffer[256];
    int prefixLen = snprintf(buffer, sizeof(buffer), "reg:%s|", key);
    
    if (prefixLen < 0 || prefixLen >= (int)sizeof(buffer)) {
        LOGW("Remote", "Frame prefix too large for %s", key);
        return;
    }
    
    va_list args;
    va_start(args, format);
    int dataLen = vsnprintf(buffer + prefixLen, sizeof(buffer) - prefixLen, format, args);
    va_end(args);
    
    if (dataLen < 0) {
        LOGW("Remote", "Frame data formatting failed for %s", key);
        return;
    }
    
    int totalLen = prefixLen + dataLen;
    
    // Check against DR3 limit (222 bytes) - conservative check
    if (totalLen > 222) {
        LOGW("Remote", "Frame %s too large: %d bytes", key, totalLen);
        return;
    }
    
    LOGD("Remote", "Sending registration frame %s (%d bytes)", key, totalLen);
    
    bool success = lorawanHal->sendData(FPORT_REGISTRATION, (const uint8_t*)buffer, totalLen, false);
    if (!success) {
        LOGW("Remote", "Failed to send registration frame %s", key);
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
        if (strcmp(readings[i].type, TelemetryKeys::PulseDelta) == 0 ||
            strcmp(readings[i].type, TelemetryKeys::BatteryPercent) == 0 ||
            strcmp(readings[i].type, TelemetryKeys::ErrorCount) == 0 ||
            strcmp(readings[i].type, TelemetryKeys::TimeSinceReset) == 0) {
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

    uint8_t maxPayload = lorawanHal->getMaxPayloadSize();
    if (offset > (int)maxPayload) {
        LOGW("Remote", "Payload %d bytes exceeds max %d for DR%d, skipping",
             offset, maxPayload, lorawanHal->getCurrentDataRate());
        return;
    }

    LOGD("Remote", "Sending telemetry (%d bytes) on fPort %d: %s", offset, FPORT_TELEMETRY, buffer);

    bool success = lorawanHal->sendData(FPORT_TELEMETRY, (const uint8_t*)buffer, offset,
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

    bool sent = lorawanHal->sendData(FPORT_COMMAND_ACK, (const uint8_t*)buffer, len, false);
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
    int batteryPercent = batteryHal ? batteryHal->getBatteryPercent() : -1;
    int rssi = lorawanHal ? lorawanHal->getLastRssiDbm() : 0;
    float snr = lorawanHal ? lorawanHal->getLastSnr() : 0.0f;
    uint32_t uplinks = lorawanHal ? lorawanHal->getUplinkCount() : 0;
    uint32_t downlinks = lorawanHal ? lorawanHal->getDownlinkCount() : 0;

    int len = snprintf(buffer, sizeof(buffer),
        "reg:%d,err:%u,up:%lu,bat:%d,rssi:%d,snr:%.1f,ul:%lu,dl:%lu,fw:%s",
        (_regState == RegistrationState::Complete) ? 1 : 0,
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

    bool success = lorawanHal->sendData(FPORT_DIAGNOSTICS, (const uint8_t*)buffer, len, false);
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

    // Queue command notification (deferred to main loop)
    CommandTranslator::translate(port, payload, length, _notifyCmd, sizeof(_notifyCmd));

    // Port-based command routing per Phase 4 protocol
    switch (port) {
        case 10:  // Reset water volume
            LOGI("Remote", "Received ResetWaterVolume command via port 10");
            if (waterFlowSensor) {
                waterFlowSensor->resetTotalVolume();
            }
            lorawanHal->resetCounters();

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
                uint32_t newIntervalMs = ((uint32_t)payload[0] << 24) |
                                         ((uint32_t)payload[1] << 16) |
                                         ((uint32_t)payload[2] << 8) |
                                         payload[3];
                // Validate range (10s - 3600s = 10000ms - 3600000ms)
                if (newIntervalMs >= 10000 && newIntervalMs <= 3600000) {
                    if (scheduler.setTaskInterval("lorawan_tx", newIntervalMs)) {
                        LOGI("Remote", "TX interval changed to %lu ms", newIntervalMs);
                        success = true;
                    } else {
                        LOGW("Remote", "Failed to change TX interval");
                    }
                } else {
                    LOGW("Remote", "Interval %lu ms out of range (10000-3600000)", newIntervalMs);
                }
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

            _regState = RegistrationState::Complete;
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

            _regState = RegistrationState::Pending;
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
#include "lib/hal_lorawan.cpp"
#include "lib/ui_battery_icon_element.cpp"
#include "lib/ui_header_status_element.cpp"
#include "lib/ui_main_content_layout.cpp"
#include "lib/ui_screen_layout.cpp"
#include "lib/ui_top_bar_layout.cpp"
#include "sensor_implementations.hpp"
