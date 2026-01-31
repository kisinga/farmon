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
#include "lib/ota_receiver.h"

// Communication coordinator and routing
#include "lib/comm_coordinator.h"
#include "lib/downlink_router.h"
#include "lib/registration_manager.h"

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

    // Communication (composition)
    std::unique_ptr<CommCoordinator> commCoordinator;
    DownlinkRouter downlinkRouter;
    RegistrationManager registrationManager;

    // Services
    std::unique_ptr<UiService> uiService;

    // Sensors
    SensorManager sensorManager;
    std::shared_ptr<YFS201WaterFlowSensor> waterFlowSensor;

    // Edge Rules Engine
    MessageSchema::Schema _schema;
    std::unique_ptr<EdgeRules::EdgeRulesEngine> _rulesEngine;

    // OTA over LoRaWAN (fPort 40/41/42 downlink, fPort 8 uplink progress)
    OtaReceiver::OtaReceiver _ota;

    // UI Elements must be stored to manage their lifetime
    std::vector<std::shared_ptr<UIElement>> uiElements;
    std::shared_ptr<TextElement> idElement;
    std::shared_ptr<HeaderStatusElement> lorawanStatusElement;
    std::shared_ptr<BatteryIconElement> batteryElement;
    std::shared_ptr<TextElement> statusTextElement;

    // State tracking - error categories (failure points)
    uint32_t _noAckCount = 0;      // Confirmed uplink sent, no ACK received
    uint32_t _joinFailCount = 0;   // OTAA join attempt failed
    uint32_t _sendFailCount = 0;   // sendData failed (pre-check or radio error)
    uint32_t _lastResetMs = 0;
    uint32_t _lastTxMs = 0;

    bool _persistErrorCount = false;
    char _notifyCmd[24] = {0};
    bool _lastTxWasNoAck = false;
    bool _wasConnected = false;
    bool _hadSuccessfulTx = false;
    RegistrationManager::State _prevRegState = RegistrationManager::State::NotStarted;
    uint16_t _joinAttempts = 0;

    // Deferred notifications (from lorawan task, handled in run)
    bool _notifyConnected = false;
    bool _notifyDisconnected = false;
    bool _notifyReady = false;
    bool _notifyTxFailPending = false;

    // Post-join uplinks: diagnostics and minimal telemetry (ChirpStack sees activity for Class C)
    bool _sendPostJoinDiagnostics = false;
    bool _sendPostJoinTelemetry = false;

    // Test mode state (schema-aligned: pd=pulse delta, tv=total volume L)
    float _testPulseDelta = 5.0f;
    float _testVolume = 1000.0f;

    // Message protocol methods
    void sendTelemetryJson(const std::vector<SensorReading>& readings);
    void sendCommandAck(uint8_t cmdPort, bool success);  // Send command ACK (fPort 4)
    void sendDiagnostics();  // Send device diagnostics/status (fPort 6)

    void onDownlinkReceived(uint8_t port, const uint8_t* payload, uint8_t length);

    void setupUi();
    void setupSensors();
    void generateTestData(std::vector<SensorReading>& readings, uint32_t nowMs);
};

RemoteApplicationImpl::RemoteApplicationImpl() :
    config(buildDeviceConfig()),
    sensorConfig(buildDeviceSensorConfig()) {
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
    _noAckCount = persistenceHal->loadU32("ec_no_ack", 0);
    _joinFailCount = persistenceHal->loadU32("ec_join_fail", 0);
    _sendFailCount = persistenceHal->loadU32("ec_send_fail", 0);
    _lastResetMs = persistenceHal->loadU32("lastResetMs", 0);
    // TX interval: persisted across reboots; default 60s if absent (10s–3600s valid)
    constexpr uint32_t TX_INTERVAL_DEFAULT_MS = 60000;
    constexpr uint32_t TX_INTERVAL_MIN_MS = 10000;
    constexpr uint32_t TX_INTERVAL_MAX_MS = 3600000;
    uint32_t savedTxIntervalMs = persistenceHal->loadU32("tx_interval_ms", TX_INTERVAL_DEFAULT_MS);
    if (savedTxIntervalMs >= TX_INTERVAL_MIN_MS && savedTxIntervalMs <= TX_INTERVAL_MAX_MS) {
        config.communication.lorawan.txIntervalMs = savedTxIntervalMs;
        LOGI("Remote", "TX interval loaded from storage: %lu ms", savedTxIntervalMs);
    } else {
        config.communication.lorawan.txIntervalMs = TX_INTERVAL_DEFAULT_MS;
        LOGI("Remote", "TX interval defaulting to %lu ms (stored value %lu out of range)", TX_INTERVAL_DEFAULT_MS, savedTxIntervalMs);
    }
    persistenceHal->end();

    // Registration state will be restored after RegistrationManager is wired

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

    // Configure LoRaWAN settings (Class C is fixed in HAL)
    lorawanHal->setAdr(config.communication.lorawan.adrEnabled);
    // Set initial data rate (before ADR takes over, ensures we can send payloads)
    // Ensure data rate is at least the configured minimum
    uint8_t dataRate = config.communication.lorawan.dataRate;
    if (dataRate < config.communication.lorawan.minDataRate) {
        LOGI("Remote", "Data rate %d below minimum %d, using minimum", dataRate, config.communication.lorawan.minDataRate);
        dataRate = config.communication.lorawan.minDataRate;
    }
    lorawanHal->setDataRate(dataRate);
    lorawanHal->setTxPower(config.communication.lorawan.txPower);

    // Create CommCoordinator (owns HAL wiring, TxQueue, connection state)
    commCoordinator = std::make_unique<CommCoordinator>(*lorawanHal);
    commCoordinator->setConfig(config.communication.lorawan);
    commCoordinator->setOnDownlink([this](uint8_t port, const uint8_t* payload, uint8_t length) {
        downlinkRouter.dispatch(port, payload, length);
    });
    commCoordinator->setOnTxDone([this]() {
        _lastTxWasNoAck = false;
        _hadSuccessfulTx = true;
    });
    commCoordinator->setOnTxTimeout([this]() {
        _sendFailCount++;
        _persistErrorCount = true;
        _notifyTxFailPending = true;
    });
    commCoordinator->setOnTxNoAck([this]() {
        _noAckCount++;
        _persistErrorCount = true;
        _lastTxWasNoAck = true;
        _notifyTxFailPending = true;
    });
    commCoordinator->begin();

    // OTA receiver: send via coordinator
    _ota.setSendCallback([this](uint8_t port, const uint8_t* payload, uint8_t length) {
        return commCoordinator && commCoordinator->enqueue(port, payload, length, false);
    });

    // DownlinkRouter: single handler (onDownlinkReceived routes by port, OTA vs commands)
    downlinkRouter.registerHandlerRange(0, 255, [this](uint8_t port, const uint8_t* payload, uint8_t length) {
        onDownlinkReceived(port, payload, length);
        return true;
    });

    setupUi();
    LOGI("Remote", "UI setup complete");

    setupSensors();
    LOGI("Remote", "Sensors setup complete");

    // Build message schema (defines fields and controls)
    _schema = buildDeviceSchema();

    LOGI("Remote", "Schema built: %d fields, %d controls, version %d",
         _schema.field_count, _schema.control_count, _schema.version);

    // RegistrationManager
    registrationManager.setEnqueueFn([this](uint8_t port, const uint8_t* payload, uint8_t len, bool confirmed) {
        return commCoordinator && commCoordinator->enqueue(port, payload, len, confirmed);
    });
    registrationManager.setSchema(_schema);
    registrationManager.setDeviceInfo(DEVICE_TYPE, FIRMWARE_VERSION);
    registrationManager.setPersistence(persistenceHal.get());
    registrationManager.restoreFromPersistence();
    if (registrationManager.getState() == RegistrationManager::State::Complete) {
        _prevRegState = RegistrationManager::State::Complete;
    }

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
    
    // LoRaWAN task - single tick entry point (coordinator calls hal.tick)
    scheduler.registerTask("lorawan", [this](CommonAppState& state){
        commCoordinator->tick(state.nowMs);

        bool isJoined = commCoordinator->isJoined();
        bool considerConnected = commCoordinator->isConnected();
        bool showBars = isJoined && considerConnected;

        lorawanStatusElement->setLoraStatus(showBars, commCoordinator->getLastRssi());
        lorawanStatusElement->setTxFailMomentary(commCoordinator->getTxFailActive());
        batteryElement->setStatus(batteryHal->getBatteryPercent(), batteryHal->isCharging());

        // Connection state change notifications (deferred to run)
        if (isJoined && !_wasConnected) {
            _notifyConnected = true;
            _joinAttempts = 0;
        }
        if (!isJoined && _wasConnected) {
            _notifyDisconnected = true;
        }
        _wasConnected = isJoined;

        // Registration: on join trigger Pending; tick sends
        if (isJoined && registrationManager.getState() == RegistrationManager::State::NotStarted) {
            registrationManager.onJoin();
        }
        registrationManager.tick(state.nowMs);

        if (registrationManager.getState() == RegistrationManager::State::Complete && _prevRegState != RegistrationManager::State::Complete) {
            _notifyReady = true;
        }
        if (registrationManager.getState() == RegistrationManager::State::Sent && _prevRegState == RegistrationManager::State::NotStarted) {
            _sendPostJoinDiagnostics = true;
        }
        _prevRegState = registrationManager.getState();

        // Update main status text
        auto regState = registrationManager.getState();
        auto connState = commCoordinator->getConnectionState();
        if (statusTextElement) {
            char statusStr[48];
            if (_ota.isActive()) {
                uint8_t pct = _ota.getProgressPercent();
                snprintf(statusStr, sizeof(statusStr), "OTA %u%%\n%u/%u",
                         (unsigned)pct,
                         (unsigned)_ota.getNextExpectedIndex(),
                         (unsigned)_ota.getTotalChunks());
                statusTextElement->setText(statusStr);
            } else if (!isJoined) {
                if (connState == ILoRaWANHal::ConnectionState::Connecting) {
                    snprintf(statusStr, sizeof(statusStr), "Joining... (%u)\nUp:%lu Dn:%lu\nNA:%u J:%u S:%u",
                             _joinAttempts,
                             commCoordinator->getUplinkCount(),
                             commCoordinator->getDownlinkCount(),
                             _noAckCount, _joinFailCount, _sendFailCount);
                } else {
                    snprintf(statusStr, sizeof(statusStr), "Offline\nUp:%lu Dn:%lu\nNA:%u J:%u S:%u",
                             commCoordinator->getUplinkCount(),
                             commCoordinator->getDownlinkCount(),
                             _noAckCount, _joinFailCount, _sendFailCount);
                }
            } else if (!considerConnected) {
                if (_hadSuccessfulTx) {
                    snprintf(statusStr, sizeof(statusStr), "Offline\nUp:%lu Dn:%lu\nNA:%u J:%u S:%u",
                             commCoordinator->getUplinkCount(),
                             commCoordinator->getDownlinkCount(),
                             _noAckCount, _joinFailCount, _sendFailCount);
                } else {
                    snprintf(statusStr, sizeof(statusStr), "Joined\nUp:%lu Dn:%lu\nNA:%u J:%u S:%u",
                             commCoordinator->getUplinkCount(),
                             commCoordinator->getDownlinkCount(),
                             _noAckCount, _joinFailCount, _sendFailCount);
                }
            } else {
                const char* connStr;
                if (regState == RegistrationManager::State::Sent) {
                    connStr = "Registering...";
                } else if (regState != RegistrationManager::State::Complete) {
                    connStr = "Joined";
                } else if (!_hadSuccessfulTx) {
                    connStr = "Reconnecting";
                } else {
                    connStr = "Ready";
                }
                snprintf(statusStr, sizeof(statusStr), "%s\nUp:%lu Dn:%lu\nNA:%u J:%u S:%u",
                         connStr,
                         commCoordinator->getUplinkCount(),
                         commCoordinator->getDownlinkCount(),
                         _noAckCount, _joinFailCount, _sendFailCount);
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
        scheduler.registerTask("lorawan_tx", [this](CommonAppState& state){
            if (!commCoordinator->isJoined()) return;

            if (registrationManager.getState() != RegistrationManager::State::Complete) {
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

                // Append system state - error categories and total
                readings.push_back({ TelemetryKeys::ErrorNoAck, (float)_noAckCount, state.nowMs });
                readings.push_back({ TelemetryKeys::ErrorJoinFail, (float)_joinFailCount, state.nowMs });
                readings.push_back({ TelemetryKeys::ErrorSendFail, (float)_sendFailCount, state.nowMs });
                readings.push_back({
                    TelemetryKeys::ErrorCount,
                    (float)(_noAckCount + _joinFailCount + _sendFailCount),
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

                // Evaluate edge rules after telemetry (skip when OTA active or test mode)
                if (_rulesEngine && !readings.empty() && !config.testModeEnabled && !_ota.isActive()) {
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
        if (!commCoordinator->isJoined() || registrationManager.getState() != RegistrationManager::State::Complete) return;
        if (!_rulesEngine || !_rulesEngine->hasPendingStateChange()) return;

        uint8_t maxPayload = commCoordinator->getMaxPayloadSize();
        if (maxPayload < 11) return;  // Cannot send even one 11-byte event

        size_t max_events = maxPayload / 11;
        uint8_t buffer[256];  // 20*11=220 max; 256 for safety
        size_t max_len = (max_events * 11 < sizeof(buffer)) ? (max_events * 11) : (sizeof(buffer) / 11 * 11);
        size_t num_events = 0;
        size_t len = _rulesEngine->formatStateChangeBatch(buffer, max_len, &num_events);

        if (len > 0 && num_events > 0) {
            LOGI("Remote", "Sending state change batch (%d bytes, %d events): %s",
                 (int)len, (int)num_events, _rulesEngine->stateChangeToText().c_str());

            bool success = commCoordinator->enqueue(FPORT_STATE_CHANGE, buffer, (uint8_t)len, true);
            if (success) {
                _rulesEngine->clearStateChangeBatch(num_events);
                _rulesEngine->saveStateChangeQueueToFlash();
                LOGI("Remote", "State change batch sent on fPort %d", FPORT_STATE_CHANGE);
            } else {
                if (_lastTxWasNoAck) {
                    _lastTxWasNoAck = false;
                    LOGW("Remote", "State change batch sent but no ACK - delivery not confirmed");
                } else {
                    _sendFailCount++;
                    _persistErrorCount = true;
                    LOGW("Remote", "Failed to send state change batch");
                }
            }
        }
    }, 5000);  // Check every 5 seconds

    scheduler.registerTask("lorawan_join", [this](CommonAppState& state){
        commCoordinator->requestJoin();
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
    // Handle deferred join (join() blocks 30+ seconds)
    if (commCoordinator->shouldJoin()) {
        _joinAttempts++;
        LOGI("Remote", "Starting LoRaWAN OTAA join (attempt %u)...", _joinAttempts);
        commCoordinator->performJoin();
        if (!commCoordinator->isJoined()) {
            _joinFailCount++;
            _persistErrorCount = true;
        }
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
        uiService->showNotification("Reconnecting", "", 1500, false);
    }
    if (_notifyTxFailPending) {
        _notifyTxFailPending = false;
        uiService->showNotification("TX failed", "", 2000, false);
    }
    if (_persistErrorCount) {
        _persistErrorCount = false;
        persistenceHal->begin("app_state");
        persistenceHal->saveU32("ec_no_ack", _noAckCount);
        persistenceHal->saveU32("ec_join_fail", _joinFailCount);
        persistenceHal->saveU32("ec_send_fail", _sendFailCount);
        persistenceHal->end();
    }
    if (_notifyCmd[0] != '\0') {
        uiService->showNotification("Cmd:", _notifyCmd, 2000, false);
        _notifyCmd[0] = '\0';
    }

    // OTA: tick rebooting state (ESP.restart after delay)
    _ota.tick(millis());

    // Post-join diagnostics (fPort 6) once after registration — stagger one send per run()
    if (_sendPostJoinDiagnostics && commCoordinator->isJoined()) {
        LOGI("Remote", "Post-join: sending diagnostics (fPort 6)");
        sendDiagnostics();
        _sendPostJoinDiagnostics = false;
        _sendPostJoinTelemetry = true;
    }

    // Post-join minimal telemetry (fPort 2) once after diagnostics — stagger one send per run()
    if (_sendPostJoinTelemetry && commCoordinator->isJoined()) {
        uint32_t nowMs = millis();
        uint32_t timeSinceResetSec = (nowMs - _lastResetMs) / 1000;
        uint32_t errTotal = _noAckCount + _joinFailCount + _sendFailCount;
        int batteryPercent = batteryHal ? batteryHal->getBatteryPercent() : -1;
        if (batteryPercent < 0) batteryPercent = 0;
        std::vector<SensorReading> readings;
        readings.push_back({ TelemetryKeys::PulseDelta, 0.0f, nowMs });
        readings.push_back({ TelemetryKeys::TotalVolume, 0.0f, nowMs });
        readings.push_back({ TelemetryKeys::BatteryPercent, (float)batteryPercent, nowMs });
        readings.push_back({ TelemetryKeys::ErrorNoAck, (float)_noAckCount, nowMs });
        readings.push_back({ TelemetryKeys::ErrorJoinFail, (float)_joinFailCount, nowMs });
        readings.push_back({ TelemetryKeys::ErrorSendFail, (float)_sendFailCount, nowMs });
        readings.push_back({ TelemetryKeys::ErrorCount, (float)errTotal, nowMs });
        readings.push_back({ TelemetryKeys::TimeSinceReset, (float)timeSinceResetSec, nowMs });
        LOGI("Remote", "Post-join: sending minimal telemetry (fPort 2)");
        sendTelemetryJson(readings);
        _sendPostJoinTelemetry = false;
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
    readings.push_back({TelemetryKeys::ErrorNoAck, 0.0f, nowMs});
    readings.push_back({TelemetryKeys::ErrorJoinFail, 0.0f, nowMs});
    readings.push_back({TelemetryKeys::ErrorSendFail, 0.0f, nowMs});
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
            strcmp(readings[i].type, TelemetryKeys::ErrorNoAck) == 0 ||
            strcmp(readings[i].type, TelemetryKeys::ErrorJoinFail) == 0 ||
            strcmp(readings[i].type, TelemetryKeys::ErrorSendFail) == 0 ||
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

    uint8_t maxPayload = commCoordinator->getMaxPayloadSize();
    if (offset > (int)maxPayload) {
        LOGW("Remote", "Payload %d bytes exceeds max %d for DR%d, skipping",
             offset, maxPayload, commCoordinator->getCurrentDataRate());
        return;
    }

    LOGD("Remote", "Enqueue telemetry (%d bytes) on fPort %d: %s", offset, FPORT_TELEMETRY, buffer);
    if (!commCoordinator->enqueue(FPORT_TELEMETRY, (const uint8_t*)buffer, offset,
                                  config.communication.lorawan.useConfirmedUplinks)) {
        _sendFailCount++;
        _persistErrorCount = true;
        LOGW("Remote", "Failed to enqueue telemetry (queue full?)");
    }
}

void RemoteApplicationImpl::sendCommandAck(uint8_t cmdPort, bool success) {
    char buffer[16];
    int len = snprintf(buffer, sizeof(buffer), "%d:%s", cmdPort, success ? "ok" : "err");

    LOGD("Remote", "Enqueue ACK on fPort %d: %s", FPORT_COMMAND_ACK, buffer);
    if (!commCoordinator->enqueue(FPORT_COMMAND_ACK, (const uint8_t*)buffer, len, false)) {
        _sendFailCount++;
        _persistErrorCount = true;
        LOGW("Remote", "Failed to enqueue ACK");
    }
}

void RemoteApplicationImpl::sendDiagnostics() {
    char buffer[128];

    uint32_t uptimeSec = millis() / 1000;
    int batteryPercent = batteryHal ? batteryHal->getBatteryPercent() : -1;
    int rssi = commCoordinator ? commCoordinator->getLastRssi() : 0;
    float snr = commCoordinator ? commCoordinator->getLastSnr() : 0.0f;
    uint32_t uplinks = commCoordinator ? commCoordinator->getUplinkCount() : 0;
    uint32_t downlinks = commCoordinator ? commCoordinator->getDownlinkCount() : 0;

    uint32_t errTotal = _noAckCount + _joinFailCount + _sendFailCount;
    int len = snprintf(buffer, sizeof(buffer),
        "reg:%d,err:%u,na:%u,jf:%u,sf:%u,up:%lu,bat:%d,rssi:%d,snr:%.1f,ul:%lu,dl:%lu,fw:%s",
        (registrationManager.getState() == RegistrationManager::State::Complete) ? 1 : 0,
        (unsigned)errTotal,
        _noAckCount, _joinFailCount, _sendFailCount,
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

    LOGI("Remote", "Enqueue diagnostics (%d bytes) on fPort %d", len, FPORT_DIAGNOSTICS);
    if (!commCoordinator->enqueue(FPORT_DIAGNOSTICS, (const uint8_t*)buffer, len, false)) {
        _sendFailCount++;
        _persistErrorCount = true;
        LOGW("Remote", "Failed to enqueue diagnostics");
    }
}

// LoRaWAN downlink command handler - routed by port
// Phase 4: Commands send ACK responses on fPort 4
void RemoteApplicationImpl::onDownlinkReceived(uint8_t port, const uint8_t* payload, uint8_t length) {
    LOGI("Remote", "Downlink received on port %d, length %d", port, length);
    bool success = false;

    // OTA: when OTA is active only handle fPort 40, 41, 42; no command ACK (progress on fPort 8)
    if (_ota.isActive()) {
        if (port == FPORT_OTA_START || port == FPORT_OTA_CHUNK || port == FPORT_OTA_CANCEL) {
            CommandTranslator::translate(port, payload, length, _notifyCmd, sizeof(_notifyCmd));
            _ota.handleDownlink(port, payload, length);
        }
        return;
    }

    // OTA ports when idle: handle start/chunk/cancel
    if (port == FPORT_OTA_START || port == FPORT_OTA_CHUNK || port == FPORT_OTA_CANCEL) {
        CommandTranslator::translate(port, payload, length, _notifyCmd, sizeof(_notifyCmd));
        _ota.handleDownlink(port, payload, length);
        return;
    }

    // Queue command notification (deferred to main loop)
    CommandTranslator::translate(port, payload, length, _notifyCmd, sizeof(_notifyCmd));

    // Port-based command routing per Phase 4 protocol
    switch (port) {
        case 10:  // Reset water volume
            LOGI("Remote", "Received ResetWaterVolume command via port 10");
            if (waterFlowSensor) {
                waterFlowSensor->resetTotalVolume();
            }
            commCoordinator->resetCounters();

            // Reset error counters and record reset time
            _noAckCount = 0;
            _joinFailCount = 0;
            _sendFailCount = 0;
            _lastResetMs = millis();
            persistenceHal->begin("app_state");
            persistenceHal->saveU32("ec_no_ack", _noAckCount);
            persistenceHal->saveU32("ec_join_fail", _joinFailCount);
            persistenceHal->saveU32("ec_send_fail", _sendFailCount);
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
                        config.communication.lorawan.txIntervalMs = newIntervalMs;
                        persistenceHal->begin("app_state");
                        persistenceHal->saveU32("tx_interval_ms", newIntervalMs);
                        persistenceHal->end();
                        LOGI("Remote", "TX interval changed to %lu ms (persisted)", newIntervalMs);
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
            registrationManager.onRegAck();
            LOGI("Remote", "Registration confirmed - telemetry enabled");
            return;  // No ACK needed for registration ACK

        case FPORT_CMD_CLEAR_ERR:  // Clear error counters only
            LOGI("Remote", "Clear error counters command received");
            _noAckCount = 0;
            _joinFailCount = 0;
            _sendFailCount = 0;
            persistenceHal->begin("app_state");
            persistenceHal->saveU32("ec_no_ack", _noAckCount);
            persistenceHal->saveU32("ec_join_fail", _joinFailCount);
            persistenceHal->saveU32("ec_send_fail", _sendFailCount);
            persistenceHal->end();
            success = true;
            break;

        case FPORT_CMD_FORCE_REG:  // Force re-registration (clear NVS)
            LOGI("Remote", "Force re-registration command received");
            persistenceHal->begin("reg_state");
            persistenceHal->saveU32("magic", 0);
            persistenceHal->saveU32("registered", 0);
            persistenceHal->end();
            registrationManager.forceReregister();
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

// PIMPL Implementation
RemoteApplication::RemoteApplication() : impl(new RemoteApplicationImpl()) {}
RemoteApplication::~RemoteApplication() { delete impl; }
void RemoteApplication::initialize() { impl->initialize(); }
void RemoteApplication::run() { impl->run(); }

// Force the Arduino build system to compile these implementation files
#include "lib/ota_receiver.cpp"
#include "lib/comm_coordinator.cpp"
#include "lib/downlink_router.cpp"
#include "lib/registration_manager.cpp"
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
