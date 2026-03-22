# Heltec Development Journey & Lessons Learned

**Current direction:** PocketBase (Go) + Concentratord + Angular. Single binary, no ChirpStack/MQTT/Postgres; native LoRaWAN codec and SQLite. **Benefits:** one process, easy deploy, full control over join/decrypt/codec. **Drawbacks:** less plug-and-play than Node-RED; custom logic lives in Go, not flows. See [root README](../README.md) and [pi/backend/README.md](../pi/backend/README.md).

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

---

## The Pivot: From Custom Stack to Community Stack (March 2026)

### What we built

Over several months, we built a full custom IoT stack from scratch:

- **Firmware** (TinyGo): 7,600 LOC. 3 board targets (RP2040, LoRa-E5, Heltec V3), 28 sensor drivers, a bytecode compute VM, edge rules engine, binary codec, AirConfig OTA system, custom LoRaWAN MAC handling.
- **Backend** (Go/PocketBase): 10,100 LOC. 50+ API endpoints, 5 custom binary decode formats, workflow engine with cron/triggers/delayed actions, LoRaWAN join/session management via ZMQ to Concentratord, WiFi transport, downlink queue, device provisioning with templates, firmware builder.
- **Frontend** (Angular 19): 13,300 LOC. 42 components, device config with pin mapping UI, board SVG visualisation, history charts, workflow builder, LoRaWAN frame monitor.

~30,000 lines of code. One developer. Bus factor of 1.

### Why we're walking away from it

Honest reasons:

1. **Maintenance terror.** Every new sensor is code. Every new board is ~800 LOC of hand-written radio driver. Every protocol change touches firmware + backend + frontend in lockstep. I'm the only person who can fix any of it.

2. **The firmware is the millstone.** 28 sensor drivers that Tasmota/ESPHome already maintain. A LoRaWAN MAC layer that ChirpStack handles better. A compute VM and rules engine that looked clever but weren't mature — and ESPHome's YAML automations match or exceed them for practical use.

3. **The backend is less capable than ChirpStack + HA combined.** I was proud of it, but when I actually compared feature-by-feature: ChirpStack has better LoRaWAN handling, more device codecs, FUOTA, multi-gateway support. Home Assistant has 3000+ integrations, mobile app, community dashboards, backup/restore. My backend's unique features (AirConfig, compute compiler, binary codec) only exist to serve my custom firmware — remove the firmware and they're pointless.

4. **Nobody can Google my error messages.** If a pump doesn't turn off at 2am, that's on me. With ChirpStack + HA, thousands of people have hit the same bugs before.

5. **On-device processing was over-engineered.** I built a bytecode VM and edge rules engine because I believed on-device intelligence was critical. For safety-critical stuff (pump shutoff), ESPHome's local automations handle it. For everything else, server-side HA automations are fine. I over-built for a problem that mostly doesn't exist in my use case.

### The journey in this conversation

Started by asking how FarMon differs from Tasmota. That led to:

- **Tasmota can't be a LoRaWAN end node** — maintainers explicitly said it won't happen (too power hungry, better options exist). Neither can ESPHome. So custom firmware can't be fully replaced... unless we use AT command modules.
- **RAK3172 / Wio-E5 over UART** — LoRaWAN modules that handle the protocol via AT commands. Pair with an ESP32 running ESPHome. One small custom component (~200 LOC C++) bridges them. Existing [ESP32-RAK3172 library](https://github.com/Kampi/ESP32-RAK3172) already does the hard part.
- **ESPHome > Tasmota when HA is the server** — ESPHome has native API, auto-discovery, config-as-code. Tasmota's independence is wasted when you have HA.
- **My backend is not better than ChirpStack + HA.** I validated this claim critically. The features where my backend wins (AirConfig, compute VM, binary codec) are all firmware-facing. Remove the firmware, and I'm left with a less tested, less documented, less capable version of community software.
- **HA OS is too locked down** — Buildroot-based, no apt, no package manager, no custom Docker containers. Can't run Concentratord or ChirpStack alongside it.
- **HA Supervised is being deprecated** (announced May 2025, 6-month deprecation period).
- **HA Container (Docker) is the only viable option** — gives full Linux (Raspberry Pi OS), Docker for everything, SSH, Tailscale for remote VPN access.

### What we're building now

**Raspberry Pi OS + Docker Compose** with:

- **Home Assistant Container** — automations, dashboards, mobile app
- **ChirpStack** — LoRaWAN network server (device management, codecs, downlinks)
- **PostgreSQL** — ChirpStack's database
- **Redis** — ChirpStack's session/cache
- **Mosquitto** — MQTT broker (HA ↔ ChirpStack ↔ devices)
- **ESPHome** — device firmware management (WiFi devices)
- **Tailscale** — VPN for secure remote access
- **Concentratord** — SX1302 HAT gateway (systemd service, not Docker)

**Device strategy:**
- Off-the-shelf LoRaWAN sensors (Dragino, Milesight) for remote monitoring — no firmware to write
- ESPHome on ESP32 for WiFi devices near infrastructure — YAML config, no code
- ESPHome + RAK3172/Wio-E5 (UART AT commands) for custom LoRaWAN nodes if needed — one small custom component

### What survives from the old stack

Almost nothing as code. Everything as lessons:

- The firmware taught us LoRaWAN, binary protocols, embedded constraints, and that commodity problems deserve commodity solutions.
- The backend taught us PocketBase, workflow engines, codec design, and that being the only person who understands the system is a liability, not an asset.
- The frontend taught us Angular, real-time IoT dashboards, and that community dashboards with drag-and-drop are what farmers actually want.
- The dev journal taught us to document decisions honestly, including the wrong ones.

### Lessons

1. **Build what's unique, buy/use what's commodity.** Sensor drivers, LoRaWAN stacks, MQTT brokers, dashboards — these are solved problems. Don't re-solve them.
2. **Bus factor of 1 is a product risk, not just a team risk.** If your customers can't get support without you personally, you don't have a product.
3. **On-device intelligence is insurance, not architecture.** Put smarts on the server, put safety fallbacks on the device. Don't build the whole system around edge compute.
4. **Pride in code is not a reason to keep it.** The code was good. Walking away from it is better.
5. **The ecosystem is the product.** HA's 3000+ integrations, community forums, and mobile app are worth more than any custom feature I could build alone.
