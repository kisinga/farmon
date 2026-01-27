#pragma once

#include <Arduino.h>
#include <cstdint>
#include <cstring>
#include <cstdio>

// =============================================================================
// Unified Message Schema
// =============================================================================
// Defines the contract between device and server. All messages reference this
// schema by index, making them compact yet meaningful.
//
// Design principles:
// - Index-based references for compactness
// - Format-agnostic (binary or text serialization)
// - Schema versioning for bidirectional sync
// =============================================================================

namespace MessageSchema {

// Maximum limits
constexpr uint8_t MAX_FIELDS = 16;
constexpr uint8_t MAX_CONTROLS = 16;
constexpr uint8_t MAX_STATES_PER_CONTROL = 4;

// Field types
enum class FieldType : uint8_t {
    FLOAT = 0,
    UINT32 = 1,
    INT32 = 2,
    ENUM = 3
};

// Field categories
enum class FieldCategory : uint8_t {
    TELEMETRY = 0,  // Sensor readings (bp, pd, tv)
    SYSTEM = 1,     // Device config/status (tx, ul, dl, ec, up)
    COMPUTED = 2    // Derived values
};

// Field access flags
enum FieldFlags : uint8_t {
    FLAG_READABLE = 0x01,
    FLAG_WRITABLE = 0x02,
    FLAG_RW = FLAG_READABLE | FLAG_WRITABLE
};

// -----------------------------------------------------------------------------
// Field Descriptor - defines a telemetry/system field
// -----------------------------------------------------------------------------
struct FieldDescriptor {
    uint8_t index;          // Position in schema (0, 1, 2...)
    char key[8];            // Short key: "bp", "pd", "tx"
    char name[32];          // Display: "Battery", "TxInterval"
    char unit[8];           // Unit: "%", "s", "L"
    FieldType type;         // Data type
    FieldCategory category; // telemetry, system, computed
    float min_val;          // Minimum value (for validation/UI)
    float max_val;          // Maximum value (for validation/UI)
    uint8_t flags;          // FLAG_READABLE, FLAG_WRITABLE

    // Helper to check if writable
    bool isWritable() const { return flags & FLAG_WRITABLE; }
    bool isReadable() const { return flags & FLAG_READABLE; }

    // Get escaped unit string (% becomes %%)
    const char* getEscapedUnit() const {
        static char escaped[16];
        if (strcmp(unit, "%") == 0) {
            return "%%";
        }
        return unit;
    }

    // Format field for registration frame based on category
    // Returns number of bytes written (snprintf-style)
    int formatForRegistration(char* buf, size_t bufSize) const {
        const char* unitStr = getEscapedUnit();
        
        switch (category) {
            case FieldCategory::TELEMETRY: {
                // Format: key:name:unit:min:max or key:name:unit or key:name
                if (min_val > 0 || max_val > 0) {
                    return snprintf(buf, bufSize, "%s:%s:%s:%.0f:%.0f",
                                    key, name, unitStr, min_val, max_val);
                } else if (unit[0] != '\0') {
                    return snprintf(buf, bufSize, "%s:%s:%s",
                                    key, name, unitStr);
                } else {
                    return snprintf(buf, bufSize, "%s:%s",
                                    key, name);
                }
            }
            
            case FieldCategory::SYSTEM: {
                // Compact format: key:name:unit:min:max:access
                // Omit min/max if they are defaults (0 and uint32_max)
                // Use "w" instead of "rw" for writable (saves 1 byte)
                const char* access = isWritable() ? "w" : "r";
                const float UINT32_MAX_F = 4294967295.0f;
                
                // Check if min/max are defaults (0 and uint32_max) - can omit them
                bool isDefaultRange = (min_val == 0.0f && max_val == UINT32_MAX_F);
                
                if (isDefaultRange) {
                    // Omit min/max for default uint32 range
                    if (unit[0] != '\0') {
                        return snprintf(buf, bufSize, "%s:%s:%s::%s",
                                        key, name, unitStr, access);
                    } else {
                        return snprintf(buf, bufSize, "%s:%s:::r",
                                        key, name);
                    }
                } else if (min_val > 0 || max_val > 0) {
                    // Include min/max for non-default ranges
                    return snprintf(buf, bufSize, "%s:%s:%s:%.0f:%.0f:%s",
                                    key, name, unitStr, min_val, max_val, access);
                } else if (unit[0] != '\0') {
                    return snprintf(buf, bufSize, "%s:%s:%s::%s",
                                    key, name, unitStr, access);
                } else {
                    return snprintf(buf, bufSize, "%s:%s:::r",
                                    key, name);
                }
            }
            
            case FieldCategory::COMPUTED:
            default:
                // Computed fields are not included in registration
                return 0;
        }
    }
};

// -----------------------------------------------------------------------------
// Control Descriptor - defines a controllable output
// -----------------------------------------------------------------------------
struct ControlDescriptor {
    uint8_t index;                              // Position in schema
    char key[8];                                // "pump", "valve"
    char name[32];                              // "Water Pump"
    uint8_t state_count;                        // Number of states (usually 2)
    char states[MAX_STATES_PER_CONTROL][16];    // State names: ["off", "on"]

    // Helper to get state name by index
    const char* getStateName(uint8_t state_idx) const {
        if (state_idx < state_count) {
            return states[state_idx];
        }
        return "unknown";
    }

    // Format control for registration frame
    // Format: key:name:state1;state2;state3
    // Returns number of bytes written (snprintf-style)
    int formatForRegistration(char* buf, size_t bufSize) const {
        int pos = snprintf(buf, bufSize, "%s:%s:", key, name);
        if (pos < 0 || pos >= (int)bufSize) return pos;
        
        for (uint8_t i = 0; i < state_count; i++) {
            if (i > 0) {
                int written = snprintf(buf + pos, bufSize - pos, ";");
                if (written < 0) return written;
                pos += written;
                if (pos >= (int)bufSize) return pos;
            }
            int written = snprintf(buf + pos, bufSize - pos, "%s", states[i]);
            if (written < 0) return written;
            pos += written;
            if (pos >= (int)bufSize) return pos;
        }
        return pos;
    }
};

// -----------------------------------------------------------------------------
// Message Schema - the complete contract
// -----------------------------------------------------------------------------
struct Schema {
    uint16_t version;                       // Increment on any change
    uint8_t field_count;                    // Number of fields defined
    uint8_t control_count;                  // Number of controls defined
    FieldDescriptor fields[MAX_FIELDS];     // Field definitions
    ControlDescriptor controls[MAX_CONTROLS]; // Control definitions

    // Find field index by key (-1 if not found)
    int8_t findFieldIndex(const char* key) const {
        for (uint8_t i = 0; i < field_count; i++) {
            if (strncmp(fields[i].key, key, sizeof(fields[i].key)) == 0) {
                return i;
            }
        }
        return -1;
    }

    // Find control index by key (-1 if not found)
    int8_t findControlIndex(const char* key) const {
        for (uint8_t i = 0; i < control_count; i++) {
            if (strncmp(controls[i].key, key, sizeof(controls[i].key)) == 0) {
                return i;
            }
        }
        return -1;
    }

    // Validate field index
    bool isValidFieldIndex(uint8_t idx) const {
        return idx < field_count;
    }

    // Validate control index
    bool isValidControlIndex(uint8_t idx) const {
        return idx < control_count;
    }

    // Validate state index for a control
    bool isValidStateIndex(uint8_t ctrl_idx, uint8_t state_idx) const {
        if (ctrl_idx >= control_count) return false;
        return state_idx < controls[ctrl_idx].state_count;
    }
};

// -----------------------------------------------------------------------------
// Schema Builder - fluent API for constructing schemas
// -----------------------------------------------------------------------------
class SchemaBuilder {
public:
    SchemaBuilder(uint16_t version = 1) {
        _schema.version = version;
        _schema.field_count = 0;
        _schema.control_count = 0;
    }

    // Add a telemetry field
    SchemaBuilder& addField(const char* key, const char* name, const char* unit,
                            FieldType type, float min_val, float max_val,
                            FieldCategory category = FieldCategory::TELEMETRY,
                            uint8_t flags = FLAG_READABLE) {
        if (_schema.field_count >= MAX_FIELDS) return *this;

        auto& f = _schema.fields[_schema.field_count];
        f.index = _schema.field_count;
        strncpy(f.key, key, sizeof(f.key) - 1);
        f.key[sizeof(f.key) - 1] = '\0';
        strncpy(f.name, name, sizeof(f.name) - 1);
        f.name[sizeof(f.name) - 1] = '\0';
        strncpy(f.unit, unit, sizeof(f.unit) - 1);
        f.unit[sizeof(f.unit) - 1] = '\0';
        f.type = type;
        f.category = category;
        f.min_val = min_val;
        f.max_val = max_val;
        f.flags = flags;

        _schema.field_count++;
        return *this;
    }

    // Add a system field (convenience method)
    SchemaBuilder& addSystemField(const char* key, const char* name, const char* unit,
                                   FieldType type, float min_val, float max_val,
                                   bool writable = false) {
        uint8_t flags = FLAG_READABLE | (writable ? FLAG_WRITABLE : 0);
        return addField(key, name, unit, type, min_val, max_val, FieldCategory::SYSTEM, flags);
    }

    // Add a control with states
    SchemaBuilder& addControl(const char* key, const char* name,
                               std::initializer_list<const char*> state_names) {
        if (_schema.control_count >= MAX_CONTROLS) return *this;

        auto& c = _schema.controls[_schema.control_count];
        c.index = _schema.control_count;
        strncpy(c.key, key, sizeof(c.key) - 1);
        c.key[sizeof(c.key) - 1] = '\0';
        strncpy(c.name, name, sizeof(c.name) - 1);
        c.name[sizeof(c.name) - 1] = '\0';

        c.state_count = 0;
        for (const char* state : state_names) {
            if (c.state_count >= MAX_STATES_PER_CONTROL) break;
            strncpy(c.states[c.state_count], state, 15);
            c.states[c.state_count][15] = '\0';
            c.state_count++;
        }

        _schema.control_count++;
        return *this;
    }

    // Build and return the schema
    Schema build() const {
        return _schema;
    }

private:
    Schema _schema;
};

} // namespace MessageSchema

// =============================================================================
// IMessage Interface - Format-agnostic message abstraction
// =============================================================================
// Concrete messages implement this for both binary (compact) and text (debug)
// serialization. Allows switching formats without changing message logic.
// =============================================================================

class IMessage {
public:
    virtual ~IMessage() = default;

    // Binary serialization (default, compact)
    virtual size_t serialize(uint8_t* buf, size_t max_len) const = 0;
    virtual bool deserialize(const uint8_t* buf, size_t len) = 0;

    // Text serialization (for debugging/logging)
    virtual String toText() const = 0;
    virtual bool fromText(const String& text) = 0;

    // Message type identifier (matches fPort)
    virtual uint8_t getMessageType() const = 0;
};
