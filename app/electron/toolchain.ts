import { execSync } from "node:child_process";
import { realpathSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ToolchainInfo {
  esphomePath: string | null;
  pythonPath: string | null;
  version: string | null;
}

let cached: ToolchainInfo | null = null;

/** Detect ESPHome binary and its companion Python. Caches result. */
export function detectToolchain(): ToolchainInfo {
  if (cached) return cached;
  cached = refreshToolchain();
  return cached;
}

/** Force re-detection (e.g. after user installs ESPHome). */
export function refreshToolchain(): ToolchainInfo {
  const esphomePath = which("esphome");
  let pythonPath: string | null = null;
  let version: string | null = null;

  if (esphomePath) {
    version = run("esphome version");
    try {
      const real = realpathSync(esphomePath);
      const candidate = join(dirname(real), "python3");
      if (existsSync(candidate)) pythonPath = candidate;
    } catch {}
  }

  cached = { esphomePath, pythonPath, version };
  return cached;
}

/** Require esphomePath or throw. */
export function requireEsphome(): string {
  const { esphomePath } = detectToolchain();
  if (!esphomePath) throw new Error("ESPHome not installed");
  return esphomePath;
}

/** Require pythonPath or throw. */
export function requirePython(): string {
  const { pythonPath } = detectToolchain();
  if (!pythonPath) throw new Error("Cannot find Python alongside ESPHome");
  return pythonPath;
}

function which(bin: string): string | null {
  try {
    return execSync(`which ${bin}`, { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}

function run(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim() || null;
  } catch {
    return null;
  }
}
