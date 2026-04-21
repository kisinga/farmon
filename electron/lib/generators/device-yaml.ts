import { stringify } from "yaml";
import type { BoardDef } from "../board.js";
import type { Manifest } from "../schema.js";
import { nodesWithFlag } from "../schema.js";
import { pumpSwitchId } from '@far-mon/core';
import type { CollectedCodegen } from "./collect.js";

/**
 * Generate the ESPHome device YAML from board definition + system manifest.
 * This replaces the hand-written pump-controller.yaml — OLED display pages,
 * boot sequence, and package includes are all driven by capabilities.
 */
export function generateDeviceYaml(
  board: BoardDef,
  m: Manifest,
  collected: CollectedCodegen,
): string {
  const dir = m.device.directory ?? m.device.name;
  const hasOled = !!board.peripherals.oled;
  const hasBattery = !!board.peripherals.battery;

  // --- Substitutions (inline, not a separate file) ---
  const subs: Record<string, string> = {
    device_name: m.device.name,
    friendly_name: m.device.friendly_name,
    update_interval: `${m.timing.update_interval}s`,
  };

  if (hasBattery) {
    subs.pin_battery_adc = board.peripherals.battery!.adc_pin;
    subs.battery_divider = String(board.peripherals.battery!.divider);
  }

  // Entity substitutions (non-pin, pre-collected)
  for (const [key, val] of Object.entries(collected.substitutions)) {
    subs[key] = val;
  }

  // Timing
  subs.valve_travel_time = `${m.timing.valve_travel_time}s`;
  subs.flow_watchdog = `"${m.timing.flow_watchdog}"`;
  subs.flow_confirm = `"${m.timing.flow_confirm}"`;
  subs.api_watchdog = `"${m.timing.api_watchdog}"`;

  // --- On-boot sequence ---
  const bootSteps: unknown[] = [];

  // OLED reset (must run before I2C init)
  if (hasOled) {
    const resetPin = board.peripherals.oled!.reset_pin;
    const gpioNum = resetPin.replace("GPIO", "");
    bootSteps.push({
      priority: 800,
      then: [
        {
          lambda: [
            `gpio_set_direction(GPIO_NUM_${gpioNum}, GPIO_MODE_OUTPUT);`,
            `gpio_set_level(GPIO_NUM_${gpioNum}, 0);`,
            "delay(10);",
            `gpio_set_level(GPIO_NUM_${gpioNum}, 1);`,
            "delay(10);",
          ].join("\n"),
        },
      ],
    });
  }

  // Splash screen (only if OLED)
  if (hasOled) {
    bootSteps.push({
      priority: 600,
      then: [
        { "display.page.show": "page_splash" },
        { "component.update": "oled" },
        { delay: "2s" },
        { "display.page.show": "page_runtime" },
        { "component.update": "oled" },
      ],
    });
  }

  // Safe defaults (always)
  const initVars = [
    "for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++) init_slot(i);",
    "queue_head = 0; queue_count = 0;",
    "id(system_state) = 0;",
    "id(api_lost_time) = 0;",
    "id(active_slot) = -1;",
    "for (int i = 0; i < NUM_VALVES; i++) close_valve_hw(i);",
    '// stop_reason intentionally NOT reset — survives reboot',
    `ESP_LOGI("ctrl", "Boot complete — IDLE (%d routes, %d slots)", NUM_ROUTES, MAX_CONCURRENT_ROUTES);`,
  ].join("\n");

  const bootActions: unknown[] = [];
  if (nodesWithFlag(m.nodes, 'isPump').length > 0) bootActions.push({ "switch.turn_off": pumpSwitchId() });
  bootActions.push({ lambda: initVars });

  bootSteps.push({
    priority: -100,
    then: bootActions,
  });

  // --- OLED display (only if board has one) ---
  const displayBlock = hasOled
    ? buildOledDisplay(board, m)
    : null;

  // --- Assemble the full device YAML as a string ---
  // We build this as a string rather than an object because ESPHome YAML
  // uses !include and !secret which aren't standard YAML.

  const lines: string[] = [];
  lines.push("# =============================================================================");
  lines.push(`# ${m.device.friendly_name} — ESPHome Device`);
  lines.push("# =============================================================================");
  lines.push("# AUTO-GENERATED from board definition + system manifest.");
  lines.push(`# Board: ${board.label}`);
  lines.push(`# Manifest: library/${dir}.yaml`);
  lines.push("#");
  lines.push("# State machine: IDLE -> PREPARING -> RUNNING -> STOPPING -> IDLE");
  lines.push("#                          '-------> FAULT <-------'");
  lines.push("#");
  lines.push(`# Routes: Defined in packages/routes.h (${m.routes.length} routes, 2 concurrent slots)`);
  lines.push(`# API: route_start(route_id)  route_stop(route_id)  stop_all  fault_reset(route_id)  fault_reset_all  queue_clear`);
  lines.push("# =============================================================================");
  lines.push("");

  // Substitutions
  lines.push("substitutions:");
  for (const [key, val] of Object.entries(subs)) {
    lines.push(`  ${key}: ${val}`);
  }
  lines.push("");

  // Packages
  lines.push("packages:");
  lines.push("  board: !include common/board.yaml");
  lines.push("  hardware: !include packages/hardware.yaml");
  lines.push("  sensors: !include packages/sensors.yaml");
  lines.push("  control: !include packages/control.yaml");
  lines.push("");

  // UART buses (for Modbus/RS485 devices)
  const buses = m.device.uart_buses ?? [];
  if (buses.length > 0) {
    lines.push("uart:");
    for (const bus of buses) {
      lines.push(`  - id: ${bus.id}`);
      lines.push(`    tx_pin: ${bus.tx_pin}`);
      lines.push(`    rx_pin: ${bus.rx_pin}`);
      if (bus.de_pin) lines.push(`    de_pin: ${bus.de_pin}`);
      lines.push(`    baud_rate: ${bus.baud_rate}`);
    }
    lines.push("");
    lines.push("modbus:");
    for (const bus of buses) {
      lines.push(`  - id: ${bus.id}_modbus`);
      lines.push(`    uart_id: ${bus.id}`);
    }
    lines.push("");
  }

  // ESPHome block
  lines.push("esphome:");
  lines.push(`  name: \${device_name}`);
  lines.push(`  friendly_name: \${friendly_name}`);
  lines.push("  includes:");
  lines.push("    - packages/routes.h");
  lines.push("  on_boot:");
  for (const step of bootSteps) {
    const s = step as { priority: number; then: unknown[] };
    lines.push(`    - priority: ${s.priority}`);
    lines.push(`      then:`);
    const thenYaml = stringify(s.then, {
      indent: 2,
      lineWidth: 0,
      defaultStringType: "PLAIN",
    });
    for (const line of thenYaml.split("\n")) {
      if (line.trim()) lines.push(`        ${line}`);
    }
  }
  lines.push("");

  // Display (if OLED)
  if (displayBlock) {
    lines.push(displayBlock);
  }

  return lines.join("\n") + "\n";
}

function buildOledDisplay(board: BoardDef, m: Manifest): string {
  const oled = board.peripherals.oled!;
  const resetPin = oled.reset_pin;

  // Generate level sensor lines dynamically (up to 2 fit side-by-side on 128px OLED)
  const displayLevelSensors = nodesWithFlag(m.nodes, 'isLevelSensor').slice(0, 2);
  const tankLines = displayLevelSensors.map((ls, i) => {
    const x = i === 0 ? 0 : 64;
    const name = ls['name'] as string;
    const id = ls['id'] as string;
    const label = name.length > 4 ? `L${i + 1}` : name;
    return `          if (id(${id}_level).has_state() && !std::isnan(id(${id}_level).state))
            it.printf(${x}, 39, id(font_body), "${label}: %.0f%%", id(${id}_level).state);`;
  }).join("\n");

  // The display lambda renders state machine info on the OLED
  const runtimeLambda = `|-
          // === Top bar ===
          it.printf(0, 0, id(font_top_bar), "\${friendly_name}");

          // Battery icon
          ${board.peripherals.battery ? `int bx = 48, by = 1;
          it.rectangle(bx, by, 20, 10);
          it.filled_rectangle(bx + 20, by + 3, 2, 4);
          if (id(battery_percent).has_state() && !std::isnan(id(battery_percent).state)) {
            int pct = (int)id(battery_percent).state;
            int fw = (16 * pct) / 100;
            if (pct > 0 && fw < 1) fw = 1;
            if (fw > 0) it.filled_rectangle(bx + 2, by + 2, fw, 6);
          }` : "// No battery on this board"}

          // WiFi bars
          int wx = 110;
          int wifi_bars = 0;
          if (id(wifi_dbm).has_state() && !std::isnan(id(wifi_dbm).state)) {
            float dbm = id(wifi_dbm).state;
            if (dbm > -85) wifi_bars = 1;
            if (dbm > -75) wifi_bars = 2;
            if (dbm > -65) wifi_bars = 3;
            if (dbm > -50) wifi_bars = 4;
          }
          for (int i = 0; i < 4; i++) {
            int bh = 3 + i * 2;
            int bar_x = wx + i * 3;
            int bar_y = 11 - bh;
            if (i < wifi_bars) it.filled_rectangle(bar_x, bar_y, 2, bh);
            else it.rectangle(bar_x, bar_y, 2, bh);
          }

          it.line(0, 12, 127, 12);

          // === State machine ===
          const char* states[] = {"IDLE", "PREP", "RUN", "STOP", "FAULT"};
          int st = id(system_state);
          it.printf(0, 15, id(font_top_bar), "%s", (st >= 0 && st <= 4) ? states[st] : "???");

          // Slot info (up to 2 lines)
          int y = 27;
          for (int s = 0; s < MAX_CONCURRENT_ROUTES && y < 46; s++) {
            if (slots[s].state >= 1 && slots[s].state <= 3 && slots[s].route_id >= 0) {
              uint32_t rt = (millis() - slots[s].start_time) / 1000;
              it.printf(0, y, id(font_body), "%s %um%us",
                        ROUTES[slots[s].route_id].name, rt / 60, rt % 60);
              y += 12;
            } else if (slots[s].state == 4 && slots[s].route_id >= 0) {
              const char* faults[] = {"", "NoFlow", "MaxRT", "API"};
              int f = slots[s].fault_code;
              it.printf(0, y, id(font_body), "F:%s %s",
                        ROUTES[slots[s].route_id].name,
                        (f >= 1 && f <= 3) ? faults[f] : "?");
              y += 12;
            }
          }

          // Tank levels
${tankLines}

          if (id(uptime_sec).has_state() && !std::isnan(id(uptime_sec).state)) {
            int total = (int)id(uptime_sec).state;
            it.printf(0, 52, id(font_body), "Up: %dh %dm", total / 3600, (total % 3600) / 60);
          }`;

  return `# --- OLED Display ------------------------------------------------------------
display:
  - platform: ${oled.platform}
    model: "${oled.model}"
    reset_pin: ${resetPin}
    address: 0x${oled.address.toString(16).toUpperCase()}
    id: oled
    update_interval: 1s
    pages:
      - id: page_splash
        lambda: |-
          it.image(34, 2, id(logo_splash));

      - id: page_runtime
        lambda: ${runtimeLambda}`;
}
