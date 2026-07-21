import type { RecordModel } from 'pocketbase';

/** Typed accessors for PocketBase RecordModel fields.
 *
 *  PocketBase v0.27's RecordModel is a plain object with `[key: string]: any`,
 *  so direct bracket access returns `any`. These helpers narrow the value and
 *  supply sensible defaults, keeping call sites free of `as` casts. */

export function getString(record: RecordModel, key: string, fallback = ''): string {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

export function getNumber(record: RecordModel, key: string, fallback = 0): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getBoolean(record: RecordModel, key: string, fallback = false): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function getStringArray(record: RecordModel, key: string): string[] {
  const value = record[key];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

/** PocketBase autodate ("YYYY-MM-DD HH:MM:SS.sssZ") → ISO 8601 (T-separated). A
 *  space-separated string is not valid ISO and parses inconsistently across
 *  engines (NaN in JavaScriptCore/Safari), so every record timestamp that will
 *  be Date.parse()d downstream — activity feed merges, presence `last_seen` —
 *  must be normalised here first. */
export function toIso(ts: string): string {
  return typeof ts === 'string' ? ts.replace(' ', 'T') : ts;
}
