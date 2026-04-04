import * as path from "node:path";
import { BrowserWindow } from "electron";
import { requireEsphome } from "./toolchain.js";
import {
  spawnEsphome,
  type ProcessHandle,
  type ProcessResult,
} from "./process-manager.js";
import * as store from "./store.js";

/** Resolve ESPHome config YAML path from a config name. */
function resolveConfigPath(configName: string): string {
  const outputDir = store.getOutputDir();
  return path.join(outputDir, "esphome", configName, `${configName}.yaml`);
}

export function compile(
  win: BrowserWindow,
  configName: string
): { handle: ProcessHandle; result: Promise<ProcessResult> } {
  const bin = requireEsphome();
  const configPath = resolveConfigPath(configName);
  return spawnEsphome(win, bin, ["compile", configPath], "compile", configName);
}

export function flash(
  win: BrowserWindow,
  configName: string,
  device?: string
): { handle: ProcessHandle; result: Promise<ProcessResult> } {
  const bin = requireEsphome();
  const configPath = resolveConfigPath(configName);
  const args = ["run", configPath];
  if (device) args.push("--device", device);
  return spawnEsphome(win, bin, args, "flash", configName);
}

export function logs(
  win: BrowserWindow,
  configName: string,
  device?: string
): { handle: ProcessHandle; result: Promise<ProcessResult> } {
  const bin = requireEsphome();
  const configPath = resolveConfigPath(configName);
  const args = ["logs", configPath];
  if (device) args.push("--device", device);
  return spawnEsphome(win, bin, args, "logs", configName);
}
