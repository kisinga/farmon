# Architecture

## Overview

Farmon is a LoRaWAN-based farm monitoring system with remote sensor nodes and a gateway stack.

```
┌─────────────────┐      LoRaWAN       ┌─────────────────┐
│  Heltec Sensors │ ──────────────────►│  SX1302 Gateway │
└─────────────────┘                    └────────┬────────┘
                                                │
                                       ┌────────▼────────┐
                                       │  Raspberry Pi   │
                                       │  ┌───────────┐  │
                                       │  │ ChirpStack│  │ LoRaWAN Server
                                       │  │ Node-RED  │  │ Data Pipeline
                                       │  │ PostgreSQL│  │ Storage
                                       │  └───────────┘  │
                                       └─────────────────┘
```

## Data Flow

### Current Architecture (Pull Model)

The system uses a **pull model** where the transmission task pulls fresh data from services on-demand.

```mermaid
flowchart TB
    subgraph Hardware["Hardware Layer"]
        GPIO[GPIO Pin<br/>Water Flow Sensor]
        ADC[ADC Pin<br/>Battery Monitor]
    end
    
    subgraph Interrupts["Interrupt Context (IRAM_ATTR)"]
        PulseInt[IRAM_ATTR pulseCounter<br/>_pulseCount++<br/>_interruptFired = true]
    end
    
    subgraph StateMgmt["State Management Layer"]
        WFSensor[WaterFlowSensor<br/>volatile _pulseCount<br/>_totalPulses persisted]
        BatteryHAL[BatteryMonitorHal<br/>reads ADC voltage]
        BatterySvc[BatteryService<br/>getBatteryPercent<br/>isCharging]
        SystemState[System State<br/>_errorCount<br/>_lastResetMs]
    end
    
    subgraph Scheduler["FreeRTOS Scheduler Tasks"]
        BatteryTask["battery task<br/>1s interval<br/>batteryService->update"]
        PersistTask["persistence task<br/>60s interval<br/>waterFlowSensor->saveTotalVolume"]
        TXTask["lorawan_tx task<br/>60s interval<br/>Pull & Transmit"]
        DisplayTask["display task<br/>200ms interval<br/>uiService->tick"]
        LoRaTask["lorawan task<br/>50ms interval<br/>lorawanService->update"]
    end
    
    subgraph TXProcess["Transmission Process"]
        CreateVec[Create empty vector<br/>std::vector readings]
        QueryWF[Query waterFlowSensor->read<br/>Atomically read & reset _pulseCount<br/>Calculate total volume]
        QueryBatt[Query batteryService->getBatteryPercent<br/>Get cached value]
        QuerySys[Query system state<br/>_errorCount, timeSinceReset]
        BuildVec[Build readings vector<br/>All SensorReading structs<br/>with type, value, timestamp]
    end
    
    subgraph Transmitter["LoRaWANTransmitter (Pure Helper)"]
        Format[formatReadings<br/>Loop through vector<br/>Create: type:value,type:value"]
        Validate[validatePayload<br/>Check size vs maxPayload<br/>Get current data rate]
        Send[lorawanService->sendData<br/>Port, payload, confirmed flag]
    end
    
    subgraph Backend["Backend Stack"]
        Gateway[ChirpStack Gateway<br/>SX1302 Concentrator<br/>LoRaWAN Protocol]
        MQTT[MQTT Broker<br/>Mosquitto<br/>application/+/device/+/event/up]
        NodeRED[Node-RED<br/>Parse Uplink<br/>Store Reading<br/>Check Thresholds]
        DB[(PostgreSQL<br/>readings table<br/>device_eui, data, ts)]
    end
    
    GPIO -->|FALLING edge| PulseInt
    PulseInt -->|Accumulates| WFSensor
    ADC -->|Voltage reading| BatteryHAL
    BatteryHAL --> BatterySvc
    
    BatteryTask --> BatterySvc
    PersistTask --> WFSensor
    
    TXTask -->|Check joined| LoRaTask
    TXTask --> CreateVec
    CreateVec --> QueryWF
    CreateVec --> QueryBatt
    CreateVec --> QuerySys
    
    QueryWF -->|Adds readings| BuildVec
    QueryBatt -->|Adds reading| BuildVec
    QuerySys -->|Adds readings| BuildVec
    
    BuildVec -->|Pass vector| Format
    Format --> Validate
    Validate --> Send
    Send -->|Radio TX| Gateway
    Gateway -->|MQTT publish| MQTT
    MQTT -->|Subscribe| NodeRED
    NodeRED -->|INSERT| DB
    
    style TXTask fill:#e1f5ff
    style Transmitter fill:#fff4e1
    style StateMgmt fill:#e8f5e9
    style Interrupts fill:#fce4ec
```

**Key Design Principles:**
- **Services maintain state:** Sensors accumulate data (interrupts), services cache values
- **Transmission pulls on-demand:** TX task collects fresh data when needed
- **Pure helper:** `LoRaWANTransmitter` is stateless - format and send only
- **No queue:** Eliminates stale data and redundant polling

### Previous Architecture (Problematic)

The previous design had redundant mechanisms:
- Sensor reading task (60s) → queue → TX task (1s) → throttle (60s) → transmit
- **Problem:** 1s polling + 60s throttling = 59 wasted calls/second
- **Solution:** Remove queue, remove redundant polling, use pull model

## Interrupt Safety

Sensor data collection is interrupt-safe to prevent data loss:

```cpp
// Interrupt handler (IRAM_ATTR - runs in interrupt context)
void IRAM_ATTR YFS201WaterFlowSensor::pulseCounter() {
    _pulseCount++;  // Atomic increment (volatile)
    _interruptFired = true;
}

// Sensor read (runs in task context)
void YFS201WaterFlowSensor::read(std::vector<SensorReading>& readings) {
    // Atomic read-and-reset
    noInterrupts();
    unsigned long currentPulses = _pulseCount;
    _pulseCount = 0;  // Reset after reading
    interrupts();
    
    // Accumulate to total (never lost)
    _totalPulses += currentPulses;
}
```

**Safety Guarantees:**
- ✅ Interrupts accumulate pulses in `_pulseCount` (volatile, thread-safe)
- ✅ Atomic read-and-reset prevents double-counting
- ✅ `_totalPulses` persists across reads (never lost)
- ✅ Persistence layer saves `_totalPulses` every 60s

## Service State Management

Services maintain current state for on-demand reads:

### WaterFlowSensor
- **State:** `volatile _pulseCount` (accumulated from interrupts), `_totalPulses` (persisted)
- **Method:** `read()` atomically reads and resets pulse delta, calculates total volume
- **Safety:** No data loss - pulses accumulate continuously, total persists

### BatteryService
- **State:** Cached `batteryPercent` and `isCharging` (updated every 1s)
- **Method:** `getBatteryPercent()` returns cached value (always current)
- **Update:** Battery task updates cache periodically

### SystemState
- **State:** `errorCount`, `lastResetMs` (application-level)
- **Method:** Calculated on-demand in TX task
- **Persistence:** Saved to flash on reset command

## Data Collection Flow (Detailed)

### Visual Flow: How Data Moves from Hardware to Transmission

```
┌─────────────────────────────────────────────────────────┐
│ Services (Independent State)                            │
├─────────────────────────────────────────────────────────┤
│ WaterFlowSensor:                                        │
│   _pulseCount = 5 (volatile, updated by interrupts)    │
│   _totalPulses = 5625 (persisted)                       │
│                                                          │
│ BatteryService:                                         │
│   HAL maintains battery state                           │
│   getBatteryPercent() → 85                              │
└─────────────────────────────────────────────────────────┘
                    │
                    │ TX Task queries (every 60s)
                    ▼
┌─────────────────────────────────────────────────────────┐
│ TX Task (Creates Temporary Vector)                      │
├─────────────────────────────────────────────────────────┤
│ 1. Create empty vector: readings = []                   │
│                                                          │
│ 2. Query waterFlowSensor->read(readings)                │
│    → Sensor adds: [{type:"pd", value:5},                │
│                    {type:"tv", value:12.5}]             │
│                                                          │
│ 3. Query batteryService->getBatteryPercent() → 85        │
│    → Manually add: {type:"bp", value:85}                │
│                                                          │
│ 4. Add system state: {type:"ec", value:0}               │
│                                                          │
│ 5. Send to transmitter: transmit(readings)               │
│                                                          │
│ 6. Vector destroyed (out of scope)                       │
└─────────────────────────────────────────────────────────┘
                    │
                    │ Formatting
                    ▼
┌─────────────────────────────────────────────────────────┐
│ LoRaWANTransmitter::formatReadings()                    │
├─────────────────────────────────────────────────────────┤
│ Loop through vector:                                    │
│   for each reading:                                      │
│     payload += reading.type  // "pd", "tv", "bp", etc.  │
│     payload += ":"                                       │
│     payload += reading.value // 5, 12.5, 85, etc.       │
│                                                          │
│ Result: "pd:5,tv:12.5,bp:85,ec:0,tsr:3600"              │
└─────────────────────────────────────────────────────────┘
```

### Key Points

1. **Services maintain independent state** - not stored in a vector
   - `WaterFlowSensor` has `_pulseCount` and `_totalPulses` as member variables
   - `BatteryService` queries HAL which maintains battery state
   - System state (`_errorCount`, `_lastResetMs`) is in `RemoteApplicationImpl`

2. **Vector is temporary** - created fresh each TX cycle
   - Created at start of TX task: `std::vector<SensorReading> readings;`
   - Populated by querying services
   - Destroyed when task completes (goes out of scope)

3. **Services don't update the vector** - TX task queries and builds it
   - `waterFlowSensor->read(readings)` - sensor adds to vector via `push_back`
   - `batteryService->getBatteryPercent()` - TX task manually creates struct and adds
   - System state - TX task manually creates structs and adds

4. **Formatting uses `type` field, not position**
   - Each `SensorReading` has `{type, value, timestamp}`
   - Formatter reads `readings[i].type` to get label (e.g., "pd", "bp", "ec")
   - Position doesn't matter - type field identifies each reading

## Component Responsibilities

### Scheduler Tasks

| Task | Interval | Responsibility |
|------|----------|----------------|
| `battery` | 1s | Updates battery HAL state via `batteryService->update()` |
| `persistence` | 60s | Saves water flow `_totalPulses` to flash storage |
| `lorawan_tx` | 60s | Pulls fresh data from services, transmits via LoRaWAN |
| `display` | 200ms | Updates UI display via `uiService->tick()` |
| `lorawan` | 50ms | Updates LoRaWAN stack state machine, connection status |
| `lorawan_join` | 100ms | Initial join attempt after startup |
| `lorawan_watchdog` | 60s | Rejoin watchdog if not connected |

### LoRaWANTransmitter (Pure Helper)
- **Responsibility:** Format readings → Validate payload → Send via LoRaWAN
- **Stateless:** No internal state, no connection checking, no throttling
- **Composable:** Can be used by any caller, any timing
- **Methods:**
  - `transmit(readings)` - Main entry point, returns success/failure
  - `formatReadings(readings)` - Creates "type:value,type:value" string
  - `validatePayload(payload)` - Checks size against current data rate limits

### TX Task (Orchestrator)
- **Responsibility:** Check connection → Collect data → Call transmitter
- **Timing:** Runs at `txIntervalMs` (60s) - scheduler handles interval
- **Data Collection:** Pulls fresh data from services on-demand
- **Process:**
  1. Check `lorawanService->isJoined()` - return if not connected
  2. Create empty `std::vector<SensorReading> readings`
  3. Query `waterFlowSensor->read(readings)` - adds pulse delta & total volume
  4. Query `batteryService->getBatteryPercent()` - manually add battery reading
  5. Add system state readings (error count, time since reset)
  6. Call `lorawanTransmitter->transmit(readings)`
  7. Vector destroyed (out of scope)

### Services (State Managers)
- **Responsibility:** Maintain current state, provide on-demand reads
- **Independence:** Services are independent, no coupling to transmission
- **Data Integrity:** Interrupt-safe, no data loss

#### WaterFlowSensor
- **State Variables:**
  - `volatile uint32_t _pulseCount` - Accumulated from interrupts (thread-safe)
  - `uint32_t _totalPulses` - Total pulses since last reset (persisted)
- **Methods:**
  - `read(readings)` - Atomically reads `_pulseCount`, resets to 0, adds to total, creates SensorReading structs
  - `saveTotalVolume()` - Persists `_totalPulses` to flash
  - `resetTotalVolume()` - Resets `_totalPulses` to 0 (via downlink command)

#### BatteryService
- **State:** Queries `BatteryMonitorHal` which reads ADC and maintains state
- **Methods:**
  - `update(nowMs)` - Updates HAL state (called by battery task every 1s)
  - `getBatteryPercent()` - Returns current battery percentage
  - `isCharging()` - Returns charging status

#### SystemState (RemoteApplicationImpl)
- **State Variables:**
  - `uint32_t _errorCount` - Application error counter
  - `uint32_t _lastResetMs` - Timestamp of last reset
- **Methods:** Accessed directly in TX task, calculated on-demand

## Design Principles

- **Composability:** Services are independent, transmitter is a pure utility, caller orchestrates
- **Simplicity:** Remove redundant mechanisms (queue, throttling, interface abstraction)
- **Data Integrity:** Interrupt-safe design, no data loss, fresh data on every transmission
- **Flexibility:** TX interval independent of sensor reading, easy to add new transmitters
