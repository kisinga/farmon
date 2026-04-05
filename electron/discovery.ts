import { execSync } from "node:child_process";
import { requirePython } from "./toolchain.js";

export interface SerialDevice {
  port: string;
  description: string;
  hwid: string;
}

/**
 * List serial ports using pyserial (bundled with ESPHome's Python).
 * Returns empty array if pyserial is unavailable or no ports found.
 */
export function listSerialPorts(): SerialDevice[] {
  let python: string;
  try {
    python = requirePython();
  } catch {
    return [];
  }

  try {
    const script = [
      "import json, serial.tools.list_ports",
      "ports = serial.tools.list_ports.comports()",
      'print(json.dumps([{"port": p.device, "description": p.description, "hwid": p.hwid} for p in ports]))',
    ].join("; ");

    const output = execSync(`${python} -c '${script}'`, {
      encoding: "utf-8",
      timeout: 5000,
    });

    return JSON.parse(output.trim()) as SerialDevice[];
  } catch {
    return [];
  }
}
