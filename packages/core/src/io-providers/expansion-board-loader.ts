/**
 * Expansion board loader — discovers and loads expansion board schemas.
 *
 * Scans defaults/boards/ subdirectories for board.yaml files that declare
 * transport_type (indicating they are expansion boards, not main boards).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ExpansionBoardDef } from '../board.types';
import { BUILTIN_EXPANSION_BOARDS } from './expansion-board-defs';

const EXPANSION_BOARD_CACHE = new Map<string, ExpansionBoardDef>();

function isExpansionBoardYaml(data: unknown): data is ExpansionBoardDef {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return typeof d.model === 'string' && typeof d.transport_type === 'string' && Array.isArray(d.channels);
}

export function loadExpansionBoard(model: string, boardsDir?: string): ExpansionBoardDef {
  const cached = EXPANSION_BOARD_CACHE.get(model);
  if (cached) return cached;

  const builtin = BUILTIN_EXPANSION_BOARDS[model];
  if (builtin) {
    EXPANSION_BOARD_CACHE.set(model, builtin);
    return builtin;
  }

  const baseDir = boardsDir ?? path.resolve(process.cwd(), 'defaults', 'boards');
  const boardPath = path.join(baseDir, model, 'board.yaml');

  if (!fs.existsSync(boardPath)) {
    throw new Error(`Expansion board "${model}" not found at ${boardPath}`);
  }

  const raw = parseYaml(fs.readFileSync(boardPath, 'utf-8'));
  if (!isExpansionBoardYaml(raw)) {
    throw new Error(`Invalid expansion board schema: "${model}"`);
  }

  EXPANSION_BOARD_CACHE.set(model, raw);
  return raw;
}

export function listExpansionBoards(boardsDir?: string): string[] {
  const results = new Set<string>(Object.keys(BUILTIN_EXPANSION_BOARDS));

  const baseDir = boardsDir ?? path.resolve(process.cwd(), 'defaults', 'boards');
  if (fs.existsSync(baseDir)) {
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (results.has(entry.name)) continue;
      const boardPath = path.join(baseDir, entry.name, 'board.yaml');
      if (!fs.existsSync(boardPath)) continue;

      try {
        const raw = parseYaml(fs.readFileSync(boardPath, 'utf-8'));
        if (isExpansionBoardYaml(raw)) {
          results.add(entry.name);
        }
      } catch {
        // Skip invalid YAML
      }
    }
  }
  return [...results];
}
