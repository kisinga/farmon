# Market Analysis — MajiFlow

Last updated: 2026-04-04

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
| **MajiFlow** | Safety runs. HA overlay lost. | Safety runs. OLED shows status. | No impact. | Full state machine. |
| Tuya stack | Schedules stop. LocalTuya works. | Stuck in last state. | Brick without pre-extracted keys. | None. |
| Farmbot/Farmo | No control. | N/A (cellular) | No control. | None. |
| HA-only DIY | No remote. Local automations run. | Pump uncontrolled. | N/A. | None — logic is server-side. |
| GSM relay | Works (SMS). | Works (SMS). | N/A. | None — dumb on/off. |
| Chinese PLC | Runs forever. | N/A. | N/A. | Full (if programmed). |

Tuya automations run on Tuya's cloud servers. If internet drops, schedules stop. The device retains last state but has no autonomous logic. This is a disqualifying weakness for safety-critical water infrastructure.

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

### Tiers

| Tier | Contents | Price | Margin | Target |
|------|----------|-------|--------|--------|
| DIY Kit | PCB + firmware guide, no peripherals | $99-129 | 60-70% | HA makers |
| Controller Unit | Assembled + enclosure + OLED, pre-flashed | $179-229 | 55-65% | Prosumer, small farm |
| Complete System | Controller + 4 valves + 2 level + 2 flow + wiring | $449-549 | 45-55% | Turnkey buyers |
| Pro / Custom | Complete + install consultation + custom routes | $699-899 | 50-60% | Rural properties |

### Price Positioning

```
$30         $100        $200        $500        $1000       $2000
 |           |           |           |           |           |
 Tuya junk   DIY Kit    Controller  Complete    Farmbot     DATRAN/PLC
 HenracTech  OpenSprklr  ▲          System      Farmo+sub
 Vukar(IN)              SWEET SPOT              Smart Water
```

### Regional Pricing

| Market | Entry Point | Notes |
|--------|-------------|-------|
| HA/maker (global) | DIY Kit @ $99 | Loss-leader. They blog and review it. |
| Australia rural | Complete @ AUD 549 | Undercuts Farmbot. Government grants up to AUD 50K available (VIC/SA/QLD). |
| South Africa | Controller @ ZAR 2,999 (~$165) | "HenracTech Pro" positioning. |
| India | Controller @ INR 12,999 (~$155) | Premium to Vukar but with WiFi/HA/display. |
| US off-grid | Complete @ $549 | "Your water keeps running when the internet doesn't." |

### Revenue Model

**Hardware-only (recommended to start).** No subscriptions. Differentiates from Farmbot/Farmo and builds trust in the HA community. Optional later:

- Cloud dashboard for non-HA users (free monitoring, $3-5/mo for alerts/history)
- Firmware customization service ($50-150 per engagement)

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
