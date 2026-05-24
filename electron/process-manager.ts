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
// Circuit breaker
// ---------------------------------------------------------------------------

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
}

const circuits = new Map<string, CircuitState>();
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60000;

function getCircuit(backend: string): CircuitState {
  if (!circuits.has(backend)) {
    circuits.set(backend, { failures: 0, lastFailure: 0, open: false });
  }
  return circuits.get(backend)!;
}

function recordSuccess(backend: string) {
  const c = getCircuit(backend);
  c.failures = 0;
  c.open = false;
}

function recordFailure(backend: string) {
  const c = getCircuit(backend);
  c.failures++;
  c.lastFailure = Date.now();
  if (c.failures >= CIRCUIT_THRESHOLD) {
    c.open = true;
  }
}

function isCircuitOpen(backend: string): boolean {
  const c = getCircuit(backend);
  if (!c.open) return false;
  if (Date.now() - c.lastFailure > CIRCUIT_COOLDOWN_MS) {
    c.open = false;
    c.failures = 0;
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

const inFlight = new Set<string>();

export function isInFlight(key: string): boolean {
  return inFlight.has(key);
}

export function markInFlight(key: string): void {
  inFlight.add(key);
}

export function clearInFlight(key: string): void {
  inFlight.delete(key);
}

// ---------------------------------------------------------------------------
// Bounded concurrency (semaphore)
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 2;
const queue: Array<() => void> = [];
let running = 0;

function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function releaseSlot(): void {
  running = Math.max(0, running - 1);
  const next = queue.shift();
  if (next) {
    running++;
    next();
  }
}

// ---------------------------------------------------------------------------
// Generic process spawn
// ---------------------------------------------------------------------------

export interface SpawnOptions {
  /** Backend identifier (e.g. "esphome", "frugaliot") */
  backend: string;
  /** Working directory for the spawned process */
  cwd?: string;
}

async function spawnProcessInternal(
  win: BrowserWindow,
  bin: string,
  args: string[],
  operation: ProcessOperation,
  configName: string,
  opts: SpawnOptions
): Promise<{ handle: ProcessHandle; result: Promise<ProcessResult> }> {
  await acquireSlot();

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
      releaseSlot();
      const event: ProcessDoneEvent = { id, backend, operation, code, signal };
      win.webContents.send("process:done", event);
      resolve({ id, code, signal });
    });

    proc.on("error", (err) => {
      active.delete(id);
      releaseSlot();
      reject(new Error(`Failed to start ${backend}: ${err.message}`));
    });
  });

  return { handle, result };
}

// ---------------------------------------------------------------------------
// ESPHome spawn with circuit breaker + idempotency
// ---------------------------------------------------------------------------

export interface EsphomeSpawnOptions {
  idempotencyKey?: string;
}

export async function spawnEsphome(
  win: BrowserWindow,
  esphomePath: string,
  args: string[],
  operation: ProcessOperation,
  configName: string,
  opts?: EsphomeSpawnOptions
): Promise<{ handle: ProcessHandle; result: Promise<ProcessResult> }> {
  const backend = "esphome";

  // Circuit breaker check
  if (isCircuitOpen(backend)) {
    throw new Error(
      `ESPHome toolchain is temporarily unavailable (circuit breaker open). ` +
        `Wait ${Math.ceil((CIRCUIT_COOLDOWN_MS - (Date.now() - getCircuit(backend).lastFailure)) / 1000)}s and retry.`
    );
  }

  // Idempotency check
  if (opts?.idempotencyKey && isInFlight(opts.idempotencyKey)) {
    throw new Error(
      `An ESPHome ${operation} is already in progress for this controller and generation. Please wait or cancel it.`
    );
  }

  if (opts?.idempotencyKey) {
    markInFlight(opts.idempotencyKey);
  }

  try {
    const { handle, result } = await spawnProcessInternal(
      win,
      esphomePath,
      args,
      operation,
      configName,
      { backend }
    );

    // Wrap result to record success/failure and clear idempotency
    const wrappedResult = result.then(
      (res) => {
        if (opts?.idempotencyKey) clearInFlight(opts.idempotencyKey);
        if (res.code === 0) {
          recordSuccess(backend);
        } else {
          recordFailure(backend);
        }
        return res;
      },
      (err) => {
        if (opts?.idempotencyKey) clearInFlight(opts.idempotencyKey);
        recordFailure(backend);
        throw err;
      }
    );

    return { handle, result: wrappedResult };
  } catch (err) {
    if (opts?.idempotencyKey) clearInFlight(opts.idempotencyKey);
    throw err;
  }
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
