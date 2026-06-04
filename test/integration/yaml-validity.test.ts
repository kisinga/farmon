/**
 * Integration test: run every fixture config through the full codegen
 * pipeline and verify that all generated YAML files are parseable.
 *
 * Tests architectural correctness (the pipeline composes valid YAML),
 * not logic correctness (the YAML does the right thing at runtime).
 *
 * Usage: npx tsx test/integration/yaml-validity.test.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml, parseAllDocuments } from 'yaml';
import { parseTopology, topologyToManifestForController } from '@core';
import { loadBoard } from '../../electron/lib/board.js';
import { generateAll, createTestMetadata } from '../../electron/lib/generate.js';

const DEFAULTS = path.resolve(new URL('.', import.meta.url).pathname, '..', '..', 'defaults');
const CONFIGS_DIR = path.join(DEFAULTS, 'configs');
const BOARDS_DIR = path.join(DEFAULTS, 'boards');

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Discover and iterate all fixture configs
// ---------------------------------------------------------------------------

const configFiles = fs.readdirSync(CONFIGS_DIR).filter(f => f.endsWith('.yaml'));

console.log('YAML Validity Integration Tests');
console.log('================================\n');
console.log(`Found ${configFiles.length} fixture configs.\n`);

for (const configFile of configFiles) {
  const configPath = path.join(CONFIGS_DIR, configFile);
  const rawConfig = fs.readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(rawConfig);
  const boardName: string = parsed.device?.board;

  console.log(`${configFile} (board: ${boardName}):`);

  // Load board + run pipeline
  const board = loadBoard(path.join(BOARDS_DIR, boardName));
  const topology = parseTopology(parsed);
  const manifest = topologyToManifestForController(topology, topology.controllers[0]?.id ?? 'default');
  const files = generateAll(manifest, board, 'test-site', undefined, createTestMetadata());

  assert(files.length > 0, 'Pipeline produces at least one file');

  // Validate every .yaml file is parseable
  const yamlFiles = files.filter(f => f.relativePath.endsWith('.yaml'));
  assert(yamlFiles.length > 0, 'At least one .yaml file generated');

  for (const file of yamlFiles) {
    const short = file.relativePath;
    try {
      const result = parseYaml(file.content);
      assert(result != null && typeof result === 'object', `${short} — valid YAML object`);
    } catch (err: any) {
      // Some generated files (automations) contain multiple YAML documents.
      if (err.message?.includes('multiple documents')) {
        try {
          const docs = parseAllDocuments(file.content);
          assert(docs.length > 0 && docs.every(d => d.contents != null), `${short} — valid YAML`);
        } catch (err2: any) {
          assert(false, `${short} — valid YAML`, err2.message);
        }
      } else {
        assert(false, `${short} — valid YAML`, err.message);
      }
    }
  }

  console.log('');
}

// ---------------------------------------------------------------------------

console.log(`${'='.repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
