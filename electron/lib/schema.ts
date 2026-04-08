// Re-export everything from shared manifest types — single source of truth.
// Electron generators import from here for convenience; the types live in shared/.
export type { Device, Timing, ManifestNode, ManifestAutomation, Manifest, Route } from "../../shared/manifest.types.js";
export { nodesByKind } from "../../shared/manifest.types.js";
