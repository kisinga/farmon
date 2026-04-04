import * as fs from "node:fs";
import * as path from "node:path";
import type { Manifest } from "./schema.js";
import { generateRoutes } from "./generators/routes.js";
import { generateHardware } from "./generators/hardware.js";
import { generateSensors } from "./generators/sensors.js";
import { generateSubstitutions } from "./generators/substitutions.js";
import { generateDashboard } from "./generators/dashboard.js";

export interface GeneratedFile {
  relativePath: string;
  description: string;
  content: string;
}

export function generateAll(m: Manifest): GeneratedFile[] {
  const deviceDir = `esphome/${m.device.directory ?? m.device.name}`;

  return [
    {
      relativePath: `${deviceDir}/packages/routes.h`,
      description: "C++ route table + dispatch functions",
      content: generateRoutes(m),
    },
    {
      relativePath: `${deviceDir}/packages/hardware.yaml`,
      description: "Pump relay, valve switches + covers",
      content: generateHardware(m),
    },
    {
      relativePath: `${deviceDir}/packages/sensors.yaml`,
      description: "Flow sensors, tank levels, calibration, state text",
      content: generateSensors(m),
    },
    {
      relativePath: `_substitutions.yaml`,
      description: "Pin mappings + timing (copy into device YAML)",
      content: generateSubstitutions(m),
    },
    {
      relativePath: `config/homeassistant/dashboards/pump.yaml`,
      description: "HA dashboard with gauges, controls, settings",
      content: generateDashboard(m),
    },
  ];
}

export function writeFiles(
  files: GeneratedFile[],
  outDir: string,
  dryRun: boolean
): void {
  const maxPathLen = Math.max(...files.map((f) => f.relativePath.length));

  for (const file of files) {
    const fullPath = path.join(outDir, file.relativePath);
    const lines = file.content.split("\n").length;
    const padded = file.relativePath.padEnd(maxPathLen + 2);

    if (dryRun) {
      console.log(`  [dry-run] ${padded} ${file.description} (${lines} lines)`);
      continue;
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, file.content, "utf-8");
    console.log(`  ${padded} ${file.description} (${lines} lines)`);
  }
}
