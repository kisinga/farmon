#include "remote_app.h"
#include <stdarg.h>

// Core and HAL (before device setup so types are in scope once)
#include "lib/core_system.h"
#include "lib/core_scheduler.h"
#include "lib/core_logger.h"
#include "lib/hal_display.h"
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

// Communication: Radio task (replaces HAL + CommCoordinator)
#include "lib/radio_task.h"
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
    CoreScheduler scheduler{4096};  // Larger stack for lorawan blocking task (RadioLib + sendData)
    CommonAppState appState;

    // HALs
    std::unique_ptr<IDisplayHal> displayHal;
    std::unique_ptr<IBatteryHal> batteryHal;
    std::unique_ptr<IPersistenceHal> persistenceHal;

    // Communication (radio task)
    RadioTaskState* _radioState = nullptr;
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

    // Post-join sequence: 0=none, 1=send diagnostics, 2=send telemetry, 3=done
    uint8_t _postJoinStep = 0;

    // Test mode state (schema-aligned: pd=pulse delta, tv=total volume L)
    float _testPulseDelta = 5.0f;
    float _testVolume = 1000.0f;

    // Message protocol methods
    void sendTelemetryJson(const std::vector<SensorReading>& readings);
    void sendCommandAck(uint8_t cmdPort, bool success);  // Send command ACK (fPort 4)
    void sendDiagnostics();  // Send device diagnostics/status (fPort 6)

    void onDownlinkReceived(uint8_t port, const uint8_t* payload, uint8_t length);
    void drainNotifications();

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

    LOGI("Remote", "Initializing battery HAL");
    batteryHal = std::make_unique<BatteryMonitorHal>(config.battery);

    // Derive DevEUI from chip ID
    uint8_t devEui[8];
    getDevEuiFromChipId(devEui);
    
    LOGI("Remote", "DevEUI derived from chip ID: %02X:%02X:%02X:%02X:%02X:%02X:%02X:%02X",
         devEui[0], devEui[1], devEui[2], devEui[3],
         devEui[4], devEui[5], devEui[6], devEui[7]);

    // Start radio task (replaces LoRaWAN HAL + CommCoordinator)
    if (!radioTaskStart(devEui, 
                        config.communication.lorawan.appEui, 
                        config.communication.lorawan.appKey,
                        &config.communication.lorawan,
                        &_radioState)) {
        LOGE("Remote", "Failed to start radio task");
        return;
    }
    LOGI("Remote", "Radio task started");

    // OTA receiver: send via radio task TX queue (direct)
    _ota.setTxQueue(_radioState->txQueue);

    setupUi();
    LOGI("Remote", "UI setup complete");

    setupSensors();
    LOGI("Remote", "Sensors setup complete");

    // Build message schema (defines fields and controls)
    _schema = buildDeviceSchema();

    LOGI("Remote", "Schema built: %d fields, %d controls, version %d",
         _schema.field_count, _schema.control_count, _schema.version);

    // RegistrationManager: send via radio task TX queue
    registrationManager.setTxQueue(_radioState->txQueue);
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
        
        // Update LoRaWAN status indicators
        if (_radioState) {
            bool isJoined = _radioState->joined;
            int16_t rssi = _radioState->lastRssi;
            
            lorawanStatusElement->setLoraStatus(isJoined, rssi);
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
                _postJoinStep = 1;
            }
            _prevRegState = registrationManager.getState();
            
            // Update main status text
            if (statusTextElement) {
                char statusStr[48];
                uint32_t up = _radioState->uplinkCount;
                uint32_t dn = _radioState->downlinkCount;
                
                // Simplified status formatting
                if (_ota.isActive()) {
                    snprintf(statusStr, sizeof(statusStr), "OTA %u%%\n%u/%u",
                             (unsigned)_ota.getProgressPercent(),
                             (unsigned)_ota.getNextExpectedIndex(),
                             (unsigned)_ota.getTotalChunks());
                } else if (!isJoined) {
                    snprintf(statusStr, sizeof(statusStr), "Offline\nUp:%lu Dn:%lu", up, dn);
                } else if (registrationManager.getState() == RegistrationManager::State::Sent) {
                    snprintf(statusStr, sizeof(statusStr), "Registering...\nUp:%lu Dn:%lu", up, dn);
                } else if (registrationManager.getState() != RegistrationManager::State::Complete) {
                    snprintf(statusStr, sizeof(statusStr), "Joined\nUp:%lu Dn:%lu", up, dn);
                } else {
                    snprintf(statusStr, sizeof(statusStr), "Ready\nUp:%lu Dn:%lu", up, dn);
                }
                statusTextElement->setText(statusStr);
            }
        }
    }, config.displayUpdateIntervalMs);
    
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
            if (!_radioState || !_radioState->joined) return;

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
        if (!_radioState || !_radioState->joined || registrationManager.getState() != RegistrationManager::State::Complete) return;
        if (!_rulesEngine || !_rulesEngine->hasPendingStateChange()) return;

        const uint8_t maxPayload = 222;  // DR3 max
        if (maxPayload < 11) return;  // Cannot send even one 11-byte event

        size_t max_events = maxPayload / 11;
        uint8_t buffer[256];  // 20*11=220 max; 256 for safety
        size_t max_len = (max_events * 11 < sizeof(buffer)) ? (max_events * 11) : (sizeof(buffer) / 11 * 11);
        size_t num_events = 0;
        size_t len = _rulesEngine->formatStateChangeBatch(buffer, max_len, &num_events);

        if (len > 0 && num_events > 0) {
            LOGI("Remote", "Sending state change batch (%d bytes, %d events): %s",
                 (int)len, (int)num_events, _rulesEngine->stateChangeToText().c_str());

            // Send via TX queue
            if (_radioState && _radioState->txQueue) {
                LoRaWANTxMsg msg;
                msg.port = FPORT_STATE_CHANGE;
                msg.len = len;
                msg.confirmed = true;
                memcpy(msg.payload, buffer, len);
                
                if (xQueueSend(_radioState->txQueue, &msg, 0) == pdTRUE) {
                    _rulesEngine->clearStateChangeBatch(num_events);
                    _rulesEngine->saveStateChangeQueueToFlash();
                    LOGI("Remote", "State change batch sent on fPort %d", FPORT_STATE_CHANGE);
                } else {
                    _sendFailCount++;
                    _persistErrorCount = true;
                    LOGW("Remote", "Failed to send state change batch (queue full)");
                }
            }
        }
    }, 5000);  // Check every 5 seconds

    // No longer need lorawan_join task - radio task handles join automatically

    LOGI("Remote", "Starting scheduler");
    scheduler.start(appState);
    LOGI("Remote", "Scheduler started, initialization complete");
}

void RemoteApplicationImpl::drainNotifications() {
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
    // No longer need deferred join - radio task handles join automatically
    
    drainNotifications();
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
    
    // Process RX queue (non-blocking with short timeout)
    if (_radioState && _radioState->rxQueue) {
        LoRaWANRxMsg rx;
        if (xQueueReceive(_radioState->rxQueue, &rx, pdMS_TO_TICKS(1)) == pdTRUE) {
            onDownlinkReceived(rx.port, rx.payload, rx.len);
        }
    }

    // Post-join sequence: diagnostics then minimal telemetry (ChirpStack sees activity for Class C)
    if (_postJoinStep == 1 && _radioState && _radioState->joined) {
        LOGI("Remote", "Post-join: sending diagnostics (fPort 6)");
        sendDiagnostics();
        _postJoinStep = 2;
    } else if (_postJoinStep == 2 && _radioState && _radioState->joined) {
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
        _postJoinStep = 3;
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

    uint8_t maxPayload = 222;  // DR3 max
    if (offset > (int)maxPayload) {
        LOGW("Remote", "Payload %d bytes exceeds max %d, skipping", offset, maxPayload);
        return;
    }

    LOGD("Remote", "Enqueue telemetry (%d bytes) on fPort %d: %s", offset, FPORT_TELEMETRY, buffer);
    if (_radioState && _radioState->txQueue) {
        LoRaWANTxMsg msg;
        msg.port = FPORT_TELEMETRY;
        msg.len = offset;
        msg.confirmed = config.communication.lorawan.useConfirmedUplinks;
        memcpy(msg.payload, buffer, offset);
        
        if (xQueueSend(_radioState->txQueue, &msg, 0) != pdTRUE) {
            _sendFailCount++;
            _persistErrorCount = true;
            LOGW("Remote", "Failed to enqueue telemetry (queue full)");
        }
    }
}

void RemoteApplicationImpl::sendCommandAck(uint8_t cmdPort, bool success) {
    char buffer[16];
    int len = snprintf(buffer, sizeof(buffer), "%d:%s", cmdPort, success ? "ok" : "err");

    LOGD("Remote", "Enqueue ACK on fPort %d: %s", FPORT_COMMAND_ACK, buffer);
    if (_radioState && _radioState->txQueue) {
        LoRaWANTxMsg msg;
        msg.port = FPORT_COMMAND_ACK;
        msg.len = len;
        msg.confirmed = false;
        memcpy(msg.payload, buffer, len);
        
        if (xQueueSend(_radioState->txQueue, &msg, 0) != pdTRUE) {
            _sendFailCount++;
            _persistErrorCount = true;
            LOGW("Remote", "Failed to enqueue ACK (queue full)");
        }
    }
}

void RemoteApplicationImpl::sendDiagnostics() {
    char buffer[128];

    uint32_t uptimeSec = millis() / 1000;
    int batteryPercent = batteryHal ? batteryHal->getBatteryPercent() : -1;
    int rssi = _radioState ? _radioState->lastRssi : 0;
    float snr = _radioState ? _radioState->lastSnr : 0.0f;
    uint32_t uplinks = _radioState ? _radioState->uplinkCount : 0;
    uint32_t downlinks = _radioState ? _radioState->downlinkCount : 0;

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
    if (_radioState && _radioState->txQueue) {
        LoRaWANTxMsg msg;
        msg.port = FPORT_DIAGNOSTICS;
        msg.len = len;
        msg.confirmed = false;
        memcpy(msg.payload, buffer, len);
        
        if (xQueueSend(_radioState->txQueue, &msg, 0) != pdTRUE) {
            _sendFailCount++;
            _persistErrorCount = true;
            LOGW("Remote", "Failed to enqueue diagnostics (queue full)");
        }
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
            _ota.handleDownlink(port, payload, length);
        }
        return;
    }

    // OTA ports when idle: handle start/chunk/cancel, show one-time notification
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
            // Note: Radio task tracks its own counters, no reset API needed

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
#include "lib/radio_task.cpp"
#include "lib/registration_manager.cpp"
#include "lib/core_config.cpp"
#include "lib/core_system.cpp"
#include "lib/core_scheduler.cpp"
#include "lib/svc_ui.cpp"
#include "lib/ui_battery_icon_element.cpp"
#include "lib/ui_header_status_element.cpp"
#include "lib/ui_main_content_layout.cpp"
#include "lib/ui_screen_layout.cpp"
#include "lib/ui_top_bar_layout.cpp"
#include "sensor_implementations.hpp"
