import type { Device, Timing } from "./shared-schema.js";

// ---------------------------------------------------------------------------
// Manifest — internal intermediate representation
// ---------------------------------------------------------------------------
// This is the flat, normalized form derived from a Topology by
// topologyToManifest(). It is never saved to disk or shown to users.
// All code generators and validation consume this shape.
// ---------------------------------------------------------------------------

export interface Manifest {
  device: Device;
  pump: { pin: string };
  tanks: Tank[];
  valves: Valve[];
  flow_sensors: FlowSensor[];
  routes: Route[];
  timing: Timing;
}

export interface Tank {
  name: string;
  id: string;
  level_pin: string;
}

export interface Valve {
  name: string;
  id: string;
  open_pin: string;
  close_pin: string;
}

export interface FlowSensor {
  name: string;
  id: string;
  pin: string;
  flow_cal: number;
}

export interface Route {
  name: string;
  source: string;
  destination?: string;
  valves: string[];
  flow_sensor: string;
  max_runtime_seconds: number;
}

// Re-export shared types for convenience
export type { Device, Timing };
