# Heltec Development Journey & Lessons Learned

## Overview

This document chronicles the real-world experience of implementing firmware for Heltec LoRa devices in the farm monitoring system. It serves as a cautionary tale and learning resource for future development decisions.

## The Challenge

We needed to implement firmware for Heltec devices that could:

- Read from various I/O sensors
- Send periodic ping/heartbeat messages
- Maintain connection state between devices
- Handle sensor readings and transmit them via LoRa
- Make autonomous decisions on-device
- Manage device state effectively

**Target Architecture**: Remote sensor nodes ↔ Relay node ↔ Raspberry Pi bridge

## Approach #1: Raw C/C++ (Arduino Framework)

### Duration: ~1 week

### Outcome: ❌ Failed

**What We Tried:**

- Direct Arduino/ESP32 programming in C/C++
- Basic LoRa communication setup
- Sensor interfacing

**Challenges Encountered:**

1. **Code Complexity Management**: As soon as the code grew beyond basic examples, it became unwieldy
2. **State Management**: Keeping track of connection states, sensor readings, and communication protocols was challenging
3. **LLM-Assisted Development Issues**:
   - "Vibe coding" produced buggy, unmaintainable code
   - Performance issues in generated code
   - Significant debugging overhead
   - Burned through Cursor editor credits due to excessive back-and-forth
4. **Skill Gap**: Limited C/C++ experience made complex implementations difficult

**Key Learning**: LLM-assisted coding for complex embedded systems can be problematic when you don't have strong fundamentals in the language.

## Approach #2: Meshtastic

### Duration: Several days

### Outcome: ❌ Failed

**What We Tried:**

- Using [Meshtastic](https://meshtastic.org/) as a pre-built communication layer
- Attempting to interface with custom sensors

**Pros:**

- ✅ Excellent, feature-rich communication software
- ✅ Robust mesh networking capabilities
- ✅ Active community and documentation

**Cons & Deal-breakers:**

1. **Rigidity**: Very opinionated about how devices should work
2. **Custom Sensor Integration**: Required deep understanding of Meshtastic's complex APIs
3. **Stability Issues**: **CRITICAL** - Devices frequently froze up during operation
4. **Limited Customization**: Difficult to implement custom business logic

**Key Learning**: Meshtastic is excellent for standard mesh communication but not suitable when you need custom sensor integration and device-specific logic.

## Approach #3: Tasmota

### Duration: 2 full days

### Outcome: ❌ Failed

**What We Tried:**

- Using [Tasmota](https://tasmota.github.io/) as a feature-rich firmware base
- Custom compilation using [TasmoCompiler](https://github.com/benzino77/tasmocompiler)
- Sensor driver integration

**Pros:**

- ✅ Incredibly feature-packed firmware
- ✅ Built-in drivers for vast array of sensors and devices
- ✅ Excellent web-based configuration
- ✅ TasmoCompiler makes custom builds easy

**Challenges:**

1. **Limited Progress**: After 2 days of debugging, only got onboard button reading to work
2. **Complex Configuration**: Custom commands and recompilation cycles were time-consuming
3. **LoRa Integration**: Tasmota is primarily WiFi-focused; LoRa support is limited
4. **Debugging Difficulty**: Hard to troubleshoot when things don't work as expected

**Tools Used:**

- [TasmoCompiler](https://github.com/benzino77/tasmocompiler) - Web GUI for custom Tasmota compilation
- Multiple firmware variations and configurations

**Key Learning**: Tasmota is fantastic for WiFi-based IoT devices but may not be the right fit for LoRa-based communication systems.

## Current State & Next Steps

### Re-evaluating Raw C/C++

After experiencing the limitations of higher-level frameworks, we're considering returning to raw C/C++ with a different approach:

**Potential Strategies:**

1. **Start Simple**: Build incrementally, testing each component thoroughly
2. **Better Architecture**: Plan the code structure before implementing
3. **Avoid LLM Over-reliance**: Use LLMs for specific problems, not entire implementations
4. **Reference Implementations**: Study working LoRa projects as templates

### Alternative Considerations

1. **MicroPython/CircuitPython**: Steeper learning curve worries, coupled with performance concerns
2. **ESP-IDF**: More control than Arduino framework, steeper learning curve
3. **Platform.IO**: Better project management and dependency handling
4. **Hybrid Approach**: Use existing libraries for complex parts (LoRa, sensors) and custom code for business logic

## Lessons Learned

### Development Approach

- ❌ **Don't**: Rely heavily on LLM code generation without strong fundamentals
- ❌ **Don't**: Assume high-level frameworks will solve complex custom requirements
- ✅ **Do**: Start with simple, working examples and build incrementally
- ✅ **Do**: Understand the underlying hardware and protocols before adding abstraction layers

### Tool Selection

- **Meshtastic**: Great for standard mesh networking, poor for custom sensor integration
- **Tasmota**: Excellent for WiFi IoT, limited for LoRa applications
- **TasmoCompiler**: Valuable tool for Tasmota development
- **Raw C/C++**: Higher learning curve but maximum flexibility

### Time Investment

- Total time spent: ~2 weeks
- Major bottlenecks: LLM debugging cycles, framework limitations
- Key insight: Sometimes the "harder" path (raw coding) is actually faster long-term

## Recommendations for Future Development

1. **Start with Working Examples**: Find proven LoRa communication examples first
2. **Incremental Development**: Add one feature at a time
3. **Proper Testing Strategy**: Test each component in isolation
4. **Documentation**: Document working configurations immediately
5. **Version Control**: Commit working states frequently
6. **Community Resources**: Leverage ESP32/LoRa community knowledge over LLM generation

## Resources & References

- [Tasmota Documentation](https://tasmota.github.io/)
- [TasmoCompiler - Web GUI for Tasmota compilation](https://github.com/benzino77/tasmocompiler)
- [Meshtastic Documentation](https://meshtastic.org/)
- ESP32 LoRa Library Examples
- Arduino LoRa Community Projects

## Current INFRASTRUCTURE Status

- **Working**: 3-device setup (Remote → Relay → Bridge → Mosquitto → Node-RED)

## INFRASTRUCTURE CHALLENGES

Custom LoRa protocol is FLAKY, needs reliability improvements.
This is the main motivation for any research below.

In the near future, we need to support some sort of master-->slave communication and command sending. This is already manifesting as a problem in the current setup where we need to sync time, for instance, as well as, say resetting the error counter without reflashing the firmware with custom code just to do this. This is especially important now during dev phase where we need an error counter, but now, more than ever, errors are bound to happen. Sensor configs can also be remotely updated. Nice!

### Custom Protocol Benefits

- **Flexibility**: Custom protocol can be tailored to the specific needs of the project
- **Cost**: Lower cost than LoRaWAN
- **Risk**: Low (proven technology)

### Custom Protocol Drawbacks (Current)

- **Reliability**: Low reliability
- **Features**: Limited features. Everything must be written from scratch.
- **Community Support**: Nothing. We can take advantage of some libraries, but these are very raw

## LoRaWAN Migration Research

Based on the current flakiness of the custom LoRa protocol, LoRaWAN seems like the best option for the long term. From the research, it solves the reliability issues and provides a professional-grade solution and other advantages.

### LoRaWAN Benefits

- **Reliability**: Proven protocol used in millions of devices worldwide
- **Built-in Features**: Adaptive data rates, duty cycle management, security
- **Standard Protocol**: Interoperable with LoRaWAN gateways
- **Community Support**: Extensive documentation and examples

### LoRaWAN Drawbacks

- **Learning Curve**: Steeper learning curve than custom protocol
- **Cost**: Higher cost than custom protocol
- **Risk**: Medium (custom development)

## What about AT Commands? (natively supported by LoRaWAN, BTW)

They're specifically designed to be used on embedded systems.

### **Features**

- **Human Readable**: `AT+SETFREQ=868000000` vs binary protocol
- **Self-Documenting**: Commands describe what they do
- **Error Handling**: Standardized response codes (`OK`, `ERROR`, `+CME ERROR`)
- **Extensible**: Manufacturers add proprietary commands while maintaining compatibility
- **Debugging Friendly**: Easy to test and troubleshoot via serial terminal

### Decision choices

#### Option 1: Fix Current System

- Improve custom LoRa layer reliability **main problem**
- Add AT commands for remote configuration
- **Cost**: $0 hardware, long term maintenance cost is high
- **Risk**: Medium (custom protocol remains)

#### Option 2: SX1302 HAT + ChirpStack

- Replace relay with Pi + SX1302 LoRaWAN Gateway HAT
- Use ChirpStack network server (natively supported)
- Migrate to LoRaWAN protocol
- **Cost**: ~$50-80 hardware
- **Risk**: Low (proven technology), integration risk is high, but community support is good
- **Side effect**: Existing sensors suporting LoRaWAN will just plug and play. This opens up a lot of possibilities for the future.

### Conclusion

Option 2 is the best choice. It solves the main problem of the current custom protocol and opens up a lot of possibilities for the future.

#### Short term plan

- Re-architect remote to LoRaWAN.
- Implement bare minimal LoRaWAN server functionality on relay. retain existing barebones forwarding logic, migrating it to the new protocol. Dont focus on correctness but rather compilation ability and simplicity, as this code is meant to be discarded soon as the hw arrives.
- Implement AT commands on remote.

Long term plan:
Full scale migration to LoRaWAN. Option 2.
