// MQTT Publisher - Wrapper using 256dpi arduino-mqtt when available
// Falls back to Serial logging if the library is not installed

#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <memory>
#include <MQTT.h>

struct MqttPublisherConfig {
    bool enableMqtt = false;
    const char* brokerHost = "192.168.1.180";
    uint16_t brokerPort = 1883;
    const char* clientId = "device";
    const char* username = nullptr;
    const char* password = nullptr;
    const char* baseTopic = "farm/telemetry";
    const char* deviceTopic = nullptr; // optional suffix override
    uint8_t qos = 0;
    bool retain = false;
    
    // Reliability settings
    uint32_t connectionTimeoutMs = 10000;    // 10 second connection timeout
    uint32_t keepAliveMs = 30;               // 30 second keep alive
    uint32_t retryIntervalMs = 5000;         // Base retry interval
    uint32_t maxRetryIntervalMs = 60000;     // Maximum retry interval (exponential backoff)
    uint8_t maxRetryAttempts = 10;           // Maximum retry attempts
    uint16_t maxQueueSize = 50;              // Maximum queued messages
    bool enableMessageQueue = true;          // Enable message queuing
};

// Connection states for better monitoring
enum class MqttConnectionState {
    Disconnected = 0,
    Connecting = 1,
    Connected = 2,
    Reconnecting = 3,
    Failed = 4
};

// Queued message structure
struct QueuedMessage {
    char topic[128];
    uint8_t payload[256];
    uint8_t length;
    uint8_t qos;
    bool retain;
    uint32_t timestamp;
    uint8_t retryCount;
};

class MqttPublisher {
public:
    explicit MqttPublisher(const MqttPublisherConfig& config)
        : cfg(config) {}
    
    ~MqttPublisher() {
        if (messageQueue) {
            delete[] messageQueue;
            messageQueue = nullptr;
        }
    }

    void begin() {
        if (!cfg.enableMqtt) {
            Serial.println(F("[MQTT] Disabled by config; skipping init"));
            return;
        }
        
        Serial.print(F("[MQTT] Init "));
        Serial.print(F("host=")); Serial.print(cfg.brokerHost ? cfg.brokerHost : "(null)");
        Serial.print(F(" port=")); Serial.print((unsigned)cfg.brokerPort);
        Serial.print(F(" clientId=")); Serial.print(cfg.clientId ? cfg.clientId : "(null)");
        Serial.print(F(" baseTopic=")); Serial.print(cfg.baseTopic ? cfg.baseTopic : "(null)");
        Serial.print(F(" deviceTopic=")); Serial.print((cfg.deviceTopic && cfg.deviceTopic[0] != '\0') ? cfg.deviceTopic : "(auto)");
        Serial.print(F(" qos=")); Serial.print((unsigned)cfg.qos);
        Serial.print(F(" retain=")); Serial.println(cfg.retain ? F("true") : F("false"));
        
        // Initialize message queue if enabled
        if (cfg.enableMessageQueue && cfg.maxQueueSize > 0) {
            messageQueue = new QueuedMessage[cfg.maxQueueSize];
            if (!messageQueue) {
                Serial.println(F("[MQTT] ERROR: Failed to allocate message queue"));
                cfg.enableMessageQueue = false;
            } else {
                Serial.printf("[MQTT] Message queue initialized with %u slots\n", cfg.maxQueueSize);
            }
        }
        
        wifiClient = std::make_unique<WiFiClient>();
        client = std::make_unique<MQTTClient>();
        client->begin(cfg.brokerHost, cfg.brokerPort, *wifiClient);
        
        // Use configurable timings for better reliability
        client->setOptions(cfg.keepAliveMs, true, cfg.connectionTimeoutMs);
        
        // Initialize state
        connectionState = MqttConnectionState::Disconnected;
        lastConnAttemptMs = 0;
        currentRetryInterval = cfg.retryIntervalMs;
        retryAttempts = 0;
        
        Serial.printf("[MQTT] Connection timeout: %ums, Keep alive: %ums\n", 
                     cfg.connectionTimeoutMs, cfg.keepAliveMs);
        Serial.println("[MQTT] MQTT publisher initialization complete");
    }

    void update(uint32_t nowMs) {
        if (!cfg.enableMqtt) return;
        
        bool wifiUp = (WiFi.status() == WL_CONNECTED);
        if (wifiUp != lastWifiConnected) {
            Serial.printf("[MQTT] WiFi %s\n", wifiUp ? "CONNECTED" : "DISCONNECTED");
            lastWifiConnected = wifiUp;
            
            // If WiFi disconnected, mark MQTT as disconnected
            if (!wifiUp && connectionState == MqttConnectionState::Connected) {
                connectionState = MqttConnectionState::Disconnected;
                lastMqttConnected = false;
            }
        }
        
        if (!wifiUp) {
            connectionState = MqttConnectionState::Disconnected;
            return;
        }
        
        if (client) {
            bool mqttUp = client->connected();
            if (mqttUp != lastMqttConnected) {
                if (mqttUp) {
                    Serial.printf("[MQTT] SESSION CONNECTED (attempt %u)\n", retryAttempts);
                    connectionState = MqttConnectionState::Connected;
                    lastConnectionTime = nowMs;
                    retryAttempts = 0;
                    currentRetryInterval = cfg.retryIntervalMs; // Reset retry interval
                } else {
                    Serial.printf("[MQTT] SESSION DISCONNECTED\n");
                    connectionState = MqttConnectionState::Disconnected;
                }
                lastMqttConnected = mqttUp;
            }
            
            if (!mqttUp) {
                // Handle reconnection with exponential backoff
                if ((int32_t)(nowMs - lastConnAttemptMs) >= (int32_t)currentRetryInterval) {
                    if (retryAttempts < cfg.maxRetryAttempts) {
                        connectionState = MqttConnectionState::Reconnecting;
                        Serial.printf("[MQTT] Reconnection attempt %u/%u (interval: %ums)\n", 
                                     retryAttempts + 1, cfg.maxRetryAttempts, currentRetryInterval);
                        yield();
                        reconnect();
                        yield();
                        
                        retryAttempts++;
                        lastConnAttemptMs = nowMs;
                        
                        // Exponential backoff with jitter
                        currentRetryInterval = min(cfg.maxRetryIntervalMs, 
                                                 currentRetryInterval * 2 + (random(0, 1000)));
                    } else {
                        connectionState = MqttConnectionState::Failed;
                        Serial.printf("[MQTT] Max retry attempts (%u) reached. Marking as failed.\n", 
                                     cfg.maxRetryAttempts);
                        lastConnAttemptMs = nowMs + 30000; // Wait 30s before trying again
                        retryAttempts = 0; // Reset for next cycle
                        currentRetryInterval = cfg.retryIntervalMs;
                    }
                }
                return;
            }
            
            // Process message queue if connected
            if (mqttUp && cfg.enableMessageQueue && queuedMessageCount > 0) {
                processMessageQueue(nowMs);
            }
            
            client->loop();
        }
    }

    bool isReady() const {
        if (!cfg.enableMqtt) return false;
        if (WiFi.status() != WL_CONNECTED) return false;
        return client && client->connected();
    }

    bool isConnected() const {
        if (!cfg.enableMqtt) return false;
        return client && client->connected();
    }

    // Enhanced monitoring methods
    MqttConnectionState getConnectionState() const {
        return connectionState;
    }

    uint32_t getRetryAttempts() const {
        return retryAttempts;
    }

    uint32_t getLastConnectionTime() const {
        return lastConnectionTime;
    }

    uint16_t getQueuedMessageCount() const {
        return queuedMessageCount;
    }

    uint32_t getSuccessfulPublishes() const {
        return statsSuccessfulPublishes;
    }

    uint32_t getFailedPublishes() const {
        return statsFailedPublishes;
    }

    // Force reconnection
    void forceReconnect() {
        if (client && client->connected()) {
            client->disconnect();
        }
        connectionState = MqttConnectionState::Disconnected;
        lastConnAttemptMs = 0; // Allow immediate retry
    }

    // Clear message queue
    void clearQueue() {
        queuedMessageCount = 0;
        queueHead = 0;
        queueTail = 0;
    }

    // Publish using baseTopic + "/" + topicSuffix
    bool publish(const char* topicSuffix, const uint8_t* payload, uint8_t length) {
        if (!cfg.enableMqtt) {
            LOGW("MQTT", "Publish failed: MQTT disabled by config");
            return false;
        }
        if (!payload || length == 0) {
            LOGW("MQTT", "Publish failed: payload is empty");
            return false;
        }
        if (length > 255) {
            LOGW("MQTT", "Publish failed: payload too large (%u bytes, max 255)", length);
            return false;
        }
        
        char topic[128];
        if (cfg.deviceTopic && cfg.deviceTopic[0] != '\0') {
            snprintf(topic, sizeof(topic), "%s/%s", cfg.baseTopic ? cfg.baseTopic : "farm/telemetry", cfg.deviceTopic);
        } else if (topicSuffix && topicSuffix[0] != '\0') {
            snprintf(topic, sizeof(topic), "%s/%s", cfg.baseTopic ? cfg.baseTopic : "farm/telemetry", topicSuffix);
        } else {
            snprintf(topic, sizeof(topic), "%s", cfg.baseTopic ? cfg.baseTopic : "farm/telemetry");
        }

        // Try immediate publish if connected
        if (client && client->connected()) {
            bool ok = client->publish(topic, (const char*)payload, (int)length, cfg.retain, (int)cfg.qos);
            if (ok) {
                LOGD("MQTT", "Published %u bytes to %s", (unsigned)length, topic);
                statsSuccessfulPublishes++;
                return true;
            } else {
                LOGW("MQTT", "Publish failed to %s", topic);
                statsFailedPublishes++;
            }
        }
        
        // If not connected or publish failed, queue the message if queuing is enabled
        if (cfg.enableMessageQueue && messageQueue) {
            if (queuedMessageCount < cfg.maxQueueSize) {
                QueuedMessage& msg = messageQueue[queueTail];
                strncpy(msg.topic, topic, sizeof(msg.topic) - 1);
                msg.topic[sizeof(msg.topic) - 1] = '\0';
                memcpy(msg.payload, payload, length);
                msg.length = length;
                msg.qos = cfg.qos;
                msg.retain = cfg.retain;
                msg.timestamp = millis();
                msg.retryCount = 0;
                
                queueTail = (queueTail + 1) % cfg.maxQueueSize;
                queuedMessageCount++;
                
                LOGD("MQTT", "Queued %u bytes to %s (queue size: %u)", length, topic, queuedMessageCount);
                return true; // Consider queued as successful
            } else {
                LOGW("MQTT", "Message queue full, dropping message to %s", topic);
                statsFailedPublishes++;
                return false;
            }
        }
        
        LOGW("MQTT", "Publish failed: MQTT not connected and queuing disabled");
        statsFailedPublishes++;
        return false;
    }

private:
    MqttPublisherConfig cfg;
    uint32_t lastConnAttemptMs = 0;
    bool lastWifiConnected = false;
    bool lastMqttConnected = false;
    std::unique_ptr<WiFiClient> wifiClient;
    std::unique_ptr<MQTTClient> client;

    // Enhanced state tracking
    MqttConnectionState connectionState = MqttConnectionState::Disconnected;
    uint32_t retryAttempts = 0;
    uint32_t lastConnectionTime = 0;
    uint32_t currentRetryInterval = 0;

    // Message queue for reliability
    QueuedMessage* messageQueue = nullptr;
    uint16_t queueHead = 0;
    uint16_t queueTail = 0;
    uint16_t queuedMessageCount = 0;

    // Statistics
    uint32_t statsSuccessfulPublishes = 0;
    uint32_t statsFailedPublishes = 0;

    void reconnect() {
        if (!client) return;
        
        // Use configurable timeout for better reliability
        client->setOptions(cfg.keepAliveMs, true, cfg.connectionTimeoutMs);
        
        Serial.printf("[MQTT] Connecting to %s:%u as %s...\n", 
                     cfg.brokerHost, (unsigned)cfg.brokerPort, 
                     cfg.clientId ? cfg.clientId : "device");
        
        bool ok;
        if (cfg.username && cfg.password) {
            ok = client->connect(cfg.clientId ? cfg.clientId : "device", cfg.username, cfg.password);
        } else if (cfg.username && !cfg.password) {
            ok = client->connect(cfg.clientId ? cfg.clientId : "device", cfg.username, "");
        } else {
            ok = client->connect(cfg.clientId ? cfg.clientId : "device");
        }
        
        if (ok) {
            Serial.println(F("[MQTT] Connected successfully"));
        } else {
            // Print detailed error information for troubleshooting
            int err = (int)client->lastError();
            int rc = (int)client->returnCode();
            Serial.printf("[MQTT] Connect failed (err=%d rc=%d)\n", err, rc);
            
            // Provide more specific error messages
            switch (rc) {
                case -2: Serial.println(F("[MQTT] Connection timeout")); break;
                case -1: Serial.println(F("[MQTT] Connection refused")); break;
                case 1: Serial.println(F("[MQTT] Unacceptable protocol version")); break;
                case 2: Serial.println(F("[MQTT] Identifier rejected")); break;
                case 3: Serial.println(F("[MQTT] Server unavailable")); break;
                case 4: Serial.println(F("[MQTT] Bad username/password")); break;
                case 5: Serial.println(F("[MQTT] Not authorized")); break;
                default: Serial.printf("[MQTT] Unknown error code: %d\n", rc); break;
            }
        }
    }

    void processMessageQueue(uint32_t nowMs) {
        if (!messageQueue || queuedMessageCount == 0) return;
        
        // Process up to 5 messages per update to avoid blocking
        uint8_t processed = 0;
        while (queuedMessageCount > 0 && processed < 5) {
            QueuedMessage& msg = messageQueue[queueHead];
            
            // Check if message is too old (older than 5 minutes)
            if ((nowMs - msg.timestamp) > 300000) {
                Serial.printf("[MQTT] Dropping old queued message to %s (age: %ums)\n", 
                             msg.topic, nowMs - msg.timestamp);
                queueHead = (queueHead + 1) % cfg.maxQueueSize;
                queuedMessageCount--;
                processed++;
                continue;
            }
            
            // Try to publish the queued message
            bool ok = client->publish(msg.topic, (const char*)msg.payload, msg.length, msg.retain, msg.qos);
            if (ok) {
                Serial.printf("[MQTT] Published queued message to %s (%u bytes)\n", 
                             msg.topic, msg.length);
                statsSuccessfulPublishes++;
                queueHead = (queueHead + 1) % cfg.maxQueueSize;
                queuedMessageCount--;
            } else {
                msg.retryCount++;
                if (msg.retryCount >= 3) {
                    Serial.printf("[MQTT] Dropping queued message to %s after %u retries\n", 
                                 msg.topic, msg.retryCount);
                    statsFailedPublishes++;
                    queueHead = (queueHead + 1) % cfg.maxQueueSize;
                    queuedMessageCount--;
                }
                break; // Stop processing if we can't publish
            }
            processed++;
        }
    }
};


