import { execSync } from "node:child_process";
import { detectToolchain, requirePython } from "./toolchain.js";

export interface HealthCheck {
  name: string;
  status: "ok" | "missing" | "error";
  detail: string;
  fixable: boolean;
}

export interface HealthReport {
  ok: boolean;
  checks: HealthCheck[];
}

export function checkHealth(): HealthReport {
  const checks: HealthCheck[] = [];
  const tc = detectToolchain();

  // 1. ESPHome
  checks.push(
    tc.version
      ? { name: "ESPHome", status: "ok", detail: tc.version, fixable: false }
      : {
          name: "ESPHome",
          status: "missing",
          detail:
            "Not found. Install: brew install esphome (or pip install esphome)",
          fixable: false,
        }
  );

  // 2. ESPHome Python env
  checks.push(
    tc.pythonPath
      ? { name: "Python", status: "ok", detail: tc.pythonPath, fixable: false }
      : {
          name: "Python",
          status: "missing",
          detail: "Could not find Python alongside ESPHome binary",
          fixable: false,
        }
  );

  // 3. Build deps (fatfs-ng, littlefs-python) — in ESPHome's Python
  if (tc.pythonPath) {
    const pip = `${tc.pythonPath} -m pip`;
    const fatfs = run(`${pip} show fatfs-ng 2>/dev/null`);
    const littlefs = run(`${pip} show littlefs-python 2>/dev/null`);
    const missing: string[] = [];
    if (!fatfs) missing.push("fatfs-ng");
    if (!littlefs) missing.push("littlefs-python");

    checks.push(
      missing.length === 0
        ? {
            name: "Build deps",
            status: "ok",
            detail: "fatfs-ng, littlefs-python",
            fixable: true,
          }
        : {
            name: "Build deps",
            status: "missing",
            detail: `Missing: ${missing.join(", ")}`,
            fixable: true,
          }
    );
  }

  return {
    ok: checks.every((c) => c.status === "ok"),
    checks,
  };
}

export function fixDeps(): { success: boolean; output: string } {
  let python: string;
  try {
    python = requirePython();
  } catch {
    return { success: false, output: "Cannot find ESPHome's Python" };
  }

  try {
    const output = execSync(
      `${python} -m pip install "fatfs-ng>=0.1.14" "littlefs-python>=0.16.0" 2>&1`,
      { encoding: "utf-8", timeout: 60000, shell: "/bin/zsh" }
    );
    return { success: true, output };
  } catch (err) {
    return { success: false, output: String(err) };
  }
}

function run(cmd: string): string | null {
  try {
    return (
      execSync(cmd, { encoding: "utf-8", timeout: 10000, shell: "/bin/zsh" }).trim() ||
      null
    );
  } catch {
    return null;
  }
}
