import * as path from "node:path";
import { BrowserWindow } from "electron";
import { requireEsphome } from "./toolchain.js";
import {
  spawnEsphome,
  type ProcessHandle,
  type ProcessResult,
} from "./process-manager.js";
import * as store from "./store.js";

/**
 * Resolve ESPHome config YAML path from a deviceDir (relative to the output
 * dir). Site-scoped layout is `sites/{siteId}/esphome/{deviceFolder}`;
 * self-test layout is `selftest/{model}/esphome/{deviceFolder}`. Either way
 * the YAML filename is `{basename(deviceDir)}.yaml`.
 */
function resolveConfigPath(deviceDir: string): string {
  const outputDir = store.getOutputDir();
  const folder = path.basename(deviceDir);
  return path.join(outputDir, deviceDir, `${folder}.yaml`);
}

export async function compile(
  win: BrowserWindow,
  deviceDir: string,
  idempotencyKey?: string
): Promise<{ handle: ProcessHandle; result: Promise<ProcessResult> }> {
  const bin = requireEsphome();
  const configPath = resolveConfigPath(deviceDir);
  return spawnEsphome(win, bin, ["compile", configPath], "compile", path.basename(deviceDir), {
    idempotencyKey,
  });
}

export async function flash(
  win: BrowserWindow,
  deviceDir: string,
  device?: string,
  idempotencyKey?: string
): Promise<{ handle: ProcessHandle; result: Promise<ProcessResult> }> {
  const bin = requireEsphome();
  const configPath = resolveConfigPath(deviceDir);
  const args = ["run", configPath];
  if (device) args.push("--device", device);
  return spawnEsphome(win, bin, args, "flash", path.basename(deviceDir), {
    idempotencyKey,
  });
}

export async function logs(
  win: BrowserWindow,
  deviceDir: string,
  device?: string,
  idempotencyKey?: string
): Promise<{ handle: ProcessHandle; result: Promise<ProcessResult> }> {
  const bin = requireEsphome();
  const configPath = resolveConfigPath(deviceDir);
  const args = ["logs", configPath];
  if (device) args.push("--device", device);
  return spawnEsphome(win, bin, args, "logs", path.basename(deviceDir), {
    idempotencyKey,
  });
}
