import { spawn, type ChildProcess } from "node:child_process";
import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";

export type ProcessOperation = "compile" | "flash" | "logs";

export interface ProcessHandle {
  id: string;
  backend: string;
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
  backend: string;
  operation: ProcessOperation;
  stream: "stdout" | "stderr";
  text: string;
}

export interface ProcessDoneEvent {
  id: string;
  backend: string;
  operation: ProcessOperation;
  code: number | null;
  signal: string | null;
}

interface TrackedProcess {
  proc: ChildProcess;
  handle: ProcessHandle | SerialHandle;
}

const active = new Map<string, TrackedProcess>();

// ---------------------------------------------------------------------------
// Generic process spawn
// ---------------------------------------------------------------------------

export interface SpawnOptions {
  /** Backend identifier (e.g. "esphome", "frugaliot") */
  backend: string;
  /** Working directory for the spawned process */
  cwd?: string;
}

function spawnProcessInternal(
  win: BrowserWindow,
  bin: string,
  args: string[],
  operation: ProcessOperation,
  configName: string,
  opts: SpawnOptions
): { handle: ProcessHandle; result: Promise<ProcessResult> } {
  const id = randomUUID();
  const backend = opts.backend;

  const proc = spawn(bin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: opts.cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  const handle: ProcessHandle = { id, backend, operation, configName, pid: proc.pid };
  active.set(id, { proc, handle });

  // Notify renderer immediately so it can track/cancel
  win.webContents.send("process:started", handle);

  proc.stdout!.on("data", (chunk: Buffer) => {
    win.webContents.send("process:output", {
      id,
      backend,
      operation,
      stream: "stdout",
      text: chunk.toString("utf-8"),
    } satisfies ProcessOutputEvent);
  });

  proc.stderr!.on("data", (chunk: Buffer) => {
    win.webContents.send("process:output", {
      id,
      backend,
      operation,
      stream: "stderr",
      text: chunk.toString("utf-8"),
    } satisfies ProcessOutputEvent);
  });

  const result = new Promise<ProcessResult>((resolve, reject) => {
    proc.on("close", (code, signal) => {
      active.delete(id);
      const event: ProcessDoneEvent = { id, backend, operation, code, signal };
      win.webContents.send("process:done", event);
      resolve({ id, code, signal });
    });

    proc.on("error", (err) => {
      active.delete(id);
      reject(new Error(`Failed to start ${backend}: ${err.message}`));
    });
  });

  return { handle, result };
}

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
  return spawnProcessInternal(win, esphomePath, args, operation, configName, {
    backend: "esphome",
  });
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

// --- Serial monitor types & spawn ---

export interface SerialHandle {
  id: string;
  port: string;
  baudRate: number;
  pid: number | undefined;
}

export interface SerialOutputEvent {
  id: string;
  stream: "stdout" | "stderr";
  text: string;
}

export interface SerialDoneEvent {
  id: string;
  code: number | null;
  signal: string | null;
}

/**
 * Spawn a serial monitor process, stream output to the window, return result.
 */
export function spawnSerial(
  win: BrowserWindow,
  cmd: string,
  args: string[],
  port: string,
  baudRate: number
): { handle: SerialHandle; result: Promise<ProcessResult> } {
  const id = randomUUID();

  const proc = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const handle: SerialHandle = { id, port, baudRate, pid: proc.pid };
  active.set(id, { proc, handle });

  proc.stdout!.on("data", (chunk: Buffer) => {
    win.webContents.send("serial:output", {
      id,
      stream: "stdout",
      text: chunk.toString("utf-8"),
    } satisfies SerialOutputEvent);
  });

  proc.stderr!.on("data", (chunk: Buffer) => {
    win.webContents.send("serial:output", {
      id,
      stream: "stderr",
      text: chunk.toString("utf-8"),
    } satisfies SerialOutputEvent);
  });

  const result = new Promise<ProcessResult>((resolve, reject) => {
    proc.on("close", (code, signal) => {
      active.delete(id);
      const event: SerialDoneEvent = { id, code, signal };
      win.webContents.send("serial:done", event);
      resolve({ id, code, signal });
    });

    proc.on("error", (err) => {
      active.delete(id);
      reject(new Error(`Failed to start serial monitor: ${err.message}`));
    });
  });

  return { handle, result };
}

/** Kill all running processes (app quit cleanup). */
export function killAll(): void {
  for (const [id] of active) {
    killProcess(id);
  }
}
