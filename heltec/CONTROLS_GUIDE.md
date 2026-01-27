# Heltec Device Controls Guide

## Current Controls

The Heltec device currently has **2 controls** enabled:

1. **Pump** (index 0)
   - Key: `"pump"`
   - Display name: `"Water Pump"`
   - States: `["off", "on"]`
   - Executor: `setPumpState()` - currently logs only (hardware TODO)

2. **Valve** (index 1)
   - Key: `"valve"`
   - Display name: `"Valve"`
   - States: `["closed", "open"]`
   - Executor: `setValveState()` - currently logs only (hardware TODO)

## System Limits

- **Maximum controls**: 16 (`MAX_CONTROLS = 16`)
- **Maximum states per control**: 4 (`MAX_STATES_PER_CONTROL = 4`)
- **Current usage**: 2/16 controls

## How Controls Work

1. **Schema Definition**: Controls are defined in the message schema (contract between device and server)
2. **Executor Function**: Each control has a function that executes the hardware action
3. **Registration**: Executors are registered with the edge rules engine
4. **Rule-Based Control**: Controls can be triggered by edge rules (e.g., "if temperature > 30, turn on pump")
5. **Direct Control**: Controls can also be triggered via LoRaWAN downlink commands

## Adding a New Control

To add a new control (e.g., a "Light" control), follow these steps:

### Step 1: Create the Executor Function

Add a new executor function in `remote_app.cpp` (around line 127, near the other control executors):

```cpp
static bool setLightState(uint8_t state_idx) {
    // TODO: GPIO/RS485 implementation when hardware ready
    // Example GPIO implementation:
    // pinMode(LIGHT_GPIO_PIN, OUTPUT);
    // digitalWrite(LIGHT_GPIO_PIN, state_idx ? HIGH : LOW);
    
    LOGI("Control", "Light -> %s", state_idx ? "on" : "off");
    return true;
}
```

**Note**: Replace the TODO with actual hardware control logic:
- **GPIO control**: Use `digitalWrite()` or `analogWrite()` for PWM
- **RS485 control**: Send commands via RS485 interface
- **I2C control**: Use Wire library for I2C devices

### Step 2: Add Control to Schema

In `remote_app.cpp`, add the control to the schema builder (around line 252):

```cpp
// Controls
.addControl("pump", "Water Pump", {"off", "on"})
.addControl("valve", "Valve", {"closed", "open"})
.addControl("light", "Grow Light", {"off", "on"})  // <-- Add this line
.build();
```

**Parameters**:
- First parameter: `"light"` - unique key (used in messages/rules)
- Second parameter: `"Grow Light"` - display name
- Third parameter: `{"off", "on"}` - array of state names (can have up to 4 states)

**Example with 3 states**:
```cpp
.addControl("fan", "Exhaust Fan", {"off", "low", "high"})
```

**Example with 4 states**:
```cpp
.addControl("heater", "Heater", {"off", "low", "medium", "high"})
```

### Step 3: Register the Executor

Register the executor function with the rules engine (around line 264):

```cpp
// Register control executors
_rulesEngine->registerControl(0, setPumpState);
_rulesEngine->registerControl(1, setValveState);
_rulesEngine->registerControl(2, setLightState);  // <-- Add this line
```

**Important**: The index (2) must match the order in the schema. The first control added is index 0, second is 1, third is 2, etc.

### Step 4: Increment Schema Version (if needed)

If you're adding controls to an existing deployed device, you should increment the schema version:

```cpp
_schema = MessageSchema::SchemaBuilder(2)  // Changed from 1 to 2
```

This ensures the server knows the schema has changed and can handle the new control.

### Step 5: Implement Hardware Control

Replace the TODO in your executor function with actual hardware control. Examples:

#### GPIO Control Example:
```cpp
static bool setLightState(uint8_t state_idx) {
    const int LIGHT_GPIO_PIN = 4;  // Choose an available GPIO pin
    
    pinMode(LIGHT_GPIO_PIN, OUTPUT);
    digitalWrite(LIGHT_GPIO_PIN, state_idx ? HIGH : LOW);
    
    LOGI("Control", "Light -> %s (GPIO %d)", 
         state_idx ? "on" : "off", LIGHT_GPIO_PIN);
    return true;
}
```

#### PWM Control Example (for dimming):
```cpp
static bool setLightState(uint8_t state_idx) {
    const int LIGHT_PWM_PIN = 4;
    const int PWM_CHANNEL = 0;
    const int PWM_FREQ = 5000;
    const int PWM_RESOLUTION = 8;  // 8-bit = 0-255
    
    ledcSetup(PWM_CHANNEL, PWM_FREQ, PWM_RESOLUTION);
    ledcAttachPin(LIGHT_PWM_PIN, PWM_CHANNEL);
    
    uint8_t brightness = state_idx ? 255 : 0;  // Full on or off
    ledcWrite(PWM_CHANNEL, brightness);
    
    LOGI("Control", "Light -> %s (brightness=%d)", 
         state_idx ? "on" : "off", brightness);
    return true;
}
```

#### Multi-State Control Example:
```cpp
static bool setFanState(uint8_t state_idx) {
    const int FAN_PWM_PIN = 4;
    const int PWM_CHANNEL = 0;
    
    // state_idx: 0=off, 1=low, 2=high
    uint8_t speeds[] = {0, 128, 255};  // PWM values for each state
    
    if (state_idx >= 3) {
        LOGW("Control", "Invalid fan state: %d", state_idx);
        return false;
    }
    
    ledcSetup(PWM_CHANNEL, 5000, 8);
    ledcAttachPin(FAN_PWM_PIN, PWM_CHANNEL);
    ledcWrite(PWM_CHANNEL, speeds[state_idx]);
    
    const char* state_names[] = {"off", "low", "high"};
    LOGI("Control", "Fan -> %s (PWM=%d)", 
         state_names[state_idx], speeds[state_idx]);
    return true;
}
```

## Available GPIO Pins (Heltec V3)

Check `lib/board_config.h` for pin definitions. Common available pins:
- GPIO 2, 4, 5, 12, 13, 14, 15, 16 (avoid pins used by LoRa, OLED, battery)
- GPIO 33, 34, 35, 36, 39 (input-only, ADC capable)
- GPIO 25, 26 (DAC capable)

**Avoid**:
- GPIO 1 (battery ADC)
- GPIO 17, 18 (I2C for OLED)
- GPIO 21 (OLED reset)
- GPIO 37 (VBAT control)
- GPIOs used by LoRa radio

## Testing Your Control

1. **Build and flash**:
   ```bash
   cd heltec
   ./heltec.sh flash
   ```

2. **Monitor serial output**:
   ```bash
   ./heltec.sh monitor
   ```

3. **Test via direct control**: Send a LoRaWAN downlink with fPort 20 (direct control command)

4. **Test via edge rule**: Create a rule that triggers your control based on sensor data

## Control Execution Flow

```
┌─────────────────┐
│  Trigger Source │
│  (Rule/Downlink)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Edge Rules Engine│
│  (validates)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Control Executor│
│  (your function) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Hardware Control│
│  (GPIO/RS485)   │
└─────────────────┘
```

## Example: Complete Light Control Implementation

Here's a complete example adding a "Grow Light" control:

**1. Add executor function** (in `remote_app.cpp`, around line 127):
```cpp
static bool setLightState(uint8_t state_idx) {
    const int LIGHT_GPIO_PIN = 4;
    
    pinMode(LIGHT_GPIO_PIN, OUTPUT);
    digitalWrite(LIGHT_GPIO_PIN, state_idx ? HIGH : LOW);
    
    LOGI("Control", "Grow Light -> %s (GPIO %d)", 
         state_idx ? "on" : "off", LIGHT_GPIO_PIN);
    return true;
}
```

**2. Add to schema** (around line 254):
```cpp
.addControl("pump", "Water Pump", {"off", "on"})
.addControl("valve", "Valve", {"closed", "open"})
.addControl("light", "Grow Light", {"off", "on"})
.build();
```

**3. Register executor** (around line 266):
```cpp
_rulesEngine->registerControl(0, setPumpState);
_rulesEngine->registerControl(1, setValveState);
_rulesEngine->registerControl(2, setLightState);
```

That's it! The control is now available for:
- Edge rules (e.g., "if time > 6am, turn light on")
- Direct downlink commands
- Manual override via LoRaWAN
