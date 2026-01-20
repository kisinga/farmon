#include "hal_lorawan.h"
#include "core_logger.h"

// Include Heltec library which provides the radio instance
#include <heltec_unofficial.h>
#include <RadioLib.h>

// LoRaWAN regional settings - US915 with sub-band 2 for most US networks
static const LoRaWANBand_t* region = &US915;
static const uint8_t subBand = 2;

// Static node instance
static LoRaWANNode* loraNode = nullptr;

// Downlink buffer
static uint8_t downlinkBuffer[256];
static size_t downlinkLength = 0;
static uint8_t downlinkPort = 0;
static bool hasDownlink = false;

LoRaWANHal::LoRaWANHal() {
    memset(storedDevEui, 0, sizeof(storedDevEui));
    memset(storedAppEui, 0, sizeof(storedAppEui));
    memset(storedAppKey, 0, sizeof(storedAppKey));
}

LoRaWANHal::~LoRaWANHal() {
    if (loraNode) {
        delete loraNode;
        loraNode = nullptr;
    }
}

bool LoRaWANHal::begin(const uint8_t* devEui, const uint8_t* appEui, const uint8_t* appKey) {
    if (initialized) {
        LOGW("LoRaWAN", "Already initialized");
        return false;
    }

    LOGI("LoRaWAN", "Initializing RadioLib HAL...");

    // Store credentials for later use
    memcpy(storedDevEui, devEui, 8);
    memcpy(storedAppEui, appEui, 8);
    memcpy(storedAppKey, appKey, 16);

    // Log the DevEUI being used
    LOGI("LoRaWAN", "DevEUI: %02X:%02X:%02X:%02X:%02X:%02X:%02X:%02X",
         devEui[0], devEui[1], devEui[2], devEui[3],
         devEui[4], devEui[5], devEui[6], devEui[7]);

    // Initialize the radio (provided by heltec_unofficial.h)
    LOGI("LoRaWAN", "Initializing SX1262 radio...");
    int16_t state = radio.begin();
    if (state != RADIOLIB_ERR_NONE) {
        LOGE("LoRaWAN", "Radio init failed with code %d", state);
        return false;
    }
    LOGI("LoRaWAN", "Radio initialized successfully");

    // Create LoRaWAN node
    loraNode = new LoRaWANNode(&radio, region, subBand);
    node = loraNode;

    // Convert 8-byte arrays to uint64_t for RadioLib API
    uint64_t devEui64 = 0;
    uint64_t joinEui64 = 0;
    for (int i = 0; i < 8; i++) {
        devEui64 = (devEui64 << 8) | devEui[i];
        joinEui64 = (joinEui64 << 8) | appEui[i];
    }

    // Setup OTAA credentials
    // For LoRaWAN 1.0.x, nwkKey and appKey are the same
    state = node->beginOTAA(joinEui64, devEui64, (uint8_t*)appKey, (uint8_t*)appKey);
    if (state != RADIOLIB_ERR_NONE) {
        LOGE("LoRaWAN", "OTAA setup failed with code %d", state);
        return false;
    }

    initialized = true;
    LOGI("LoRaWAN", "HAL initialized - call join() to connect to network");

    return true;
}

void LoRaWANHal::tick(uint32_t nowMs) {
    if (!initialized) return;

    // Check if join is in progress and we should retry
    if (joinInProgress && !joined) {
        // The join is handled synchronously in join(), so nothing to do here
        // But we can check for timeout
        if (lastJoinAttemptMs > 0 && (nowMs - lastJoinAttemptMs) > 30000) {
            LOGW("LoRaWAN", "Join attempt timed out");
            joinInProgress = false;
            connectionState = ConnectionState::Disconnected;
        }
    }

    // Update connection state
    if (joined) {
        if (connectionState != ConnectionState::Connected) {
            connectionState = ConnectionState::Connected;
            LOGI("LoRaWAN", "Connected to network");
        }
    }

    // Process any pending downlinks
    if (hasDownlink && onDataCb) {
        onDataCb(downlinkPort, downlinkBuffer, downlinkLength);
        hasDownlink = false;
    }
}

bool LoRaWANHal::sendData(uint8_t port, const uint8_t *payload, uint8_t length, bool confirmed) {
    if (!initialized || !joined || !node) {
        LOGW("LoRaWAN", "Not initialized or not joined");
        return false;
    }

    if (length > 242) {
        LOGW("LoRaWAN", "Payload too large: %d bytes", length);
        return false;
    }

    LOGD("LoRaWAN", "Sending %d bytes on port %d (confirmed: %s)",
         length, port, confirmed ? "true" : "false");

    // Prepare downlink buffer
    downlinkLength = sizeof(downlinkBuffer);

    // Send uplink and wait for downlink
    int16_t state;
    if (confirmed) {
        state = node->sendReceive((uint8_t*)payload, length, port, downlinkBuffer, &downlinkLength, true);
    } else {
        state = node->sendReceive((uint8_t*)payload, length, port, downlinkBuffer, &downlinkLength, false);
    }

    if (state == RADIOLIB_ERR_NONE) {
        LOGD("LoRaWAN", "Uplink sent, no downlink received");
        uplinkCount++;
        lastActivityMs = millis();
        if (onTxDoneCb) onTxDoneCb();
        return true;
    } else if (state > 0) {
        // Positive values indicate downlink received in Rx window 1 or 2
        LOGI("LoRaWAN", "Uplink sent, downlink received (%d bytes)", (int)downlinkLength);
        uplinkCount++;
        downlinkCount++;
        lastActivityMs = millis();

        // Get RSSI/SNR from last reception
        lastRssiDbm = radio.getRSSI();
        lastSnr = radio.getSNR();

        // Queue downlink for processing in tick()
        if (downlinkLength > 0) {
            hasDownlink = true;
            downlinkPort = port; // RadioLib doesn't expose downlink port easily
        }

        if (onTxDoneCb) onTxDoneCb();
        return true;
    } else {
        LOGW("LoRaWAN", "sendReceive failed with code %d", state);
        if (onTxTimeoutCb) onTxTimeoutCb();
        return false;
    }
}

bool LoRaWANHal::isReadyForTx() const {
    return initialized && joined;
}

void LoRaWANHal::setOnDataReceived(OnDataReceived cb) {
    onDataCb = cb;
}

void LoRaWANHal::setOnTxDone(OnTxDone cb) {
    onTxDoneCb = cb;
}

void LoRaWANHal::setOnTxTimeout(OnTxTimeout cb) {
    onTxTimeoutCb = cb;
}

bool LoRaWANHal::isConnected() const {
    return connectionState == ConnectionState::Connected;
}

ILoRaWANHal::ConnectionState LoRaWANHal::getConnectionState() const {
    return connectionState;
}

int16_t LoRaWANHal::getLastRssiDbm() const {
    return lastRssiDbm;
}

int8_t LoRaWANHal::getLastSnr() const {
    return lastSnr;
}

void LoRaWANHal::setDeviceClass(uint8_t deviceClass) {
    // RadioLib handles device class internally
    LOGD("LoRaWAN", "Device class setting: %d (RadioLib uses Class A by default)", deviceClass);
}

void LoRaWANHal::setDataRate(uint8_t dataRate) {
    if (node) {
        node->setDatarate(dataRate);
        LOGI("LoRaWAN", "Data rate set to %d", dataRate);
    }
}

void LoRaWANHal::setTxPower(uint8_t txPower) {
    if (node) {
        node->setTxPower(txPower);
        LOGI("LoRaWAN", "TX power set to %d dBm", txPower);
    }
}

void LoRaWANHal::setAdr(bool enable) {
    if (node) {
        node->setADR(enable);
        LOGI("LoRaWAN", "ADR %s", enable ? "enabled" : "disabled");
    }
}

bool LoRaWANHal::isJoined() const {
    return initialized && joined;
}

void LoRaWANHal::join() {
    if (!initialized || !node) {
        LOGE("LoRaWAN", "Not initialized");
        return;
    }

    if (joined) {
        LOGI("LoRaWAN", "Already joined");
        return;
    }

    LOGI("LoRaWAN", "Starting OTAA join process...");
    connectionState = ConnectionState::Connecting;
    joinInProgress = true;
    lastJoinAttemptMs = millis();

    // Attempt to activate (join) the network
    // This is a blocking call that may take several seconds
    int16_t state = node->activateOTAA();

    if (state == RADIOLIB_LORAWAN_NEW_SESSION || state == RADIOLIB_LORAWAN_SESSION_RESTORED) {
        joined = true;
        joinInProgress = false;
        connectionState = ConnectionState::Connected;
        LOGI("LoRaWAN", "Successfully joined network (state: %d)", state);
    } else {
        joined = false;
        joinInProgress = false;
        connectionState = ConnectionState::Disconnected;
        LOGW("LoRaWAN", "Join failed with code %d", state);
    }
}

void LoRaWANHal::forceReconnect() {
    if (!initialized) return;

    LOGI("LoRaWAN", "Forcing reconnect...");
    joined = false;
    connectionState = ConnectionState::Disconnected;
    join();
}

uint32_t LoRaWANHal::getUplinkCount() const {
    return uplinkCount;
}

uint32_t LoRaWANHal::getDownlinkCount() const {
    return downlinkCount;
}

void LoRaWANHal::resetCounters() {
    uplinkCount = 0;
    downlinkCount = 0;
    LOGI("LoRaWAN", "Counters reset");
}
