/**
 * Integration tests: self-test firmware generation for KC868-A16 and Heltec V3.
 *
 * Verifies that the generated files are structurally correct, board-specific
 * features are included/excluded, and ESPHome component IDs are consistent
 * between the device YAML and C++ sequencer.
 *
 * Usage: npx tsx test/selftest-codegen.test.ts
 */

import * as path from "node:path";
import { loadBoard, type BoardDef } from "../electron/lib/board.js";
import { generateSelfTest } from "../electron/lib/self-test/index.js";
import type { GeneratedFile } from "../electron/lib/generate.js";

const DEFAULTS = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults");

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
    failed++;
  }
}

function getFile(files: GeneratedFile[], suffix: string): string {
  for (const f of files) {
    if (f.relativePath.endsWith(suffix)) return f.content;
  }
  throw new Error(`No generated file ending with "${suffix}"`);
}

// =============================================================================
// KC868-A16 Self-Test
// =============================================================================

console.log("Self-Test Codegen Integration Tests");
console.log("====================================\n");

console.log("KC868-A16 Self-Test:");

const kc868Board = loadBoard(path.join(DEFAULTS, "boards/kc868-a16"));
const kc868Files = generateSelfTest(kc868Board);

assert(kc868Files.length === 5, `Generates ${kc868Files.length} files (expected 5)`);

// --- Board package ---
const kc868BoardPkg = getFile(kc868Files, "common/board.yaml");
assert(kc868BoardPkg.includes("esp32"), "Board package has ESP32 MCU");
assert(kc868BoardPkg.includes("ethernet"), "Board package has Ethernet");
assert(!kc868BoardPkg.includes("wifi:"), "Board package has no WiFi");
assert(kc868BoardPkg.includes("pcf8574"), "Board package has PCF8574 expanders");

// --- Device YAML ---
const kc868Device = getFile(kc868Files, "selftest-kc868-a16.yaml");
assert(kc868Device.includes("selftest-kc868-a16"), "Device name correct");
assert(kc868Device.includes("self-test.h"), "Includes self-test.h");
assert(kc868Device.includes("selftest::init()"), "Boot calls selftest::init()");
assert(kc868Device.includes("selftest::tick()"), "Interval calls selftest::tick()");

// Relay switches (16 relays)
const relayMatches = kc868Device.match(/st_relay_out\d+/g) ?? [];
assert(relayMatches.length >= 16, `Has ${relayMatches.length} relay switch IDs (expect >= 16)`);

// Input binary sensors (16 inputs)
const inputMatches = kc868Device.match(/st_input_in\d+/g) ?? [];
assert(inputMatches.length >= 16, `Has ${inputMatches.length} input sensor IDs (expect >= 16)`);

// ADC sensors (4 ADCs)
const adcMatches = kc868Device.match(/st_adc_gpio\d+/g) ?? [];
assert(adcMatches.length >= 4, `Has ${adcMatches.length} ADC sensor IDs (expect >= 4)`);

// Per-test entities
assert(kc868Device.includes("st_result_i2c"), "Has I2C test result entity");
assert(kc868Device.includes("st_result_relay_cycle"), "Has relay test result entity");
assert(kc868Device.includes("st_result_digital_inputs"), "Has input test result entity");
assert(kc868Device.includes("st_result_adc"), "Has ADC test result entity");
assert(kc868Device.includes("st_result_sensor_headers"), "Has sensor test result entity");
assert(kc868Device.includes("st_result_eth"), "Has Ethernet test result entity");

// KC868 should NOT have these
assert(!kc868Device.includes("st_result_oled"), "No OLED test (board has no OLED)");
assert(!kc868Device.includes("st_result_lora"), "No LoRa test (board has no LoRa)");
assert(!kc868Device.includes("st_result_wifi"), "No WiFi test (board has Ethernet)");
assert(!kc868Device.includes("st_result_battery"), "No battery test (board has no battery)");
assert(!kc868Device.includes("st_result_led"), "No LED test (board has no LED)");

// --- C++ Sequencer ---
const kc868Seq = getFile(kc868Files, "self-test.h");
assert(kc868Seq.includes("namespace selftest"), "Has selftest namespace");
assert(kc868Seq.includes("I2C_SCAN"), "Has I2C_SCAN phase");
assert(kc868Seq.includes("RELAY_CYCLE"), "Has RELAY_CYCLE phase");
assert(kc868Seq.includes("DIGITAL_INPUTS"), "Has DIGITAL_INPUTS phase");
assert(kc868Seq.includes("ADC_BASELINE"), "Has ADC_BASELINE phase");
assert(kc868Seq.includes("SENSOR_HEADERS"), "Has SENSOR_HEADERS phase");
assert(kc868Seq.includes("ETH_PHY"), "Has ETH_PHY phase");
assert(!kc868Seq.includes("OLED_DISPLAY"), "No OLED_DISPLAY phase");
assert(!kc868Seq.includes("LORA_SPI"), "No LORA_SPI phase");
assert(!kc868Seq.includes("WIFI_SCAN"), "No WIFI_SCAN phase");

// Expander addresses
assert(kc868Seq.includes("0x24"), "Has expander addr 0x24");
assert(kc868Seq.includes("0x25"), "Has expander addr 0x25");
assert(kc868Seq.includes("0x22"), "Has expander addr 0x22");
assert(kc868Seq.includes("0x21"), "Has expander addr 0x21");
assert(kc868Seq.includes("NUM_EXPANDERS = 4"), "4 expanders");
assert(kc868Seq.includes("NUM_RELAYS = 16"), "16 relays");
assert(kc868Seq.includes("NUM_INPUTS = 16"), "16 inputs");

// Relay readback via I2C
assert(kc868Seq.includes("i2c_read_reg"), "Has I2C relay readback");
assert(kc868Seq.includes("i2c_probe"), "Has I2C bus scan");

// --- Dashboard ---
const kc868Dash = getFile(kc868Files, "selftest-kc868-a16.yaml");
// The dashboard file is also named selftest-kc868-a16.yaml but in dashboards dir
const kc868DashFiles = kc868Files.filter(f => f.relativePath.includes("dashboards"));
assert(kc868DashFiles.length === 1, "Generates 1 dashboard file");
const kc868DashContent = kc868DashFiles[0].content;
assert(kc868DashContent.includes("Self-Test"), "Dashboard title contains Self-Test");
assert(kc868DashContent.includes("Test Progress"), "Dashboard has test progress gauge");
assert(kc868DashContent.includes("Test Results"), "Dashboard has test results section");

// =============================================================================
// Heltec V3 Self-Test
// =============================================================================

console.log("\nHeltec V3 Self-Test:");

const heltecBoard = loadBoard(path.join(DEFAULTS, "boards/heltec-v3"));
const heltecFiles = generateSelfTest(heltecBoard);

assert(heltecFiles.length === 5, `Generates ${heltecFiles.length} files (expected 5)`);

// --- Device YAML ---
const heltecDevice = getFile(heltecFiles, "selftest-heltec-v3.yaml");
assert(heltecDevice.includes("selftest-heltec-v3"), "Device name correct");
assert(heltecDevice.includes("st_result_oled"), "Has OLED test result entity");
assert(heltecDevice.includes("st_result_lora"), "Has LoRa test result entity");
assert(heltecDevice.includes("st_result_wifi"), "Has WiFi test result entity");
assert(heltecDevice.includes("st_result_battery"), "Has battery test result entity");
assert(heltecDevice.includes("st_result_led"), "Has LED test result entity");
assert(heltecDevice.includes("st_result_vext"), "Has Vext test result entity");

// Heltec should NOT have these
assert(!heltecDevice.includes("st_result_i2c"), "No I2C expander test (no expanders)");
assert(!heltecDevice.includes("st_result_relay_cycle"), "No relay test (no relays)");
assert(!heltecDevice.includes("st_result_digital_inputs"), "No input test (no optocoupled inputs)");
assert(!heltecDevice.includes("st_result_eth"), "No Ethernet test (WiFi board)");

// --- C++ Sequencer ---
const heltecSeq = getFile(heltecFiles, "self-test.h");
assert(heltecSeq.includes("OLED_DISPLAY"), "Has OLED_DISPLAY phase");
assert(heltecSeq.includes("LORA_SPI"), "Has LORA_SPI phase");
assert(heltecSeq.includes("WIFI_SCAN"), "Has WIFI_SCAN phase");
assert(heltecSeq.includes("BATTERY_ADC"), "Has BATTERY_ADC phase");
assert(heltecSeq.includes("LED_BLINK"), "Has LED_BLINK phase");
assert(!heltecSeq.includes("I2C_SCAN"), "No I2C_SCAN phase");
assert(!heltecSeq.includes("RELAY_CYCLE"), "No RELAY_CYCLE phase");
assert(!heltecSeq.includes("ETH_PHY"), "No ETH_PHY phase");

// WiFi scan
assert(heltecSeq.includes("esp_wifi_scan_start"), "Has WiFi scan code (esp-idf)");

// LoRa SPI
assert(heltecSeq.includes("SX1262"), "Has SX1262 chip reference");

// OLED patterns
assert(heltecSeq.includes("Wire.beginTransmission") || heltecSeq.includes("oled"), "Has OLED I2C probe");

// LED blink
assert(heltecSeq.includes("led_output"), "Has LED output reference");

// =============================================================================
// Cross-board consistency checks
// =============================================================================

console.log("\nCross-board consistency:");

// Both boards should have common structure
for (const [name, files] of [["KC868-A16", kc868Files], ["Heltec V3", heltecFiles]] as const) {
  const device = files.find(f => f.relativePath.includes(".yaml") && !f.relativePath.includes("board") && !f.relativePath.includes("secrets") && !f.relativePath.includes("dashboards"))!;
  const seq = files.find(f => f.relativePath.endsWith("self-test.h"))!;
  assert(device.content.includes("st_progress"), `${name}: Has progress sensor`);
  assert(device.content.includes("st_overall"), `${name}: Has overall result sensor`);
  assert(device.content.includes("st_phase"), `${name}: Has phase text sensor`);
  assert(device.content.includes("st_log"), `${name}: Has log text sensor`);
  assert(device.content.includes("st_run"), `${name}: Has run button`);
  assert(seq.content.includes("void init()"), `${name}: Sequencer has init()`);
  assert(seq.content.includes("void start()"), `${name}: Sequencer has start()`);
  assert(seq.content.includes("void tick()"), `${name}: Sequencer has tick()`);
  assert(seq.content.includes("TOTAL_TESTS"), `${name}: Sequencer has TOTAL_TESTS`);
}

// =============================================================================
// Summary
// =============================================================================

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
