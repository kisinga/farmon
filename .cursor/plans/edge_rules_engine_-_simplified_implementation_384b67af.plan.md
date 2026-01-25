---
name: Edge Rules Engine - Simplified Implementation
overview: Implement edge rules engine with state change tracking, focusing on composition and avoiding over-engineering. Time sync handled server-side using relative timestamps.
todos:
  - id: "1"
    content: Create core rule structures (edge_rules_engine.h) - Rule, StateChange, enums
    status: pending
  - id: "2"
    content: Implement rule engine (edge_rules_engine.cpp) - storage, evaluation, persistence
    status: pending
  - id: "3"
    content: Implement control state manager (edge_control_state.cpp) - state tracking, persistence
    status: pending
  - id: "4"
    content: Implement state change transmitter (edge_state_transmitter.cpp) - format and send on fPort 3
    status: pending
  - id: "5"
    content: Implement control executor (edge_control_executor.cpp) - composable hardware interface
    status: pending
  - id: "6"
    content: Integrate into remote_app.cpp - initialization, tasks, downlink handlers
    status: pending
  - id: "7"
    content: Update server-side flows.json - calculate absolute time from boot_ms in state changes
    status: pending
---

# Edge Rules Engine - Simplified Implementation Plan

## Architecture Principles

- **Composition over inheritance**: Use interfaces and composition
- **Server-side time sync**: Device sends relative time, server calculates absolute
- **Simple state authority**: Label controls, no complex conflict resolution
- **Minimal retry logic**: Basic retry, no exponential backoff
- **Essential features only**: Skip nice-to-haves

## Core Components

### 1. Time Handling (Server-Side)

**Device**: Send relative time in state changes

- Include `tsr` (time since reset in seconds) - already in telemetry
- Include `boot_ms` (millis since boot) for state changes
- Server calculates: `absolute_time = server_receive_time - relative_time`

**Files to modify**:

- `heltec/lib/edge_state_transmitter.cpp`: Include `boot_ms` in payload
- `pi/nodered/flows.json`: State change handler calculates absolute time from `boot_ms`

### 2. Edge Rules Engine Core

**Files to create**:

- `heltec/lib/edge_rules_engine.h` - Core rule structures and engine
- `heltec/lib/edge_rules_engine.cpp` - Implementation

**Key structures**:

```cpp
struct Rule {
    uint32_t id;
    String condition_field;
    RuleOperator op;  // <, >, <=, >=, ==, !=
    float threshold;
    String action_control;
    String action_state;
    uint32_t priority;
    uint32_t cooldown_seconds;
    bool enabled;
    uint32_t last_triggered_ms;
};

struct StateChange {
    String control_key;
    String old_state;
    String new_state;
    TriggerSource source;  // RULE, MANUAL, DOWNLINK, BOOT
    String trigger_id;      // Rule ID if from rule
    uint32_t boot_ms;      // Relative time for server calculation
    uint32_t sequence_id;  // Monotonic for deduplication
};
```

**Simple engine interface**:

```cpp
class EdgeRulesEngine {
    std::vector<Rule> _rules;
    std::vector<StateChange> _pendingChanges;
    IPersistenceHal* _persistence;
    
    // Core methods
    void evaluateRules(const std::map<String, float>& telemetry, uint32_t nowMs);
    bool addRule(const Rule& rule);
    void loadFromFlash();
    void saveToFlash();
};
```

### 3. Control State Manager

**Files to create**:

- `heltec/lib/edge_control_state.h`
- `heltec/lib/edge_control_state.cpp`

**Simplified structure**:

```cpp
enum class StateAuthority : uint8_t {
    EDGE = 0,
    SERVER = 1,
    HYBRID = 2
};

struct ControlState {
    String current_state;
    StateAuthority authority;  // Label only
    bool is_manual;
    uint32_t manual_until_ms;
};

class ControlStateManager {
    std::map<String, ControlState> _states;
    IPersistenceHal* _persistence;
    
    // Simple methods
    bool setState(const String& key, const String& state, 
                  TriggerSource source, const String& triggerId);
    bool isManual(const String& key) const;
    void saveToFlash();
    void loadFromFlash();
};
```

### 4. State Change Transmission

**Files to create**:

- `heltec/lib/edge_state_transmitter.h`
- `heltec/lib/edge_state_transmitter.cpp`

**Simple transmitter**:

```cpp
class StateChangeTransmitter {
    ILoRaWANService* _service;
    uint32_t _lastSequence = 0;
    
    bool transmit(const StateChange& change);
    String formatPayload(const StateChange& change);
};
```

**Payload format (fPort 3)**:

```json
{
  "ctrl": "pump",
  "state": "on",
  "old": "off",
  "reason": 0,        // TriggerSource enum
  "id": "123",       // Rule ID or empty
  "boot_ms": 45000,  // Relative time for server
  "seq": 1          // Sequence number
}
```

### 5. Control Executor (Composable)

**Files to create**:

- `heltec/lib/edge_control_executor.h`
- `heltec/lib/edge_control_executor.cpp`

**Simple interface pattern**:

```cpp
class IControlExecutor {
public:
    virtual ~IControlExecutor() = default;
    virtual bool execute(const String& controlKey, const String& state) = 0;
    virtual bool supports(const String& controlKey) const = 0;
};

class ControlExecutor {
    std::vector<std::unique_ptr<IControlExecutor>> _executors;
    
    void registerExecutor(std::unique_ptr<IControlExecutor> executor);
    bool execute(const String& key, const String& state);
};
```

### 6. Conflict Resolution (Simple)

**In EdgeRulesEngine**:

- When multiple rules trigger for same control: highest priority wins
- Group by control, pick best priority
- No complex strategies, just priority comparison

### 7. Integration Points

**In `remote_app.cpp`**:

- Add rule evaluation to telemetry task
- Add state change transmission task (every 5s)
- Add fPort 30 handler for rule updates
- Add fPort 20/21 handlers for direct control
- Register control executors (pump, valve)

**In `pi/nodered/flows.json`**:

- State change handler: Calculate absolute time from `boot_ms`
- Rule update handler: Send rules via fPort 30 downlink

## Implementation Steps

1. **Create core structures** (`edge_rules_engine.h`)

   - Rule, StateChange, TriggerSource enum
   - Simple operator enum

2. **Implement rule engine** (`edge_rules_engine.cpp`)

   - Rule storage (vector, max 20)
   - Flash persistence (JSON strings)
   - Rule evaluation (simple condition check)
   - Conflict resolution (priority only)

3. **Implement control state** (`edge_control_state.cpp`)

   - State storage (map)
   - Flash persistence
   - Manual override check
   - Authority label (no complex logic)

4. **Implement state transmitter** (`edge_state_transmitter.cpp`)

   - Format JSON payload
   - Transmit on fPort 3
   - Sequence number tracking

5. **Implement control executor** (`edge_control_executor.cpp`)

   - Interface for hardware control
   - Registry pattern (simple vector)
   - Basic retry (3 attempts, 100ms delay)

6. **Integrate into remote_app.cpp**

   - Initialize components
   - Add rule evaluation to telemetry task
   - Add state change transmission task
   - Add downlink handlers

7. **Update server-side** (`flows.json`)

   - State change handler: Calculate absolute time
   - Rule update: Send via fPort 30

## Simplifications Made

- **No TimeSyncService**: Server handles time calculation
- **Simple authority**: Just a label, no complex conflict resolution
- **Basic retry**: 3 attempts, fixed delay
- **Priority-only conflicts**: No multiple strategies
- **Simple persistence**: JSON strings in flash
- **No complex validators**: Basic field/control existence check
- **Minimal interfaces**: Only what's needed for composition

## File Structure

```
heltec/lib/
├── edge_rules_engine.h/cpp       # Core engine
├── edge_control_state.h/cpp      # State management
├── edge_state_transmitter.h/cpp  # Transmission
└── edge_control_executor.h/cpp   # Hardware control

heltec/remote_app.cpp              # Integration
pi/nodered/flows.json              # Server-side time calc
```

## Data Flow

```
Telemetry → Evaluate Rules → Execute Actions → 
Record State Change → Transmit (with boot_ms) → 
Server calculates absolute time
```

## Testing Strategy

1. Unit: Rule evaluation, condition operators
2. Integration: Rule persistence, state changes
3. End-to-end: Rule triggers → State change → Server receives with correct time