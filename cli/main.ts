import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { ManifestSchema } from "../lib/schema.js";
import { validate } from "../lib/validate.js";
import { generateAll, type GeneratedFile } from "../lib/generate.js";
import { loadBoard, type BoardDef } from "../lib/board.js";
import { setupSecrets } from "../lib/generators/secrets.js";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `\
Usage: tsx cli/main.ts <command> [options]

Commands:
  generate <manifest.yaml>    Validate + generate all ESPHome files
  validate <manifest.yaml>    Check manifest without generating
  secrets  <device-dir>       Interactive secrets.yaml setup
  flash    <manifest.yaml>    Generate + compile + flash (USB or OTA)

Options:
  --out-dir <path>     Output directory (default: repo root)
  --device <ip>        Flash via OTA to this IP (default: USB serial)
  --dry-run            Show what would be generated without writing
  --loose              Allow GPIO budget overruns (e.g. when using I2C expanders)
`;

const ROOT = path.resolve(import.meta.dirname, "..");

function die(msg: string): never {
  console.error(`\n  Error: ${msg}\n`);
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      flags.dryRun = true;
    } else if (args[i] === "--loose") {
      flags.loose = true;
    } else if (args[i] === "--out-dir" && args[i + 1]) {
      flags.outDir = args[++i];
    } else if (args[i] === "--device" && args[i + 1]) {
      flags.device = args[++i];
    } else if (!args[i].startsWith("--")) {
      positional.push(args[i]);
    }
  }

  return { command, positional, flags };
}

function loadManifest(filePath: string) {
  if (!fs.existsSync(filePath)) {
    die(`Manifest not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const result = ManifestSchema.safeParse(parseYaml(raw));
  if (!result.success) {
    console.error("\n  Manifest schema errors:");
    for (const issue of result.error.issues) {
      console.error(`    ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

function resolveBoardDef(boardId: string): BoardDef {
  const boardDir = path.join(ROOT, "boards", boardId);
  if (!fs.existsSync(boardDir)) {
    die(`Board definition not found: boards/${boardId}/`);
  }
  try {
    return loadBoard(boardDir);
  } catch (err) {
    die(`Failed to load board "${boardId}": ${err}`);
  }
}

function writeFiles(files: GeneratedFile[], outDir: string, dryRun: boolean) {
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
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, file.content, "utf-8");
    console.log(`  ${padded} ${file.description} (${lines} lines)`);
  }
}

function printValidation(result: ReturnType<typeof validate>) {
  if (result.warnings.length > 0) {
    console.log(`\n  Warnings:`);
    for (const w of result.warnings) console.log(`    ⚠ ${w}`);
  }
  if (result.errors.length > 0) {
    console.log(`\n  Errors:`);
    for (const e of result.errors) console.log(`    ✗ ${e}`);
  }
  if (result.ok) {
    console.log(`\n  ✓ Validation passed — no errors`);
  } else {
    console.log(`\n  ✗ Validation failed — ${result.errors.length} error(s)`);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdValidate(manifestPath: string, loose: boolean) {
  const manifest = loadManifest(manifestPath);
  const board = resolveBoardDef(manifest.device.board);
  console.log(`  Board: ${board.label} (${board.pins.length} exposed pins)`);
  const result = validate(manifest, board, { loose });
  printValidation(result);
  process.exit(result.ok ? 0 : 1);
}

async function cmdGenerate(
  manifestPath: string,
  outDir: string,
  dryRun: boolean,
  loose: boolean,
) {
  const manifest = loadManifest(manifestPath);
  const board = resolveBoardDef(manifest.device.board);
  console.log(`  Board: ${board.label} (${board.pins.length} exposed pins)`);

  const result = validate(manifest, board, { loose });
  printValidation(result);
  if (!result.ok) process.exit(1);

  console.log("\n  Generating files...");
  const files = generateAll(manifest, board);
  writeFiles(files, outDir, dryRun);

  const dir = manifest.device.directory ?? manifest.device.name;
  if (dryRun) {
    console.log(`\n  ${files.length} files would be generated.`);
  } else {
    console.log(`\n  Generated ${files.length} files to ${outDir}/`);
    console.log(`\n  Next steps:`);
    console.log(`    1. esphome compile esphome/${dir}/${dir}.yaml`);
    console.log(`    2. esphome run esphome/${dir}/${dir}.yaml`);
  }
}

async function cmdSecrets(deviceDir: string) {
  await setupSecrets(deviceDir);
}

async function cmdFlash(
  manifestPath: string,
  outDir: string,
  loose: boolean,
  device?: string,
) {
  const manifest = loadManifest(manifestPath);
  const board = resolveBoardDef(manifest.device.board);

  const result = validate(manifest, board, { loose });
  printValidation(result);
  if (!result.ok) process.exit(1);

  console.log("\n  Generating files...");
  const files = generateAll(manifest, board);
  writeFiles(files, outDir, false);

  const dir = manifest.device.directory ?? manifest.device.name;
  const configPath = path.join(outDir, `esphome/${dir}/${dir}.yaml`);

  console.log("\n  Compiling...");
  try {
    execSync(`esphome compile ${configPath}`, { stdio: "inherit" });
  } catch {
    die("Compilation failed");
  }

  console.log("\n  Flashing...");
  const deviceFlag = device ? ` --device ${device}` : "";
  try {
    execSync(`esphome run ${configPath}${deviceFlag}`, { stdio: "inherit" });
  } catch {
    die("Flash failed");
  }

  console.log("\n  Done.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { command, positional, flags } = parseArgs();
  const outDir = (flags.outDir as string) || ROOT;

  switch (command) {
    case "validate": {
      const p = positional[0];
      if (!p) die("Usage: validate <manifest.yaml>");
      await cmdValidate(path.resolve(p), !!flags.loose);
      break;
    }
    case "generate": {
      const p = positional[0];
      if (!p) die("Usage: generate <manifest.yaml>");
      await cmdGenerate(path.resolve(p), outDir, !!flags.dryRun, !!flags.loose);
      break;
    }
    case "secrets": {
      const p = positional[0];
      if (!p) die("Usage: secrets <device-dir>");
      await cmdSecrets(path.resolve(p));
      break;
    }
    case "flash": {
      const p = positional[0];
      if (!p) die("Usage: flash <manifest.yaml>");
      await cmdFlash(path.resolve(p), outDir, !!flags.loose, flags.device as string | undefined);
      break;
    }
    default:
      console.log(USAGE);
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
