#pragma once

#include "message_schema.h"
#include "hal_persistence.h"
#include "core_logger.h"
#include "control_driver.h"
#include <cstring>

// =============================================================================
// Edge Rules Engine
// =============================================================================
// Lightweight rules engine that evaluates sensor readings and triggers control
// actions locally on the device. Uses MessageSchema indices for compact
// rule representation.
//
// Design principles:
// - Schema-indexed references (compact, validated)
// - Composable control execution (function pointers)
// - Binary persistence to NVS
// - State change queue (ring buffer) for uplink; batch within LoRaWAN payload limit
// =============================================================================

namespace EdgeRules {

static constexpr size_t STATE_CHANGE_QUEUE_CAP = 20;  // 20 * 11 bytes = 220, fits max DR payload

// Rule operator for condition evaluation
enum class RuleOperator : uint8_t {
    LT = 0,   // <
    GT = 1,   // >
    LTE = 2,  // <=
    GTE = 3,  // >=
    EQ = 4,   // ==
    NEQ = 5   // !=
};

// What triggered a state change
enum class TriggerSource : uint8_t {
    BOOT = 0,     // Initial state on boot
    RULE = 1,     // Rule evaluation triggered it
    MANUAL = 2,   // Manual override from UI
    DOWNLINK = 3  // Direct control via downlink
};

// -----------------------------------------------------------------------------
// EdgeRule - compact rule representation using schema indices
// -----------------------------------------------------------------------------
// Binary format for downlink (fPort 30) - 12 bytes:
// [0]    rule_id
// [1]    flags: [enabled:1][operator:3][reserved:4]
// [2]    field_idx
// [3-6]  threshold (float LE)
// [7]    control_idx
// [8]    action_state
// [9-10] cooldown_sec (uint16 LE)
// [11]   priority
// -----------------------------------------------------------------------------
struct EdgeRule {
    uint8_t id;             // Rule ID (0-254, 255 reserved)
    uint8_t field_idx;      // Index into schema.fields[]
    uint8_t control_idx;    // Index into schema.controls[]
    uint8_t action_state;   // Index into control's states[]
    RuleOperator op;        // Comparison operator
    uint8_t priority;       // 0 = highest priority
    uint16_t cooldown_sec;  // Minimum time between triggers
    float threshold;        // Value to compare against
    uint32_t last_triggered_ms; // Timestamp of last trigger (runtime only)
    bool enabled;           // Is this rule active?

    // Parse rule from binary payload (12 bytes)
    bool fromBinary(const uint8_t* data, size_t len) {
        if (len < 12) return false;

        id = data[0];
        enabled = (data[1] & 0x80) != 0;
        op = static_cast<RuleOperator>((data[1] >> 4) & 0x07);
        field_idx = data[2];
        memcpy(&threshold, data + 3, sizeof(float));
        control_idx = data[7];
        action_state = data[8];
        cooldown_sec = data[9] | (data[10] << 8);
        priority = data[11];
        last_triggered_ms = 0;

        return true;
    }

    // Serialize rule to binary (12 bytes)
    size_t toBinary(uint8_t* buf, size_t max_len) const {
        if (max_len < 12) return 0;

        buf[0] = id;
        buf[1] = (enabled ? 0x80 : 0) | ((static_cast<uint8_t>(op) & 0x07) << 4);
        buf[2] = field_idx;
        memcpy(buf + 3, &threshold, sizeof(float));
        buf[7] = control_idx;
        buf[8] = action_state;
        buf[9] = cooldown_sec & 0xFF;
        buf[10] = (cooldown_sec >> 8) & 0xFF;
        buf[11] = priority;

        return 12;
    }

    // Human-readable representation for debugging
    String toText() const {
        char buf[128];
        const char* op_str[] = {"<", ">", "<=", ">=", "==", "!="};
        snprintf(buf, sizeof(buf), "rule[%d]: f%d %s %.2f -> c%d:s%d (pri=%d, cd=%ds, en=%d)",
                 id, field_idx, op_str[static_cast<int>(op)], threshold,
                 control_idx, action_state, priority, cooldown_sec, enabled);
        return String(buf);
    }
};

// -----------------------------------------------------------------------------
// ControlState - current state of a control
// -----------------------------------------------------------------------------
struct ControlState {
    uint8_t current_state;      // Current state index
    bool is_manual;             // Manual override active
    uint32_t manual_until_ms;   // When manual override expires (0 = indefinite)
};

// -----------------------------------------------------------------------------
// StateChange - pending state change to transmit
// -----------------------------------------------------------------------------
// Binary format for uplink (fPort 3) - 11 bytes:
// [0]    control_idx
// [1]    new_state
// [2]    old_state
// [3]    trigger_source
// [4]    rule_id (if source=RULE, else 0)
// [5-8]  device_ms (uint32 LE)
// [9-10] sequence_id (uint16 LE)
// -----------------------------------------------------------------------------
struct StateChange {
    uint8_t control_idx;
    uint8_t new_state;
    uint8_t old_state;
    TriggerSource source;
    uint8_t rule_id;
    uint32_t device_ms;
    uint16_t sequence_id;

    size_t toBinary(uint8_t* buf, size_t max_len) const {
        if (max_len < 11) return 0;

        buf[0] = control_idx;
        buf[1] = new_state;
        buf[2] = old_state;
        buf[3] = static_cast<uint8_t>(source);
        buf[4] = rule_id;
        memcpy(buf + 5, &device_ms, sizeof(uint32_t));
        buf[9] = sequence_id & 0xFF;
        buf[10] = (sequence_id >> 8) & 0xFF;

        return 11;
    }

    bool fromBinary(const uint8_t* buf, size_t len) {
        if (len < 11) return false;
        control_idx = buf[0];
        new_state = buf[1];
        old_state = buf[2];
        source = static_cast<TriggerSource>(buf[3]);
        rule_id = buf[4];
        memcpy(&device_ms, buf + 5, sizeof(uint32_t));
        sequence_id = static_cast<uint16_t>(buf[9] | (buf[10] << 8));
        return true;
    }

    String toText() const {
        char buf[128];
        const char* src_str[] = {"BOOT", "RULE", "MANUAL", "DOWNLINK"};
        snprintf(buf, sizeof(buf), "ctrl[%d]: %d->%d (src=%s, rule=%d, seq=%d)",
                 control_idx, old_state, new_state, src_str[static_cast<int>(source)],
                 rule_id, sequence_id);
        return String(buf);
    }
};

// Function pointer type for control execution
using ControlExecuteFn = bool(*)(uint8_t state_idx);

// -----------------------------------------------------------------------------
// EdgeRulesEngine - main rules engine class
// -----------------------------------------------------------------------------
class EdgeRulesEngine {
public:
    static constexpr uint8_t MAX_RULES = 32;
    static constexpr uint8_t MAX_CONTROLS = 16;
    static constexpr const char* PERSISTENCE_NAMESPACE = "rules";
    static constexpr const char* PERSISTENCE_KEY_COUNT = "count";
    static constexpr const char* PERSISTENCE_KEY_DATA = "data";
    static constexpr const char* PERSISTENCE_KEY_SC_COUNT = "sc_count";
    static constexpr const char* PERSISTENCE_KEY_SC_DATA = "sc_data";

    EdgeRulesEngine(const MessageSchema::Schema& schema, IPersistenceHal* persistence)
        : _schema(schema), _persistence(persistence), _rule_count(0),
          _queue_head(0), _queue_count(0), _sequence_id(0) {
        // Initialize control states
        for (uint8_t i = 0; i < MAX_CONTROLS; i++) {
            _control_states[i] = {0, false, 0};
            _executors[i] = nullptr;
            _drivers[i] = nullptr;
        }
    }

    // -------------------------------------------------------------------------
    // Rule Management
    // -------------------------------------------------------------------------

    // Add or update a rule from binary payload
    bool addOrUpdateRule(const uint8_t* payload, size_t len) {
        if (len < 12) {
            LOGW("Rules", "Invalid rule payload length: %d", len);
            return false;
        }

        EdgeRule rule;
        if (!rule.fromBinary(payload, len)) {
            LOGW("Rules", "Failed to parse rule");
            return false;
        }

        // Validate indices against schema
        if (!_schema.isValidFieldIndex(rule.field_idx)) {
            LOGW("Rules", "Invalid field index: %d", rule.field_idx);
            return false;
        }
        if (!_schema.isValidControlIndex(rule.control_idx)) {
            LOGW("Rules", "Invalid control index: %d", rule.control_idx);
            return false;
        }
        if (!_schema.isValidStateIndex(rule.control_idx, rule.action_state)) {
            LOGW("Rules", "Invalid state index: %d for control %d",
                 rule.action_state, rule.control_idx);
            return false;
        }

        // Find existing rule or add new
        int existing = findRuleById(rule.id);
        if (existing >= 0) {
            _rules[existing] = rule;
            LOGI("Rules", "Updated %s", rule.toText().c_str());
        } else {
            if (_rule_count >= MAX_RULES) {
                LOGW("Rules", "Max rules reached (%d)", MAX_RULES);
                return false;
            }
            _rules[_rule_count++] = rule;
            LOGI("Rules", "Added %s", rule.toText().c_str());
        }

        return true;
    }

    // Delete a rule by ID
    bool deleteRule(uint8_t id) {
        int idx = findRuleById(id);
        if (idx < 0) {
            LOGW("Rules", "Rule %d not found for deletion", id);
            return false;
        }

        // Shift remaining rules
        for (int i = idx; i < _rule_count - 1; i++) {
            _rules[i] = _rules[i + 1];
        }
        _rule_count--;

        LOGI("Rules", "Deleted rule %d", id);
        return true;
    }

    // Clear all rules
    void clearAllRules() {
        _rule_count = 0;
        LOGI("Rules", "Cleared all rules");
    }

    // Get rule count
    uint8_t getRuleCount() const { return _rule_count; }

    // -------------------------------------------------------------------------
    // Rule Evaluation
    // -------------------------------------------------------------------------

    // Evaluate all rules against current field values
    void evaluate(const float* field_values, uint8_t field_count, uint32_t now_ms) {
        if (_rule_count == 0) return;

        // Collect triggered rules, grouped by control
        struct TriggeredRule {
            uint8_t rule_idx;
            uint8_t priority;
        };
        TriggeredRule triggered[MAX_RULES];
        uint8_t triggered_count = 0;

        for (uint8_t i = 0; i < _rule_count; i++) {
            const EdgeRule& rule = _rules[i];

            // Skip disabled rules
            if (!rule.enabled) continue;

            // Skip if field index out of range
            if (rule.field_idx >= field_count) continue;

            // Check cooldown
            if (rule.last_triggered_ms > 0 &&
                (now_ms - rule.last_triggered_ms) < (rule.cooldown_sec * 1000)) {
                continue;
            }

            // Skip if control is in manual mode
            if (isManualOverride(rule.control_idx, now_ms)) {
                continue;
            }

            // Evaluate condition
            float value = field_values[rule.field_idx];
            if (evaluateCondition(rule.op, value, rule.threshold)) {
                triggered[triggered_count++] = {i, rule.priority};
            }
        }

        if (triggered_count == 0) return;

        // Group by control and pick highest priority for each
        // (simple approach: iterate and update if higher priority)
        uint8_t best_rule_for_control[MAX_CONTROLS];
        uint8_t best_priority_for_control[MAX_CONTROLS];
        for (uint8_t i = 0; i < MAX_CONTROLS; i++) {
            best_rule_for_control[i] = 0xFF;  // Invalid
            best_priority_for_control[i] = 0xFF;
        }

        for (uint8_t i = 0; i < triggered_count; i++) {
            uint8_t rule_idx = triggered[i].rule_idx;
            uint8_t ctrl_idx = _rules[rule_idx].control_idx;
            uint8_t priority = triggered[i].priority;

            if (best_rule_for_control[ctrl_idx] == 0xFF ||
                priority < best_priority_for_control[ctrl_idx]) {
                best_rule_for_control[ctrl_idx] = rule_idx;
                best_priority_for_control[ctrl_idx] = priority;
            }
        }

        // Execute winning rules
        for (uint8_t ctrl_idx = 0; ctrl_idx < MAX_CONTROLS; ctrl_idx++) {
            if (best_rule_for_control[ctrl_idx] == 0xFF) continue;

            uint8_t rule_idx = best_rule_for_control[ctrl_idx];
            EdgeRule& rule = _rules[rule_idx];

            // Only act if state is different
            if (_control_states[ctrl_idx].current_state != rule.action_state) {
                executeAction(ctrl_idx, rule.action_state, TriggerSource::RULE, rule.id, now_ms);
                rule.last_triggered_ms = now_ms;
            }
        }
    }

    // -------------------------------------------------------------------------
    // State Management
    // -------------------------------------------------------------------------

    // Set control state (from any source)
    bool setControlState(uint8_t ctrl_idx, uint8_t state_idx, TriggerSource source,
                         uint8_t rule_id, uint32_t now_ms) {
        if (ctrl_idx >= MAX_CONTROLS) return false;
        if (!_schema.isValidControlIndex(ctrl_idx)) return false;
        if (!_schema.isValidStateIndex(ctrl_idx, state_idx)) return false;

        uint8_t old_state = _control_states[ctrl_idx].current_state;
        if (old_state == state_idx) return true;  // No change needed

        // Record state change
        _control_states[ctrl_idx].current_state = state_idx;

        // Queue state change for transmission (drop oldest if full so latest is kept)
        StateChange change = {
            ctrl_idx,
            state_idx,
            old_state,
            source,
            rule_id,
            now_ms,
            _sequence_id++
        };
        if (_queue_count >= STATE_CHANGE_QUEUE_CAP) {
            _queue_head = (_queue_head + 1) % STATE_CHANGE_QUEUE_CAP;
            _queue_count--;
            LOGW("Rules", "State change queue full, dropped oldest");
        }
        size_t write_idx = (_queue_head + _queue_count) % STATE_CHANGE_QUEUE_CAP;
        _state_change_queue[write_idx] = change;
        _queue_count++;

        LOGI("Rules", "State change: %s", change.toText().c_str());
        return true;
    }

    // Set manual override for a control
    void setManualOverride(uint8_t ctrl_idx, uint32_t duration_ms, uint32_t now_ms) {
        if (ctrl_idx >= MAX_CONTROLS) return;

        _control_states[ctrl_idx].is_manual = true;
        _control_states[ctrl_idx].manual_until_ms = (duration_ms > 0) ? now_ms + duration_ms : 0;

        LOGI("Rules", "Manual override set for control %d, duration=%dms", ctrl_idx, duration_ms);
    }

    // Clear manual override for a control
    void clearManualOverride(uint8_t ctrl_idx) {
        if (ctrl_idx >= MAX_CONTROLS) return;

        _control_states[ctrl_idx].is_manual = false;
        _control_states[ctrl_idx].manual_until_ms = 0;

        LOGI("Rules", "Manual override cleared for control %d", ctrl_idx);
    }

    // Check if control is in manual override
    bool isManualOverride(uint8_t ctrl_idx, uint32_t now_ms) const {
        if (ctrl_idx >= MAX_CONTROLS) return false;

        const ControlState& state = _control_states[ctrl_idx];
        if (!state.is_manual) return false;
        if (state.manual_until_ms == 0) return true;  // Indefinite
        return now_ms < state.manual_until_ms;
    }

    // Get current control state
    ControlState getControlState(uint8_t ctrl_idx) const {
        if (ctrl_idx >= MAX_CONTROLS) return {0, false, 0};
        return _control_states[ctrl_idx];
    }

    // -------------------------------------------------------------------------
    // Control Execution
    // -------------------------------------------------------------------------

    // Register a control executor function
    void registerControl(uint8_t idx, ControlExecuteFn execute) {
        if (idx >= MAX_CONTROLS) {
            LOGW("Rules", "Invalid control index for registration: %d", idx);
            return;
        }
        _drivers[idx] = nullptr;
        _executors[idx] = execute;
        LOGI("Rules", "Registered executor for control %d", idx);
    }

    // Register a control driver (reusable module or integration)
    void registerControl(uint8_t idx, IControlDriver* driver) {
        if (idx >= MAX_CONTROLS) {
            LOGW("Rules", "Invalid control index for registration: %d", idx);
            return;
        }
        _executors[idx] = nullptr;
        _drivers[idx] = driver;
        LOGI("Rules", "Registered driver for control %d", idx);
    }

    // -------------------------------------------------------------------------
    // State Change Transmission
    // -------------------------------------------------------------------------

    bool hasPendingStateChange() const { return _queue_count > 0; }

    // Fill buffer with up to floor(max_len/11) events from queue head. Returns total bytes written; sets *out_count.
    size_t formatStateChangeBatch(uint8_t* buffer, size_t max_len, size_t* out_count) const {
        if (!buffer || !out_count || _queue_count == 0) {
            if (out_count) *out_count = 0;
            return 0;
        }
        size_t max_events = max_len / 11;
        if (max_events == 0) {
            *out_count = 0;
            return 0;
        }
        size_t n = (max_events < _queue_count) ? max_events : _queue_count;
        size_t offset = 0;
        for (size_t i = 0; i < n; i++) {
            size_t idx = (_queue_head + i) % STATE_CHANGE_QUEUE_CAP;
            offset += _state_change_queue[idx].toBinary(buffer + offset, max_len - offset);
        }
        *out_count = n;
        return offset;
    }

    String stateChangeToText() const {
        if (_queue_count == 0) return "";
        return _state_change_queue[_queue_head].toText();
    }

    void clearStateChangeBatch(size_t count) {
        if (count == 0) return;
        if (count >= _queue_count) {
            _queue_count = 0;
            _queue_head = 0;
        } else {
            _queue_head = (_queue_head + count) % STATE_CHANGE_QUEUE_CAP;
            _queue_count -= count;
        }
    }

    // -------------------------------------------------------------------------
    // Persistence
    // -------------------------------------------------------------------------

    void loadFromFlash() {
        if (!_persistence) {
            LOGW("Rules", "No persistence HAL available");
            return;
        }

        if (!_persistence->begin(PERSISTENCE_NAMESPACE)) {
            LOGW("Rules", "Failed to open persistence namespace");
            return;
        }

        _rule_count = _persistence->loadU32(PERSISTENCE_KEY_COUNT, 0);
        if (_rule_count > MAX_RULES) _rule_count = MAX_RULES;

        if (_rule_count > 0) {
            std::string data = _persistence->loadString(PERSISTENCE_KEY_DATA, "");
            if (data.length() == _rule_count * 12) {
                for (uint8_t i = 0; i < _rule_count; i++) {
                    _rules[i].fromBinary(reinterpret_cast<const uint8_t*>(data.c_str()) + i * 12, 12);
                }
                LOGI("Rules", "Loaded %d rules from flash", _rule_count);
            } else {
                LOGW("Rules", "Invalid rule data length, clearing");
                _rule_count = 0;
            }
        }

        // Load state change queue (unsent changes survive reboot)
        uint32_t sc_count = _persistence->loadU32(PERSISTENCE_KEY_SC_COUNT, 0);
        if (sc_count > 0 && sc_count <= STATE_CHANGE_QUEUE_CAP) {
            uint8_t blob[STATE_CHANGE_QUEUE_CAP * 11];
            size_t loaded = _persistence->loadBytes(PERSISTENCE_KEY_SC_DATA, blob, sizeof(blob));
            if (loaded == sc_count * 11) {
                _queue_head = 0;
                _queue_count = sc_count;
                for (size_t i = 0; i < sc_count; i++) {
                    _state_change_queue[i].fromBinary(blob + i * 11, 11);
                }
                LOGI("Rules", "Loaded %d pending state changes from flash", (int)sc_count);
            } else {
                LOGW("Rules", "Invalid state change queue data length, clearing");
            }
        }

        _persistence->end();
    }

    void saveToFlash() {
        if (!_persistence) {
            LOGW("Rules", "No persistence HAL available");
            return;
        }

        if (!_persistence->begin(PERSISTENCE_NAMESPACE)) {
            LOGW("Rules", "Failed to open persistence namespace");
            return;
        }

        _persistence->saveU32(PERSISTENCE_KEY_COUNT, _rule_count);

        if (_rule_count > 0) {
            uint8_t buffer[MAX_RULES * 12];
            for (uint8_t i = 0; i < _rule_count; i++) {
                _rules[i].toBinary(buffer + i * 12, 12);
            }
            _persistence->saveString(PERSISTENCE_KEY_DATA,
                std::string(reinterpret_cast<char*>(buffer), _rule_count * 12));
        }

        _persistence->end();
        LOGI("Rules", "Saved %d rules to flash", _rule_count);
    }

    void saveStateChangeQueueToFlash() {
        if (!_persistence) return;
        if (!_persistence->begin(PERSISTENCE_NAMESPACE)) return;
        _persistence->saveU32(PERSISTENCE_KEY_SC_COUNT, (uint32_t)_queue_count);
        if (_queue_count > 0) {
            uint8_t blob[STATE_CHANGE_QUEUE_CAP * 11];
            size_t offset = 0;
            for (size_t i = 0; i < _queue_count; i++) {
                size_t idx = (_queue_head + i) % STATE_CHANGE_QUEUE_CAP;
                offset += _state_change_queue[idx].toBinary(blob + offset, sizeof(blob) - offset);
            }
            _persistence->saveBytes(PERSISTENCE_KEY_SC_DATA, blob, _queue_count * 11);
        }
        _persistence->end();
    }

private:
    const MessageSchema::Schema& _schema;
    IPersistenceHal* _persistence;

    EdgeRule _rules[MAX_RULES];
    uint8_t _rule_count;

    ControlState _control_states[MAX_CONTROLS];
    ControlExecuteFn _executors[MAX_CONTROLS];
    IControlDriver* _drivers[MAX_CONTROLS];

    StateChange _state_change_queue[STATE_CHANGE_QUEUE_CAP];
    size_t _queue_head;
    size_t _queue_count;
    uint16_t _sequence_id;

    // Find rule index by ID (-1 if not found)
    int findRuleById(uint8_t id) const {
        for (uint8_t i = 0; i < _rule_count; i++) {
            if (_rules[i].id == id) return i;
        }
        return -1;
    }

    // Evaluate a condition
    bool evaluateCondition(RuleOperator op, float value, float threshold) const {
        switch (op) {
            case RuleOperator::LT:  return value < threshold;
            case RuleOperator::GT:  return value > threshold;
            case RuleOperator::LTE: return value <= threshold;
            case RuleOperator::GTE: return value >= threshold;
            case RuleOperator::EQ:  return value == threshold;
            case RuleOperator::NEQ: return value != threshold;
            default: return false;
        }
    }

    // Execute an action on a control
    void executeAction(uint8_t ctrl_idx, uint8_t state_idx, TriggerSource source,
                       uint8_t rule_id, uint32_t now_ms) {
        if (_drivers[ctrl_idx]) {
            if (!_drivers[ctrl_idx]->setState(state_idx)) {
                LOGW("Rules", "Driver failed for control %d", ctrl_idx);
                return;
            }
        } else if (_executors[ctrl_idx]) {
            if (!_executors[ctrl_idx](state_idx)) {
                LOGW("Rules", "Executor failed for control %d", ctrl_idx);
                return;
            }
        } else {
            LOGD("Rules", "No executor for control %d, state change only", ctrl_idx);
        }

        // Update state and queue for transmission
        setControlState(ctrl_idx, state_idx, source, rule_id, now_ms);
    }
};

} // namespace EdgeRules
