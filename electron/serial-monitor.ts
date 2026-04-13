import { BrowserWindow } from "electron";
import { requirePython } from "./toolchain.js";
import {
  spawnSerial,
  type SerialHandle,
  type ProcessResult,
} from "./process-manager.js";

const SERIAL_SCRIPT = `
import sys, time, serial
port, baud = sys.argv[1], int(sys.argv[2])
while True:
    try:
        with serial.Serial(port, baud, timeout=1) as ser:
            sys.stderr.write(f"Connected to {port} at {baud} baud\\n")
            sys.stderr.flush()
            while True:
                line = ser.readline()
                if line:
                    sys.stdout.buffer.write(line)
                    sys.stdout.buffer.flush()
    except serial.SerialException as e:
        sys.stderr.write(f"Serial error: {e}\\nReconnecting in 2s...\\n")
        sys.stderr.flush()
        time.sleep(2)
    except KeyboardInterrupt:
        break
`.trim();

export function serialMonitor(
  win: BrowserWindow,
  port: string,
  baudRate: number
): { handle: SerialHandle; result: Promise<ProcessResult> } {
  const python = requirePython();
  return spawnSerial(win, python, ["-c", SERIAL_SCRIPT, port, String(baudRate)], port, baudRate);
}
