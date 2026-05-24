import { BrowserWindow } from "electron";
import * as db from "./db.js";
import * as esphome from "./esphome.js";
import { checkSiteDrift, type HaConnection } from "./drift-detector.js";
import { generateFirmware, generateDefaultSecrets } from "./lib/generate.js";
import { topologyToManifestForController } from "./lib/topology-to-manifest.js";
import { parseTopology } from "./lib/topology.js";
import { BoardDefSchema } from "./lib/board.js";
import type { BoardDef } from "./lib/board.js";
import type { GenerationMetadata, SecretsMap } from "./lib/generate.js";
import * as store from "./store.js";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ControllerDeployment {
  controllerId: string;
  deviceName: string;
  deviceDir: string;
  generationId: number;
  version: string;
  checksum: string;
  dependsOn: string[];
}

export interface DeploymentPhase {
  name: string;
  controllers: ControllerDeployment[];
}

export interface DeploymentPlan {
  siteId: string;
  phases: DeploymentPhase[];
  consistencyHash: string;
  previousConsistencyHash: string | null;
  requiresFullDeployment: boolean;
  warnings: string[];
}

export interface DeploymentResult {
  controllerId: string;
  success: boolean;
  processId?: string;
  error?: string;
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Dependency ordering
// ---------------------------------------------------------------------------

function computeDependencies(
  topology: { controllers?: Array<{ id: string }> }
): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>();
  const controllers = topology.controllers ?? [];

  for (const ctrl of controllers) {
    deps.set(ctrl.id, new Set());
  }

  return deps;
}

function topologicalSort(controllers: string[], deps: Map<string, Set<string>>): string[] {
  const visited = new Set<string>();
  const temp = new Set<string>();
  const result: string[] = [];

  function visit(id: string) {
    if (temp.has(id)) return; // cycle, ignore
    if (visited.has(id)) return;
    temp.add(id);
    for (const dep of Array.from(deps.get(id) ?? [])) {
      visit(dep);
    }
    temp.delete(id);
    visited.add(id);
    result.push(id);
  }

  for (const id of controllers) {
    visit(id);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Consistency hash
// ---------------------------------------------------------------------------

function computeConsistencyHash(topology: {
  remoteImports?: Array<{ controllerId: string; nodeId: string }>;
  nodes?: Array<{ id: string; anchorId: string; kind: string }>;
  pipes?: Array<{ from: string; to: string }>;
}): string {
  const hash = crypto.createHash("sha256");

  // Hash remote imports
  const imports = [...(topology.remoteImports ?? [])].sort((a, b) =>
    a.controllerId.localeCompare(b.controllerId) || a.nodeId.localeCompare(b.nodeId)
  );
  for (const imp of imports) {
    hash.update(`${imp.controllerId}:${imp.nodeId}`);
  }

  // Hash cross-controller pipes (pipes that connect nodes on different controllers)
  const nodeAnchors = new Map<string, string>();
  for (const node of topology.nodes ?? []) {
    nodeAnchors.set(node.id, node.anchorId);
  }
  const crossPipes = (topology.pipes ?? [])
    .filter((p) => {
      const fromNode = p.from.split(":")[0];
      const toNode = p.to.split(":")[0];
      return nodeAnchors.get(fromNode) !== nodeAnchors.get(toNode);
    })
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  for (const pipe of crossPipes) {
    hash.update(`${pipe.from}>${pipe.to}`);
  }

  return hash.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Deployment plan generation
// ---------------------------------------------------------------------------

export async function buildDeploymentPlan(
  siteId: string,
  targetControllers?: string[]
): Promise<DeploymentPlan> {
  const site = db.loadSiteFull(siteId);
  if (!site) throw new Error(`Site not found: ${siteId}`);

  if (!site.topology) throw new Error(`Site "${siteId}" has no topology.`);
  const topology = parseTopology(site.topology as unknown as Record<string, unknown>);
  const allControllers = topology.controllers.map((c) => c.id);
  const targets = targetControllers ?? allControllers;

  // Compute dependencies
  const deps = computeDependencies(topology);
  // Populate deps from remote imports
  for (const imp of topology.remoteImports ?? []) {
    const consumer = imp.controllerId;
    // Find provider by looking up the node's anchor
    const node = topology.nodes.find((n) => n.id === imp.nodeId);
    if (node) {
      const provider = (node as any).anchorId as string;
      if (provider && provider !== consumer) {
        if (!deps.has(consumer)) deps.set(consumer, new Set());
        deps.get(consumer)!.add(provider);
      }
    }
  }

  // Ensure all targets have deps entries
  for (const id of targets) {
    if (!deps.has(id)) deps.set(id, new Set());
  }

  // Topological sort
  const order = topologicalSort(targets, deps);

  // Group into phases (controllers with no unmet deps in each phase)
  const deployed = new Set<string>();
  const phases: DeploymentPhase[] = [];
  let remaining = [...order];

  while (remaining.length > 0) {
    const phaseControllers: ControllerDeployment[] = [];
    const nextRemaining: string[] = [];

    for (const id of remaining) {
      const ctrlDeps = deps.get(id) ?? new Set();
      const unmet = Array.from(ctrlDeps).filter((d) => targets.includes(d) && !deployed.has(d));
      if (unmet.length === 0) {
        // Find latest generation
        const gens = db.listGenerations(siteId, id, "esphome");
        const latest = gens[0];
        if (!latest) {
          throw new Error(
            `Controller "${id}" has no generated firmware. Generate it first before deploying.`
          );
        }

        const manifest = topologyToManifestForController(topology, id);
        const deviceName = manifest.device.directory ?? manifest.device.name;
        const deviceDir = `sites/${siteId}/esphome/${deviceName}`;

        phaseControllers.push({
          controllerId: id,
          deviceName,
          deviceDir,
          generationId: latest.id,
          version: latest.version,
          checksum: latest.checksum,
          dependsOn: Array.from(ctrlDeps).filter((d) => targets.includes(d)),
        });
        deployed.add(id);
      } else {
        nextRemaining.push(id);
      }
    }

    if (phaseControllers.length === 0 && nextRemaining.length > 0) {
      // Cycle detected — deploy remaining anyway
      break;
    }

    phases.push({
      name: `Phase ${phases.length + 1}`,
      controllers: phaseControllers,
    });
    remaining = nextRemaining;
  }

  // Consistency hash
  const consistencyHash = computeConsistencyHash(topology);

  // Previous consistency hash from last deployment
  const lastDeployments = db.listDeployments(siteId);
  let previousConsistencyHash: string | null = null;
  if (lastDeployments.length > 0) {
    // The previous consistency hash isn't stored in DB yet.
    // For now, we'll compute it from the previous topology snapshot if available.
    // This is a simplification; in production we'd store the hash per-deployment.
    const lastGenMeta = db.listGenerations(siteId, targets[0], "esphome")[1];
    if (lastGenMeta) {
      const lastGen = db.loadGeneration(lastGenMeta.id);
      if (lastGen) {
        try {
          const prevTopo = JSON.parse(lastGen.topology) as {
            remoteImports?: Array<{ controllerId: string; nodeId: string }>;
            nodes?: Array<{ id: string; anchorId: string; kind: string }>;
            pipes?: Array<{ from: string; to: string }>;
          };
          previousConsistencyHash = computeConsistencyHash(prevTopo);
        } catch {
          previousConsistencyHash = null;
        }
      }
    }
  }

  const warnings: string[] = [];
  if (
    previousConsistencyHash &&
    previousConsistencyHash !== consistencyHash &&
    targets.length < allControllers.length
  ) {
    warnings.push(
      `This change affects cross-controller routes, but only ${targets.length} of ${allControllers.length} controllers are selected for deployment. All participating controllers must be updated together to avoid inconsistent behavior.`
    );
  }

  return {
    siteId,
    phases,
    consistencyHash,
    previousConsistencyHash,
    requiresFullDeployment:
      previousConsistencyHash !== null &&
      previousConsistencyHash !== consistencyHash,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Deployment execution
// ---------------------------------------------------------------------------

export async function executeDeployment(
  win: BrowserWindow,
  plan: DeploymentPlan,
  haConn?: HaConnection,
  onProgress?: (result: DeploymentResult) => void
): Promise<DeploymentResult[]> {
  const results: DeploymentResult[] = [];

  for (const phase of plan.phases) {
    for (const ctrl of phase.controllers) {
      // Create deployment record
      const deployment = db.createDeployment(
        plan.siteId,
        ctrl.controllerId,
        ctrl.generationId,
        haConn ? "ota" : "serial"
      );

      try {
        db.updateDeploymentStatus(deployment.id, "in_progress");

        // Flash
        const idempotencyKey = `${plan.siteId}:${ctrl.controllerId}:${ctrl.version}`;
        const { handle, result } = await esphome.flash(
          win,
          ctrl.deviceDir,
          undefined,
          idempotencyKey
        );

        const res = await result;

        if (res.code !== 0) {
          throw new Error(`ESPHome flash exited with code ${res.code}`);
        }

        db.updateDeploymentStatus(deployment.id, "success");

        // Verify if HA connection is available
        let verified = false;
        if (haConn) {
          try {
            const driftReports = await checkSiteDrift(haConn, plan.siteId);
            const report = driftReports.find(
              (r) => r.controllerId === ctrl.controllerId
            );
            if (report?.drift === "synced") {
              verified = true;
              db.verifyDeployment(deployment.id, ctrl.checksum);
            }
          } catch {
            // Verification is best-effort
          }
        }

        const resultObj: DeploymentResult = {
          controllerId: ctrl.controllerId,
          success: true,
          processId: handle.id,
          verified,
        };
        results.push(resultObj);
        onProgress?.(resultObj);
      } catch (err) {
        const error = String(err);
        db.updateDeploymentStatus(deployment.id, "failed", error);

        const resultObj: DeploymentResult = {
          controllerId: ctrl.controllerId,
          success: false,
          error,
          verified: false,
        };
        results.push(resultObj);
        onProgress?.(resultObj);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

export async function rollbackDeployment(
  win: BrowserWindow,
  siteId: string,
  controllerId: string,
  haConn?: HaConnection
): Promise<DeploymentResult> {
  // Find previous successful deployment
  const deployments = db.listDeployments(siteId, controllerId);
  const prevSuccessful = deployments.find((d) => d.status === "success" || d.status === "verified");

  if (!prevSuccessful) {
    return {
      controllerId,
      success: false,
      error: "No previous successful deployment to roll back to.",
      verified: false,
    };
  }

  // Load the generation for that deployment
  const gen = db.loadGeneration(prevSuccessful.generationId);
  if (!gen) {
    return {
      controllerId,
      success: false,
      error: "Previous generation no longer available.",
      verified: false,
    };
  }

  try {
    const topology = JSON.parse(gen.topology) as Record<string, unknown>;
    const manifest = topologyToManifestForController(parseTopology(topology), controllerId);
    const deviceName = manifest.device.directory ?? manifest.device.name;
    const deviceDir = `sites/${siteId}/esphome/${deviceName}`;

    // Regenerate files
    const boardData = store.loadBoard(manifest.device.board);
    if (!boardData?.board) throw new Error("Board not found");
    const board = BoardDefSchema.parse(boardData.board) as BoardDef;

    const savedSecrets = db.getSecrets(siteId, controllerId);
    const secrets: SecretsMap = {
      ...generateDefaultSecrets(),
      ...savedSecrets,
    } as SecretsMap;
    const metadata: GenerationMetadata = {
      configSha: gen.checksum,
      version: gen.version,
      siteId,
      controllerId,
      schemaVersion: gen.schemaVersion,
      buildTimestamp: Math.floor(Date.now() / 1000),
      appVersion: "rollback",
    };

    const files = generateFirmware("esphome", manifest, board, siteId, secrets, metadata);
    const outputDir = store.getOutputDir();
    store.writeOutput(files, outputDir);

    // Flash
    const idempotencyKey = `${siteId}:${controllerId}:rollback:${gen.version}`;
    const { handle, result } = await esphome.flash(
      win,
      deviceDir,
      undefined,
      idempotencyKey
    );
    const res = await result;

    if (res.code !== 0) {
      throw new Error(`Rollback flash exited with code ${res.code}`);
    }

    return {
      controllerId,
      success: true,
      processId: handle.id,
      verified: false,
    };
  } catch (err) {
    return {
      controllerId,
      success: false,
      error: String(err),
      verified: false,
    };
  }
}
