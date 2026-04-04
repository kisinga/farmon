import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as readline from "node:readline";

function ask(
  rl: readline.Interface,
  question: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question + " ", (answer) => resolve(answer.trim()));
  });
}

export async function setupSecrets(deviceDir: string): Promise<void> {
  const secretsPath = path.join(deviceDir, "secrets.yaml");

  if (fs.existsSync(secretsPath)) {
    console.log(`  secrets.yaml already exists at ${secretsPath}`);
    console.log("  Delete it to regenerate.");
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("\n  Setting up secrets for", deviceDir);
    console.log("  ─────────────────────────────────────");

    const wifi_ssid = await ask(rl, "  WiFi SSID:");
    const wifi_password = await ask(rl, "  WiFi password:");

    const ota_input = await ask(
      rl,
      "  OTA password (leave empty for random):"
    );
    const ota_password =
      ota_input || crypto.randomBytes(16).toString("hex");

    const fallback_input = await ask(
      rl,
      "  Fallback AP password (leave empty to reuse OTA password):"
    );
    const fallback_password = fallback_input || ota_password;

    const api_key = crypto.randomBytes(32).toString("base64");

    const content = [
      `wifi_ssid: "${wifi_ssid}"`,
      `wifi_password: "${wifi_password}"`,
      `fallback_password: "${fallback_password}"`,
      `api_key: "${api_key}"`,
      `ota_password: "${ota_password}"`,
    ].join("\n") + "\n";

    fs.writeFileSync(secretsPath, content, "utf-8");
    console.log(`\n  Wrote ${secretsPath}`);
    console.log(`  API key: ${api_key}`);
  } finally {
    rl.close();
  }
}
