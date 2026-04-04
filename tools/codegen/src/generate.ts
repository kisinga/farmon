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
  content: string;
}

export function generateAll(m: Manifest): GeneratedFile[] {
  const deviceDir = `esphome/${m.device.directory ?? m.device.name}`;

  return [
    {
      relativePath: `${deviceDir}/packages/routes.h`,
      content: generateRoutes(m),
    },
    {
      relativePath: `${deviceDir}/packages/hardware.yaml`,
      content: generateHardware(m),
    },
    {
      relativePath: `${deviceDir}/packages/sensors.yaml`,
      content: generateSensors(m),
    },
    {
      relativePath: `_substitutions.yaml`,
      content: generateSubstitutions(m),
    },
    {
      relativePath: `config/homeassistant/dashboards/pump.yaml`,
      content: generateDashboard(m),
    },
  ];
}

export function writeFiles(
  files: GeneratedFile[],
  outDir: string,
  dryRun: boolean
): void {
  for (const file of files) {
    const fullPath = path.join(outDir, file.relativePath);

    if (dryRun) {
      console.log(`\n  [dry-run] Would write: ${fullPath}`);
      console.log("  " + "─".repeat(60));
      const preview = file.content.split("\n").slice(0, 10).join("\n");
      console.log(
        preview
          .split("\n")
          .map((l) => "  " + l)
          .join("\n")
      );
      if (file.content.split("\n").length > 10) {
        console.log(`  ... (${file.content.split("\n").length} lines total)`);
      }
      continue;
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, file.content, "utf-8");
    console.log(`  Wrote ${fullPath}`);
  }
}
