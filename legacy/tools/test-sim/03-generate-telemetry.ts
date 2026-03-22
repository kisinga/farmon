/**
 * Step 3: Generate realistic telemetry for all devices.
 *
 * Injects uplinks via /api/farmon/test/inject-uplink — data flows through
 * the real decode engine (text_kv / binary_frames) + DB writes + workflows.
 *
 *   Water Monitor:  text_kv on fPort 2 — flow pulses, total volume, battery
 *   Solar Farm:     text_kv on fPort 2 — inverter, battery, flow, environment
 *   SenseCAP:       binary_frames on fPort 2 — soil moisture, soil temp
 *
 * ~2016 records per device, ~6000 total.
 */
import {
  PB_URL, DEVICES, INTERVAL_SEC, DAYS,
  timestamps, hourOfDay, dayIndex, solarCurve, noise, clamp, round,
  step, ok, info, err,
} from "./config.js";

const INJECT_URL = `${PB_URL}/api/farmon/test/inject-uplink`;

// ─── Payload encoders ───────────────────────────────────────────

/** Encode key:value pairs as text_kv payload (same format the FarMon firmware sends). */
function encodeTextKV(data: Record<string, number>): string {
  const text = Object.entries(data).map(([k, v]) => `${k}:${v}`).join(",");
  return Buffer.from(text).toString("hex");
}

/** Encode SenseCAP binary_frames payload: 7-byte frames (channel, type_id_le16, value_le32). */
function encodeSenseCAP(soilMoisture: number, soilTemp: number): string {
  // type_id 1794 = soil_moisture, 1795 = soil_temperature
  // values are raw * 1000 (int32 LE), decoded via "value / 1000" transform
  const buf = Buffer.alloc(14); // 2 frames × 7 bytes
  // Frame 1: channel=1, type=0x0702 (1794), value=moisture*1000
  buf.writeUInt8(1, 0);
  buf.writeUInt16LE(1794, 1);
  buf.writeInt32LE(Math.round(soilMoisture * 1000), 3);
  // Frame 2: channel=2, type=0x0703 (1795), value=temp*1000
  buf.writeUInt8(2, 7);
  buf.writeUInt16LE(1795, 8);
  buf.writeInt32LE(Math.round(soilTemp * 1000), 10);
  return buf.toString("hex");
}

// ─── Inject helper ──────────────────────────────────────────────

async function inject(deviceEui: string, fport: number, payloadHex: string, rssi: number, snr: number) {
  const res = await fetch(INJECT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_eui: deviceEui, fport, payload_hex: payloadHex, rssi, snr }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`inject failed (${res.status}): ${body}`);
  }
}

// ─── Telemetry generators ───────────────────────────────────────

function* waterMonitorTelemetry(): Generator<{ ts: Date; payloadHex: string; rssi: number; snr: number }> {
  let totalVolume = 12450;
  let battery = 95;

  for (const ts of timestamps(INTERVAL_SEC)) {
    const h = hourOfDay(ts);
    const isIrrigating = (h >= 6 && h < 7) || (h >= 17 && h < 18);
    const basePulses = isIrrigating ? 60 + noise(15) : noise(3);
    const pd = round(clamp(basePulses, 0, 120), 0);

    totalVolume += pd * 0.0022;
    const tv = round(totalVolume, 1);

    const solarBoost = solarCurve(ts) * 0.02;
    battery = clamp(battery - 0.0002 + solarBoost + noise(0.01), 65, 100);
    const bp = round(battery, 1);

    const payloadHex = encodeTextKV({ pd, tv, bp, tx: 300 });
    yield { ts, payloadHex, rssi: Math.round(-85 + noise(5)), snr: round(7 + noise(1.5), 1) };
  }
}

function* solarFarmTelemetry(): Generator<{ ts: Date; payloadHex: string; rssi: number; snr: number }> {
  let totalKwh = 8234;
  let totalFlow = 45200;
  let batSoc = 72;

  for (const ts of timestamps(INTERVAL_SEC)) {
    const h = hourOfDay(ts);
    const day = dayIndex(ts);
    const sun = solarCurve(ts);

    const cloudFactor = (day % 3 === 1 && h > 10 && h < 15) ? 0.4 + Math.random() * 0.4 : 0.9 + Math.random() * 0.1;
    const effectiveSun = sun * cloudFactor;

    const pvPower = round(effectiveSun * 5200 + noise(50), 0);
    const pvVoltage = pvPower > 0 ? round(320 + effectiveSun * 30 + noise(3), 1) : 0;
    const gridPower = round(pvPower * 0.97 + noise(20), 0);
    const gridVoltage = round(230 + noise(3), 1);
    const invTemp = round(25 + effectiveSun * 30 + noise(2), 1);

    const dailyIncrement = (pvPower / 1000) * (INTERVAL_SEC / 3600);
    const dailyKwh = round(h < 0.1 ? 0 : dailyIncrement, 2);
    totalKwh += dailyIncrement;

    const chargePower = round(effectiveSun * 800 + noise(20), 0);
    const dischargePower = sun < 0.05 ? 120 + noise(20) : 0;
    batSoc = clamp(batSoc + (chargePower - dischargePower) * INTERVAL_SEC / (48 * 200 * 3600) * 100, 20, 100);
    const batV = round(48 + (batSoc / 100) * 6 + noise(0.2), 2);

    const isIrrigating = (h >= 6 && h < 6.5) || (h >= 17 && h < 17.5);
    const flowRate = isIrrigating ? round(25 + noise(3), 1) : round(clamp(noise(0.5), 0, 2), 1);
    totalFlow += flowRate * (INTERVAL_SEC / 60);

    const tempBase = 26 + 8 * Math.sin((h - 8) * Math.PI / 12);
    const temperature = round(clamp(tempBase + noise(1) + day * 0.3, 12, 42), 1);
    const humBase = 70 - 20 * Math.sin((h - 8) * Math.PI / 12);
    const humidity = round(clamp(humBase + noise(3), 25, 95), 1);

    const payloadHex = encodeTextKV({
      grid_v: gridVoltage,
      grid_p: Math.max(0, gridPower),
      pv_v: pvVoltage,
      pv_p: Math.max(0, pvPower),
      daily_kwh: round(dailyKwh, 2),
      total_kwh: round(totalKwh, 1),
      inv_temp: clamp(invTemp, 20, 75),
      bat_v: batV,
      bat_soc: round(batSoc, 1),
      charge_p: Math.max(0, chargePower) - dischargePower,
      flow_rate: Math.max(0, flowRate),
      total_flow: round(totalFlow, 0),
      temperature,
      humidity,
      bp: round(clamp(90 + solarCurve(ts) * 5 + noise(0.5), 75, 100), 1),
      tx: 300,
    });

    yield { ts, payloadHex, rssi: Math.round(-92 + noise(4)), snr: round(5.5 + noise(1), 1) };
  }
}

function* soilSensorTelemetry(): Generator<{ ts: Date; payloadHex: string; rssi: number; snr: number }> {
  let soilMoisture = 45;

  for (const ts of timestamps(INTERVAL_SEC)) {
    const h = hourOfDay(ts);
    const day = dayIndex(ts);

    soilMoisture -= 0.0007;
    const irrigationSpike = ((h >= 6.4 && h < 6.6) || (h >= 17.4 && h < 17.6)) ? 8 + noise(2) : 0;
    soilMoisture = clamp(soilMoisture + irrigationSpike + noise(0.3), 12, 65);

    const soilTempBase = 22 + 4 * Math.sin((h - 10) * Math.PI / 14);
    const soilTemp = round(clamp(soilTempBase + noise(0.5) + day * 0.15, 14, 32), 1);

    const payloadHex = encodeSenseCAP(round(soilMoisture, 1), soilTemp);
    yield { ts, payloadHex, rssi: Math.round(-98 + noise(3)), snr: round(3 + noise(1.2), 1) };
  }
}

// ─── Batch inject ─────────────────────────────────────────────

async function generateForDevice(
  deviceEui: string,
  deviceName: string,
  fport: number,
  generator: Generator<{ ts: Date; payloadHex: string; rssi: number; snr: number }>
) {
  step(`Injecting telemetry for ${deviceName} (${deviceEui}) → fPort ${fport}`);

  let count = 0;
  for (const point of generator) {
    await inject(deviceEui, fport, point.payloadHex, point.rssi, point.snr);
    count++;
    if (count % 500 === 0) {
      info(`  ${count} uplinks...`);
    }
  }

  ok(`${count} uplinks injected (decoded by backend)`);
  return count;
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  info(`Injecting ${DAYS} days of telemetry at ${INTERVAL_SEC}s intervals via pipeline`);
  info(`Target: ~${Math.floor(DAYS * 24 * 3600 / INTERVAL_SEC)} uplinks per device\n`);

  const t0 = Date.now();
  let total = 0;

  total += await generateForDevice(
    DEVICES.waterMonitor.eui, DEVICES.waterMonitor.name, 2,
    waterMonitorTelemetry(),
  );

  total += await generateForDevice(
    DEVICES.solarFarm.eui, DEVICES.solarFarm.name, 2,
    solarFarmTelemetry(),
  );

  total += await generateForDevice(
    DEVICES.soilSensor.eui, DEVICES.soilSensor.name, 2,
    soilSensorTelemetry(),
  );

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  info("");
  ok(`Done! ${total} uplinks injected in ${elapsed}s`);
  info(`  Each uplink → decode engine → telemetry table + lorawan_frames`);
  info(`  Device e004 intentionally has no telemetry (unprovisioned)`);
}

main().catch(e => { err(e.message); process.exit(1); });
