import * as db from "./db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DriftState =
  | "synced"
  | "stale"
  | "diverged"
  | "unreachable"
  | "orphan";

export interface ControllerTelemetry {
  controllerId: string;
  haEntityId: string; // the majiflow_controller_id entity
  runningSha: string | null;
  runningVersion: string | null;
  runningSiteId: string | null;
  runningSchemaVersion: number | null;
  runningRouteCount: number | null;
  runningNodeCount: number | null;
  buildTimestamp: number | null;
  lastUpdated: string | null; // HA state.last_updated
}

export interface DriftReport {
  siteId: string;
  controllerId: string;
  drift: DriftState;
  telemetry: ControllerTelemetry;
  expectedSha: string | null; // latest generation checksum
  expectedVersion: string | null; // latest generation version
  lastDeployedAt: string | null;
  message: string;
}

export interface HaConnection {
  baseUrl: string;
  token: string;
}

// ---------------------------------------------------------------------------
// HA REST API client
// ---------------------------------------------------------------------------

async function haFetch<T>(conn: HaConnection, path: string): Promise<T> {
  const url = new URL(path, conn.baseUrl.replace(/\/$/, "") + "/").toString();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${conn.token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HA API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

// ---------------------------------------------------------------------------
// Telemetry extraction
// ---------------------------------------------------------------------------

function suffixFromEntityId(entityId: string): string {
  const base = "sensor.majiflow_controller_id";
  if (entityId === base) return "";
  if (entityId.startsWith(base + "_")) return entityId.slice(base.length);
  return "";
}

function findSibling(
  states: HaState[],
  suffix: string,
  kind: string,
): HaState | undefined {
  const target = `sensor.majiflow_${kind}${suffix}`;
  return states.find((s) => s.entity_id === target);
}

function parseNumberState(state: string | null): number | null {
  if (state == null || state === "unavailable" || state === "unknown") return null;
  const n = Number(state);
  return Number.isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

function determineDrift(
  telemetry: ControllerTelemetry,
  siteId: string,
  expectedSha: string | null,
  expectedVersion: string | null,
): { drift: DriftState; message: string } {
  if (!telemetry.runningSha) {
    return { drift: "unreachable", message: "Controller metadata not found in Home Assistant." };
  }

  if (telemetry.runningSiteId && telemetry.runningSiteId !== siteId) {
    return {
      drift: "orphan",
      message: `Controller reports site "${telemetry.runningSiteId}", expected "${siteId}".`,
    };
  }

  if (expectedSha && telemetry.runningSha === expectedSha) {
    return { drift: "synced", message: "Running firmware matches latest generation." };
  }

  // Check if SHA matches any known generation for this controller
  const generations = db.listGenerations(siteId, telemetry.controllerId, "esphome");
  const known = generations.some((g) => g.checksum === telemetry.runningSha);
  if (known) {
    return {
      drift: "stale",
      message: `Running firmware matches an older generation (${telemetry.runningVersion ?? "unknown"}).`,
    };
  }

  return {
    drift: "diverged",
    message: `Running SHA "${telemetry.runningSha}" does not match any known generation.`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Poll Home Assistant for all MajiFlow metadata sensors and produce a drift
 * report for every controller in the site.
 */
export async function checkSiteDrift(
  conn: HaConnection,
  siteId: string,
): Promise<DriftReport[]> {
  const states = await haFetch<HaState[]>(conn, "api/states");

  // Find all controller-id sensors
  const controllerSensors = states.filter((s) =>
    s.entity_id.startsWith("sensor.majiflow_controller_id"),
  );

  // Resolve expected (latest) generation per controller
  const systems = db.listSystems(siteId);
  const latestGenBySystem = new Map<string, { checksum: string; version: string }>();
  for (const sys of systems) {
    const gens = db.listGenerations(siteId, sys.id, "esphome");
    if (gens.length > 0) {
      latestGenBySystem.set(sys.id, { checksum: gens[0].checksum, version: gens[0].version });
    }
  }

  // Resolve last deployment per controller
  const deployments = db.listDeployments(siteId);
  const lastDeploymentBySystem = new Map<string, string>();
  for (const d of deployments) {
    if (!lastDeploymentBySystem.has(d.systemId)) {
      lastDeploymentBySystem.set(d.systemId, d.startedAt);
    }
  }

  const reports: DriftReport[] = [];

  for (const ctrlSensor of controllerSensors) {
    const suffix = suffixFromEntityId(ctrlSensor.entity_id);
    const controllerId = ctrlSensor.state || "unknown";

    const shaSensor = findSibling(states, suffix, "config_sha");
    const versionSensor = findSibling(states, suffix, "generation_version");
    const siteSensor = findSibling(states, suffix, "site_id");
    const schemaSensor = findSibling(states, suffix, "schema_version");
    const routeSensor = findSibling(states, suffix, "route_count");
    const nodeSensor = findSibling(states, suffix, "node_count");
    const buildSensor = findSibling(states, suffix, "build_timestamp");

    const telemetry: ControllerTelemetry = {
      controllerId,
      haEntityId: ctrlSensor.entity_id,
      runningSha: shaSensor?.state ?? null,
      runningVersion: versionSensor?.state ?? null,
      runningSiteId: siteSensor?.state ?? null,
      runningSchemaVersion: parseNumberState(schemaSensor?.state ?? null),
      runningRouteCount: parseNumberState(routeSensor?.state ?? null),
      runningNodeCount: parseNumberState(nodeSensor?.state ?? null),
      buildTimestamp: parseNumberState(buildSensor?.state ?? null),
      lastUpdated: shaSensor?.last_updated ?? null,
    };

    const expected = latestGenBySystem.get(controllerId) ?? null;
    const { drift, message } = determineDrift(
      telemetry,
      siteId,
      expected?.checksum ?? null,
      expected?.version ?? null,
    );

    reports.push({
      siteId,
      controllerId,
      drift,
      telemetry,
      expectedSha: expected?.checksum ?? null,
      expectedVersion: expected?.version ?? null,
      lastDeployedAt: lastDeploymentBySystem.get(controllerId) ?? null,
      message,
    });
  }

  // Also report controllers that have generations but no HA telemetry
  const reportedControllers = new Set(reports.map((r) => r.controllerId));
  for (const sys of systems) {
    if (!reportedControllers.has(sys.id) && latestGenBySystem.has(sys.id)) {
      reports.push({
        siteId,
        controllerId: sys.id,
        drift: "unreachable",
        telemetry: {
          controllerId: sys.id,
          haEntityId: "",
          runningSha: null,
          runningVersion: null,
          runningSiteId: null,
          runningSchemaVersion: null,
          runningRouteCount: null,
          runningNodeCount: null,
          buildTimestamp: null,
          lastUpdated: null,
        },
        expectedSha: latestGenBySystem.get(sys.id)?.checksum ?? null,
        expectedVersion: latestGenBySystem.get(sys.id)?.version ?? null,
        lastDeployedAt: lastDeploymentBySystem.get(sys.id) ?? null,
        message: "Controller not found in Home Assistant. It may be offline or not yet paired.",
      });
    }
  }

  return reports;
}

/**
 * Quick connectivity check to Home Assistant.
 */
export async function checkHaConnection(conn: HaConnection): Promise<{
  ok: boolean;
  version?: string;
  error?: string;
}> {
  try {
    const data = await haFetch<{ version: string }>(conn, "api/config");
    return { ok: true, version: data.version };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
