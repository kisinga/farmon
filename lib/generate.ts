import type { Manifest } from "./schema.js";
import type { BoardDef } from "./board.js";
import { generateRoutes } from "./generators/routes.js";
import { generateHardware } from "./generators/hardware.js";
import { generateSensors } from "./generators/sensors.js";
import { generateDashboard } from "./generators/dashboard.js";
import { generateBoardPackage } from "./generators/board-package.js";
import { generateDeviceYaml } from "./generators/device-yaml.js";

export interface GeneratedFile {
  relativePath: string;
  description: string;
  content: string;
}

export function generateAll(m: Manifest, board: BoardDef): GeneratedFile[] {
  const deviceDir = `esphome/${m.device.directory ?? m.device.name}`;

  return [
    {
      relativePath: `${deviceDir}/common/board.yaml`,
      description: `${board.label} board package (buses, battery, LED, diagnostics)`,
      content: generateBoardPackage(board),
    },
    {
      relativePath: `${deviceDir}/${m.device.directory ?? m.device.name}.yaml`,
      description: "Device config (substitutions, boot, OLED display)",
      content: generateDeviceYaml(board, m),
    },
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
      relativePath: `config/homeassistant/dashboards/pump.yaml`,
      description: "HA dashboard with gauges, controls, settings",
      content: generateDashboard(m),
    },
  ];
}
