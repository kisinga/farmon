/**
 * Shared validation types — the single source of truth for both
 * Electron (validation runner) and Angular (UI display).
 *
 * No runtime dependencies. Pure interfaces.
 */

export type Severity = 'error' | 'warning';

export interface RuleDiagnostic {
  severity: Severity;
  message: string;
  /** Node, route, or component ID this diagnostic applies to. */
  target?: string;
  /** The rule that produced this diagnostic. */
  ruleId: string;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  ok: boolean;
  diagnostics: RuleDiagnostic[];
}
