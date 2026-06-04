/**
 * InputPolicy — single source of truth for a regex-constrained string field.
 *
 * Owns three things that must never drift apart:
 *  - the structural Zod regex (`pattern`)
 *  - the keystroke-time char class (`allow`) used by [charFilter]
 *  - the human-facing message (`hint`) used as both the Zod error and the UI hint
 *
 * Policies live next to the regex they own (e.g. HA entity policy in ha.ts,
 * ComponentId policy in schemas.ts). Schemas are built via `policyString(...)`
 * so the message and the pattern can never be supplied independently.
 */
import { z } from 'zod';

export interface InputPolicy {
  /** Full structural pattern — used by Zod and any post-blur validator. */
  pattern: RegExp;
  /** Character class — used by the input-time char filter (must include /g). */
  allow: RegExp;
  /** If true, typed input is auto-lowercased before filtering. */
  lowercase?: boolean;
  /** Human hint, shown to the user and used as the Zod error message. */
  hint: string;
}

export const policyString = (p: InputPolicy) => z.string().regex(p.pattern, p.hint);
