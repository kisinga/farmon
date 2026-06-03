// Shared config for all simulation scripts.
// Point PB_URL to a running PocketBase instance.
// For a separate test DB, start PocketBase with: ../backend/farmon serve --dir ./pb_test_data

export const PB_URL = process.env.PB_URL || "http://127.0.0.1:8090";

// Superuser credentials for SDK calls that need write access to collections
// without public createRule/updateRule (e.g. devices, telemetry).
// Set via env or use defaults matching `pocketbase superuser create`.
export const PB_SUPERUSER_EMAIL = process.env.PB_SUPERUSER_EMAIL || "admin@farmon.local";
export const PB_SUPERUSER_PASSWORD = process.env.PB_SUPERUSER_PASSWORD || "adminadmin1234";

// Simulation time range: 7 days ending now
export const DAYS = 7;
export const INTERVAL_SEC = 300; // 5-minute telemetry interval
export const now = new Date();
export const startDate = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);

// Device EUIs (deterministic for repeatability)
export const DEVICES = {
  waterMonitor:  { eui: "2cf7f1c04d00e001", name: "Farm Well Pump Station" },
  solarFarm:     { eui: "2cf7f1c04d00e002", name: "Solar Inverter & Irrigation" },
  soilSensor:    { eui: "2cf7f1c04d00e003", name: "SenseCAP Soil Probe - Field A" },
  unprovisioned: { eui: "2cf7f1c04d00e004", name: "New Device (no firmware)" },
} as const;

// Profiles
export const PROFILE_SOLAR_FARM = "Solar Farm Monitor v1";
export const PROFILE_WATER_MONITOR = "FarMon Water Monitor v1";
export const PROFILE_SENSECAP = "SenseCAP S2105";

// Helper: generate timestamps from start to now at given interval
export function* timestamps(intervalSec: number): Generator<Date> {
  let t = startDate.getTime();
  const end = now.getTime();
  while (t <= end) {
    yield new Date(t);
    t += intervalSec * 1000;
  }
}

// Helper: hour of day as float (0.0 - 24.0) from a Date
export function hourOfDay(d: Date): number {
  return d.getHours() + d.getMinutes() / 60;
}

// Helper: day index (0-based from start)
export function dayIndex(d: Date): number {
  return Math.floor((d.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
}

// Helper: solar irradiance curve (0 at night, peaks at solar noon ~13:00)
export function solarCurve(d: Date): number {
  const h = hourOfDay(d);
  if (h < 6 || h > 19) return 0;
  // Bell curve peaking at 12.5 (solar noon)
  const x = (h - 12.5) / 3.5;
  return Math.max(0, Math.exp(-x * x));
}

// Helper: add gaussian noise
export function noise(amplitude: number): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  return amplitude * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Helper: clamp
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// Helper: round to N decimals
export function round(v: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

// Auth helper: authenticate PocketBase client as superuser
import PocketBase from "pocketbase";
export async function authPb(pb: PocketBase) {
  await pb.collection("_superusers").authWithPassword(PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD);
}

// Console formatting
export function step(msg: string) { console.log(`\n\x1b[36m>> ${msg}\x1b[0m`); }
export function ok(msg: string)   { console.log(`   \x1b[32m✓\x1b[0m ${msg}`); }
export function info(msg: string) { console.log(`   ${msg}`); }
export function err(msg: string)  { console.log(`   \x1b[31m✗\x1b[0m ${msg}`); }
