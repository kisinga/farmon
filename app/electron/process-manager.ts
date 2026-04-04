import { spawn, type ChildProcess } from "node:child_process";
import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";

export type ProcessOperation = "compile" | "flash" | "logs";

export interface ProcessHandle {
  id: string;
  operation: ProcessOperation;
  configName: string;
  pid: number | undefined;
}

export interface ProcessResult {
  id: string;
  code: number | null;
  signal: string | null;
}

export interface ProcessOutputEvent {
  id: string;
  operation: ProcessOperation;
  stream: "stdout" | "stderr";
  text: string;
}

export interface ProcessDoneEvent {
  id: string;
  operation: ProcessOperation;
  code: number | null;
  signal: string | null;
}

interface TrackedProcess {
  proc: ChildProcess;
  handle: ProcessHandle;
}

const active = new Map<string, TrackedProcess>();

/**
 * Spawn an ESPHome process, stream tagged output to the window, return result.
 */
export function spawnEsphome(
  win: BrowserWindow,
  esphomePath: string,
  args: string[],
  operation: ProcessOperation,
  configName: string
): { handle: ProcessHandle; result: Promise<ProcessResult> } {
  const id = randomUUID();

  const proc = spawn(esphomePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const handle: ProcessHandle = { id, operation, configName, pid: proc.pid };
  active.set(id, { proc, handle });

  // Notify renderer immediately so it can track/cancel
  win.webContents.send("esphome:started", handle);

  proc.stdout!.on("data", (chunk: Buffer) => {
    win.webContents.send("esphome:output", {
      id,
      operation,
      stream: "stdout",
      text: chunk.toString("utf-8"),
    } satisfies ProcessOutputEvent);
  });

  proc.stderr!.on("data", (chunk: Buffer) => {
    win.webContents.send("esphome:output", {
      id,
      operation,
      stream: "stderr",
      text: chunk.toString("utf-8"),
    } satisfies ProcessOutputEvent);
  });

  const result = new Promise<ProcessResult>((resolve, reject) => {
    proc.on("close", (code, signal) => {
      active.delete(id);
      const event: ProcessDoneEvent = { id, operation, code, signal };
      win.webContents.send("esphome:done", event);
      resolve({ id, code, signal });
    });

    proc.on("error", (err) => {
      active.delete(id);
      reject(new Error(`Failed to start ESPHome: ${err.message}`));
    });
  });

  return { handle, result };
}

/** Kill a running process by id. Returns true if found and killed. */
export function killProcess(id: string): boolean {
  const tracked = active.get(id);
  if (!tracked) return false;
  tracked.proc.kill("SIGTERM");
  // Escalate after 5s
  setTimeout(() => {
    if (active.has(id)) {
      tracked.proc.kill("SIGKILL");
    }
  }, 5000);
  return true;
}

/** Kill all running processes (app quit cleanup). */
export function killAll(): void {
  for (const [id] of active) {
    killProcess(id);
  }
}
