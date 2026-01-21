# Remote Sensor System

This document describes the modular, extensible sensor system implemented for the Heltec remote devices.

## Overview

The sensor system provides a decoupled, extensible framework for reading data from various sensors and transmitting readings in configurable batches. The system is designed to be:

- **Decoupled**: Sensors operate independently with their own timing and configuration
- **Extensible**: Easy to add new sensor types without modifying existing code
- **Configurable**: Timing and behavior can be customized per sensor
- **Batched**: Readings are collected and transmitted in batches to optimize power and bandwidth

## Architecture

### Core Components

1. **Sensor Interface** (`sensor_interface.h/cpp`)
   - Abstract `Sensor` base class defining the interface
   - `SensorManager` for coordinating multiple sensors
   - `SensorBatchTransmitter` for handling data transmission

2. **Sensor Implementations** (`sensor_implementations.h/cpp`)
   - Concrete sensor implementations for specific hardware
   - `LoRaBatchTransmitter` for LoRa transmission

3. **Configuration** (`remote_sensor_config.h`, `config.h`)
   - Sensor configuration structures
   - Pin assignments and timing settings

## Supported Sensors

### Ultrasonic Distance Sensor (JSN-SR04T)
- Measures distance using ultrasonic pulses
- Useful for water level, tank depth, proximity detection
- Default timing: 30s read interval, 1min batch

### Water Level Sensor (Float Switch)
- Digital float switch for water presence detection
- Simple on/off detection
- Default timing: 10s read interval, 1min batch

### Water Flow Sensor (YF-G1)
- Measures water flow rate using hall effect sensor
- Tracks both instantaneous flow and total volume
- Default timing: 1s read interval, 1min batch

### RS485 Communication Interface
- For sensors communicating via RS485 protocol
- Extensible base for various RS485-enabled sensors
- Default timing: 5s read interval, 1min batch

### Temperature/Humidity Sensor (DHT-style)
- Measures ambient temperature and humidity
- Compatible with DHT11, DHT22, etc.
- Default timing: 2s read interval, 1min batch

## Configuration

Sensors are configured in `config.h` using the `buildRemoteSensorConfig()` function:

```cpp
inline RemoteSensorConfig buildRemoteSensorConfig() {
    RemoteSensorConfig sensorCfg = createRemoteSensorConfig();

    // Enable ultrasonic sensor for distance measurement
    sensorCfg.enableUltrasonic(true, 12, 13);  // trig=12, echo=13

    // Enable water level sensor
    sensorCfg.enableWaterLevel(true, 14);      // pin=14

    // Enable water flow sensor
    sensorCfg.enableWaterFlow(true, 15);       // pin=15

    // Enable temperature/humidity sensor
    sensorCfg.enableTempHumidity(true, 18);    // data=18

    // Customize batch interval (default 1 minute)
    sensorCfg.setBatchInterval(30000); // 30 seconds

    return sensorCfg;
}
```

## Data Format

Sensor readings are transmitted in the standard key-value format:

```
id=03,distance=125.50mm,water_level=0,temp=23.45C,humidity=65.20%
```

Where:
- `id`: Remote device ID
- Sensor readings: `sensor_name=value unit`
- Multiple readings separated by commas

## Timing Configuration

Each sensor has two timing parameters:

- **Read Interval**: How often the sensor is polled for new data
- **Batch Interval**: How often collected readings are transmitted

Default batch interval is 60 seconds (configurable). Individual sensors have different read intervals based on their characteristics.

## Hardware Setup

### Pin Assignments
The system uses the following default pin assignments:

- Ultrasonic: Trig=12, Echo=13
- Water Level: Pin=14
- Water Flow: Pin=15
- RS485: RE=16, DE=17
- Temp/Humidity: Data=18

### Hardware Requirements

1. **Ultrasonic Sensor**: Connect Trig and Echo pins to configured GPIO pins
2. **Water Level Sensor**: Connect float switch to configured GPIO pin
3. **Water Flow Sensor**: Connect hall effect sensor to configured GPIO pin with interrupt capability
4. **RS485 Sensors**: Connect RE/DE control pins and serial interface
5. **Temp/Humidity**: Connect DHT sensor data pin to configured GPIO

## Adding New Sensors

To add a new sensor type:

1. Create a new sensor class inheriting from `Sensor`
2. Implement the required virtual methods:
   - `begin()`: Initialize the sensor
   - `read()`: Read sensor data and return `SensorReading`
   - `getName()`: Return sensor name
   - `getConfig()`: Return sensor configuration
   - `isReady()`: Check if sensor is operational

3. Add sensor creation function to `SensorFactory` namespace
4. Update configuration system to support the new sensor

Example:

```cpp
class MyCustomSensor : public Sensor {
public:
    MyCustomSensor(const SensorConfig& cfg, uint8_t dataPin);
    bool begin() override;
    SensorReading read() override;
    // ... other required methods
};
```

## Power Considerations

- Sensors with frequent read intervals consume more power
- Batch transmission reduces radio usage
- Consider duty cycling for battery-powered applications
- Ultrasonic sensors are power-efficient but require short active periods

## Troubleshooting

### Common Issues

1. **Sensor not responding**: Check pin assignments and wiring
2. **Invalid readings**: Verify sensor power supply and connections
3. **Transmission failures**: Check LoRa connectivity and signal strength
4. **Timing issues**: Ensure read intervals don't conflict with batch intervals

### Debug Information

The system logs sensor status and readings via the standard logging system. Enable debug logging to see detailed sensor operation information.

## Performance

- Maximum 8 sensors per remote device
- Batch transmission optimizes bandwidth usage
- Configurable timing allows power/performance tradeoffs
- Interrupt-driven sensors (like flow meters) minimize polling overhead
