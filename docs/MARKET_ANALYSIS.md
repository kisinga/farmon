# Market Analysis — MajiFlow

Last updated: 2026-04-04

> **Positioning note (2026-05):** MajiFlow has broadened from "farm-only" to a generic water-orchestration platform applicable wherever water is pumped, stored, or distributed — irrigation systems, hospitality (hotels, resorts, lodges), greenhouses and nurseries, commercial buildings, livestock and aquaculture operations, schools and campuses. The market segments and competitors named below are factual references to the original entry market (rural irrigation pump control); the platform now competes in additional adjacent segments. Updates to this doc lag the product — treat the rural-irrigation framing below as one of several go-to-market lanes.

## What We Built

ESP32 (Heltec V3) controlling 1 pump + 4 motorized valves, 2 tank level sensors, 2 flow sensors, 3 configurable routes. On-device state machine with 6 fault codes. OLED display. HA integration via ESPHome. All safety logic runs locally — no server dependency.

**BOM: ~$60 (unit), ~$45-55 (wholesale 100+)**

## Market Gap

No existing product combines multi-valve routing + on-device safety logic + smart home integration + sub-$100 BOM. The market splits into two non-overlapping camps that each solve half the problem.

## Competitive Landscape

### Farm Pump Controllers (pump on/off from tank level)

| Product | Country | Price | Multi-Valve | Safety Logic | IoT/HA | Notes |
|---------|---------|-------|-------------|--------------|--------|-------|
| [Farmbot](https://farmbot.com.au/) | AU | AUD 500-1,600 | No | Basic | Proprietary | 8,000+ AU farmers. Satellite/cellular. Pump on/off only. |
| [Farmo](https://www.farmo.com.au/pages/farmo-pricing) | AU | AUD 300-600 + $15/mo | No | No | Proprietary | NB-IoT/LTE-M. Subscription required. |
| [Smart Water SW900](https://smartwateronline.com/) | NZ | NZD 800-1,500 | No | Comms loss only | No | ISM radio, 5km range. Legacy product. |
| [EcoSAT](https://www.stationinnovation.com.au/) | AU | AUD 800-2,500+ | No | No | No | Satellite. Outback stations. |
| [InnovateIOT](https://innovateiot.net.au/) | AU | AUD 700-950 | Separate device | No | No | Each component sold separately. |
| [DATRAN](https://www.datran.com.au/) | AU | AUD 1,000-3,000+ | Via PLC | Via PLC | Modbus | Industrial RTU. Professional install. |

### Irrigation Controllers (multi-valve scheduling)

| Product | Price | Pump Control | Tank Routing | Safety State Machine |
|---------|-------|-------------|--------------|---------------------|
| [OpenSprinkler](https://opensprinkler.com/) | $140-183 | Relay only | No | No |
| [Hunter Hydrawise](https://www.hydrawise.com/) | $375-500 | Relay only | No | No |
| [Galcon GSI PRO](https://www.galconc.com/) | $200-600 | Yes | No | No |
| [ESPHome Sprinkler](https://esphome.io/components/sprinkler/) | Free (SW) | Yes | No | No |

### Smart Pump Monitors

| Product | Price | Valve Control | Routing | Notes |
|---------|-------|--------------|---------|-------|
| [DROP Pump Controller](https://dropconnect.com/) | $1,500-1,900 | No | No | Well pump. Needs proprietary hub. |
| [PumpSpy](https://pumpspy.com/) | $150-200 | No | No | Sump pump monitoring only. |
| [Grundfos CU301](https://www.grundfos.com/) | $430-770 | No | No | Single pump pressure control. |

### Chinese / AliExpress Options

| Product | Price (retail) | Price (wholesale) | Multi-Valve | On-Device Logic |
|---------|---------------|-------------------|-------------|-----------------|
| Tuya WiFi level controller | $12-30 | $6-15 | No (1 relay) | No (cloud) |
| Tuya WiFi ball valve (Aubess/Moes) | $15-35 each | $8-20 | 1 per unit | No |
| [Kincony KC868-A8](https://www.kincony.com/) | $55-75 | — | 8 relays | Blank — needs firmware |
| Coolmay CX2N PLC | $60-120 | $50-90 | Yes | Yes (ladder logic) |
| Tuya full stack (6-10 devices) | $150-300 | — | Fragile | Cloud scenes only |
| GSM 4-ch relay (Konlen CL4-GSM) | $30-50 | $15-30 | 4 relays | No (SMS toggle) |
| 4G relay modules (SIM7600) | $35-60 | $20-40 | Varies | No |

**Key finding:** Kincony KC868-A8 is the closest hardware equivalent (~$60, ESP32, 8 relays, ESPHome-compatible) but ships with zero water management firmware. Chinese PLCs can be programmed to match but have no WiFi/app/HA integration.

### Indian Multi-Tank Controllers

| Product | Price | Multi-Tank | IoT | Notes |
|---------|-------|-----------|-----|-------|
| [Vukar](https://submersibleshop.com/) | ~$52 | Yes (up to 50) | No (wired) | Closest functional competitor. Solenoid valves. Dry-run protection. |
| [Waltr V](https://www.waltr.in/waltr-v) | ~$35-95 | Sequential fill | Proprietary app | Separate devices, no integrated system. |
| [Sensoware](https://www.sensoware.com/) | $35-6,000 | Yes | No | Industrial/commercial. Motorized valves. |
| [Ktronics](https://www.ktronics.global/) | ~$47 | Dual tank | Basic WiFi | Single purpose per model. |

India is the most active market for multi-tank controllers. Vukar solves the same routing problem but wired-only, no IoT.

### South/East African Options

| Product | Price | Notes |
|---------|-------|-------|
| [HenracTech](https://henractech.co.za/) | ZAR 1,190 (~$65) | 5-level detection, Tuya, single pump. |
| [OneB](https://oneb.co.za/) | ZAR 949 (~$52) | Same as HenracTech. Single tank/pump. |
| [Letsijo Smarta](https://letsijo.co.za/) | Enterprise | Cloud telemetry for boreholes. Municipal scale. |
| [SunCulture](https://sunculture.io/) | ~$600-1,250 | Solar pump + IoT. Kenya. Pay-as-you-go. |

South Africa proves the sub-$100 price point works. No multi-tank routing products exist.

### Adjacent Markets

| Market | Closest Product | Price | Gap |
|--------|----------------|-------|-----|
| Rainwater harvesting | [Graf Aqua-Center](https://www.graf.info/) | EUR 800-1,200 | Rain vs mains switching only. No multi-tank. |
| Marine/RV | [Simarine Pico](https://simarine.net/) | $350-1,200+ | Monitoring + generic relays. No routing. |
| Hydroponics | [Growlink ValveLINK](https://shop.growlink.com/) | $699+ | 8-valve, sensor-based. Cloud-dependent. No tank routing. |
| Pool | [Pentair IntelliCenter](https://www.pentair.com/) | $2,499-5,799 | Multi-valve water automation. Pool-specific. |
| Water treatment | RO controllers | $100-500 | Fixed filtration sequences only. |
| Off-grid | [RPS Solar Pumps](https://www.rpssolarpumps.com/) | $499+ | Single pump/tank. Solar-optimized. |
| Crowdfunding | Nothing in this space | — | All crowdfunded water projects are irrigation or aquarium. |

### HA/DIY Community

All existing projects are either single-tank or put all logic in HA/Node-RED (no on-device safety). Nobody has built a replicable multi-tank routing system with on-device fault detection.

- [HA Community — Bore pump control](https://community.home-assistant.io/t/controlling-bore-pump-with-tank-level-input/868393)
- [HA Community — Tank level + ESPHome](https://community.home-assistant.io/t/water-tank-level-and-water-volume-with-esphome/192666)
- [GitHub — ha-esp-flowmeter](https://github.com/Archinamon/ha-esp-flowmeter)
- [Hackster — WaterTank SCADA (Node-RED)](https://www.hackster.io/Pratik_Roy98/watertank-supervisory-control-and-data-visualization-cc3f6f)

## Cloud Dependency — Critical Differentiator

| System | Internet down | WiFi down | Cloud dies | On-device safety |
|--------|--------------|-----------|------------|-----------------|
| **MajiFlow** | Safety + schedules run. On-device dashboard and panel buttons work over the LAN. | Safety + schedules run. Panel buttons and OLED keep working. | No impact. | Full state machine. |
| Tuya stack | Schedules stop. LocalTuya works. | Stuck in last state. | Brick without pre-extracted keys. | None. |
| Farmbot/Farmo | No control. | N/A (cellular) | No control. | None. |
| HA-only DIY | No remote. Local automations run. | Pump uncontrolled. | N/A. | None — logic is server-side. |
| GSM relay | Works (SMS). | Works (SMS). | N/A. | None — dumb on/off. |
| Chinese PLC | Runs forever. | N/A. | N/A. | Full (if programmed). |

Tuya automations run on Tuya's cloud servers. If internet drops, schedules stop. The device retains last state but has no autonomous logic. This is a disqualifying weakness for safety-critical water infrastructure.

> **Local tier note (2026-07):** the MajiFlow row above reflects the completed local tier — automation sets persist to flash (schedules survive reboots and power cuts with no server reachable), physical panel buttons are mapped automatically (Button 1 = Stop All, later buttons toggle routes), and `local.ui` serves the full operator dashboard from the device itself over the site LAN. An optional DS3231 RTC (`local.rtc`) makes time-based schedules fully offline; without it they need NTP reachability. The cloud subscription now adds only remote reach, alerts, history and multi-site coordination — it is off the critical path for daily operation.

## Remote Access Without Cloud

| Method | Needs Internet | Range | Cost | Autonomous Safety |
|--------|---------------|-------|------|-------------------|
| ESPHome + HA + Tailscale | At site | Global via VPN | Free | Yes (on ESP32) |
| LoRaWAN (Heltec V3 has SX1262) | No | 2-15 km | $0 extra (built-in) | Yes |
| GSM/SMS relay | No (cellular) | Global | $15-60 + SIM | No |
| Shelly Pro 4G | No (4G modem) | Global | $50-70 | Partial |
| 4G SIM module add-on (A7670/SIM7600) | No (cellular) | Global | +$10-15 BOM | Yes (on ESP32) |

The Heltec V3 already has LoRa — remote operation at zero additional BOM cost.

## Unique Position

No product in any market combines:

1. Multi-valve route selection (source -> destination with valve sequencing)
2. On-device safety state machine (not server-dependent)
3. Multiple watchdog types (flow, level rise, runtime, API loss, source empty)
4. Home Assistant integration (open ecosystem, no subscription)
5. Sub-$100 BOM

## Pricing Strategy

> The DIY-kit / 4-tier USD model below was superseded 2026-06 by the two-product
> model. (Currency moved to KES for the East-Africa launch market.)

### Two products

One axis: **where the brain lives and who owns it.** Same firmware + on-device safety in both. (KES, set 2026-06, not final.)

| Product | Brain | Cross-controller | Remote access | Price |
|---------|-------|------------------|---------------|-------|
| **Hosted (Managed)** | Our cloud | No — each controller an island | We host it | Transparent, from **KES 30,000/controller** + **4,000/yr** |
| **On-Prem (Custom)** | Customer's on-site box (battery+solar) | Yes — controllers coordinate | Customer's own VPN; never proxied by us | Bespoke, **from KES 200,000** |

### Hosted pricing — the controller-bundle unit

Sold in **controller bundles**. One bundle (KES 30,000) is a complete working system: KC868 controller + pump control + 1 valve + 1 flow sensor + 1 tank monitor + cloud onboarding. Grow it by adding peripherals on the same board up to the KC868-A16 hardware caps; past a cap, buy another full bundle.

| Line item | Price (KES) | Per-controller cap |
|-----------|-------------|--------------------|
| Controller bundle (incl. 1 pump + 1 valve + 1 flow + 1 tank) | 30,000 | — |
| Extra pump relay (30A max, ~2 hp single-phase) | 3,000 *(placeholder, confirm)* | shares the 16-relay pool (1 relay each) |
| 3-phase pump (VFD over RS485) | included, no relay cost | RS485 bus, 0 relays; not all inverter brands supported yet |
| Extra valve (≤3/4") | 3,000 | shares the relay pool (2 relays each) — 7 valves w/ one relay pump |
| Extra flow sensor (≤3/4") | 3,000 | 3 (pulse-counter pins) |
| Extra tank monitor | 4,000 | 4 (ADC pins) |
| Additional controller (full bundle) | 30,000 | — |
| Hosted upkeep | 4,000/yr (after year 1) | per site |

Single-phase pumps and valves compete for the same 16 relays, so more pumps means fewer valves per controller: `K = max(1, ⌈(pumps + 2·valves)/16⌉, ⌈flow/3⌉, ⌈tanks/4⌉)`. 3-phase (VFD) pumps use RS485, not relays, so they drop out of the relay term (`pumps→0`).

- **>3/4" valves/flow** are custom-quoted: the bundled standard item is credited (−2,500) and the larger one quoted. Valve and flow sizes are independent.
- **Single-phase pumps over ~2 hp (>30A, 240V)** are custom-quoted: the standard 30A relay drives a single-phase pump up to ~2 hp (1.5 kW) directly; a bigger motor adds a contactor (same dynamic-pricing pattern as the pipe-diameter rule). **3-phase pumps** sidestep this: they run on their own VFD/inverter over RS485 (0 relays, no relay cost), where the inverter brand is supported.
- **Estimator:** the public `/pricing` page computes this live from three questions (lines → valves, metering points → flow, tanks → tank monitors) and captures consent-gated leads (`leads` collection).

### Margin & scaling

Full-bundle BOM ≈ KES 18,000 (controller ~7k + valve ~1.8k + flow ~1k + pressure ~3k + PSU/enclosure/wiring ~5k) → ~40% gross at 30k; add-ons ~25–65%. Per-unit hardware margin is linear — the **scalable spine is the 4,000/yr recurring (ARR)**, so keep it worth paying (uptime SLA, alerts, history). The real ceiling later is CAC + support per low-ticket sale, not margin.

### Go-to-Market

Lowest friction path (how OpenSprinkler did it):

1. Open-source the ESPHome config
2. Sell assembled boards on Tindie / own site
3. Post build guide on HA forums + r/homeassistant
4. Early adopters validate, then scale to complete kits

### Connectivity Variants (same board, different firmware)

| Variant | Connectivity | Use Case | BOM Premium |
|---------|-------------|----------|-------------|
| Base | WiFi + ESPHome API | On-site with HA | Baseline |
| LoRa | LoRaWAN (SX1262 already on Heltec V3) | Remote pump sites | +$0 |
| Cellular | Add SIM7600/A7670 module | No WiFi, no LoRa gateway | +$10-15 |
| SMS fallback | Same SIM module, SMS commands | Emergency "text STOP" | +$0 |

## Risks

| Risk | Mitigation |
|------|-----------|
| Niche market (not everyone has multi-tank) | Those who do have zero options. Start with HA community. |
| Chinese clone | Firmware/state machine is the moat, not the PCB. |
| Certification (FCC/CE/ICASA) | Heltec V3 is pre-certified. Enclosure-level certification still needed. |
| Support burden | Open-source community handles tier-1. Sell hardware, not consulting. |
| Farmbot/Farmo add valve routing | Unlikely — different architecture (cellular sensor, no local logic). |
