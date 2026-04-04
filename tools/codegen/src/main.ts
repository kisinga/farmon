import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { ManifestSchema } from "./schema.js";
import { validate } from "./validate.js";
import { generateAll, writeFiles } from "./generate.js";
import { setupSecrets } from "./generators/secrets.js";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `\
Usage: tsx src/main.ts <command> [options]

Commands:
  generate <manifest.yaml>    Validate + generate all ESPHome files
  validate <manifest.yaml>    Check manifest without generating
  secrets  <device-dir>       Interactive secrets.yaml setup
  flash    <manifest.yaml>    Generate + compile + flash (USB or OTA)

Options:
  --out-dir <path>     Output directory (default: repo root)
  --device <ip>        Flash via OTA to this IP (default: USB serial)
  --dry-run            Show what would be generated without writing
`;

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
  const parsed = parseYaml(raw);

  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    console.error("\n  Manifest schema errors:");
    for (const issue of result.error.issues) {
      console.error(`    ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

function printValidation(
  result: ReturnType<typeof validate>,
  label: string
): void {
  if (result.warnings.length > 0) {
    console.log(`\n  Warnings:`);
    for (const w of result.warnings) {
      console.log(`    ⚠ ${w}`);
    }
  }
  if (result.errors.length > 0) {
    console.log(`\n  Errors:`);
    for (const e of result.errors) {
      console.log(`    ✗ ${e}`);
    }
  }
  if (result.ok) {
    console.log(`\n  ✓ ${label} — no errors`);
  } else {
    console.log(
      `\n  ✗ ${label} — ${result.errors.length} error(s), aborting`
    );
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdValidate(manifestPath: string) {
  const manifest = loadManifest(manifestPath);
  const result = validate(manifest);
  printValidation(result, "Validation passed");
  process.exit(result.ok ? 0 : 1);
}

async function cmdGenerate(
  manifestPath: string,
  outDir: string,
  dryRun: boolean
) {
  const manifest = loadManifest(manifestPath);
  const result = validate(manifest);
  printValidation(result, "Validation passed");

  if (!result.ok) {
    process.exit(1);
  }

  console.log("\n  Generating files...");
  const files = generateAll(manifest);
  writeFiles(files, outDir, dryRun);

  if (!dryRun) {
    console.log("\n  Substitutions written to _substitutions.yaml");
    console.log(
      "  Copy the substitutions block into your pump-controller.yaml"
    );
    console.log(
      `\n  Generated ${files.length} files. Run:`
    );
    const dir = manifest.device.directory ?? manifest.device.name;
    console.log(
      `    esphome compile esphome/${dir}/${dir}.yaml`
    );
  }
}

async function cmdSecrets(deviceDir: string) {
  await setupSecrets(deviceDir);
}

async function cmdFlash(
  manifestPath: string,
  outDir: string,
  device?: string
) {
  const manifest = loadManifest(manifestPath);
  const result = validate(manifest);
  printValidation(result, "Validation passed");

  if (!result.ok) {
    process.exit(1);
  }

  console.log("\n  Generating files...");
  const files = generateAll(manifest);
  writeFiles(files, outDir, false);

  const dir = manifest.device.directory ?? manifest.device.name;
  const configPath = path.join(
    outDir,
    `esphome/${dir}/${dir}.yaml`
  );

  if (!fs.existsSync(configPath)) {
    die(
      `Config not found at ${configPath}. Ensure pump-controller.yaml exists.`
    );
  }

  console.log("\n  Compiling...");
  try {
    execSync(`esphome compile ${configPath}`, { stdio: "inherit" });
  } catch {
    die("Compilation failed");
  }

  console.log("\n  Flashing...");
  const deviceFlag = device ? ` --device ${device}` : "";
  try {
    execSync(`esphome run ${configPath}${deviceFlag}`, {
      stdio: "inherit",
    });
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

  // Resolve output dir — default to repo root (3 levels up from tools/codegen/src/)
  const outDir =
    (flags.outDir as string) ||
    path.resolve(import.meta.dirname, "..", "..", "..");

  switch (command) {
    case "validate": {
      const manifestPath = positional[0];
      if (!manifestPath) die("Usage: validate <manifest.yaml>");
      await cmdValidate(path.resolve(manifestPath));
      break;
    }
    case "generate": {
      const manifestPath = positional[0];
      if (!manifestPath) die("Usage: generate <manifest.yaml>");
      await cmdGenerate(
        path.resolve(manifestPath),
        outDir,
        !!flags.dryRun
      );
      break;
    }
    case "secrets": {
      const deviceDir = positional[0];
      if (!deviceDir) die("Usage: secrets <device-dir>");
      await cmdSecrets(path.resolve(deviceDir));
      break;
    }
    case "flash": {
      const manifestPath = positional[0];
      if (!manifestPath) die("Usage: flash <manifest.yaml>");
      await cmdFlash(
        path.resolve(manifestPath),
        outDir,
        flags.device as string | undefined
      );
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
