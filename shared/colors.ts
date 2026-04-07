/**
 * Consolidated color tokens — single source for entity and UI colors.
 */
import { NODE_REGISTRY } from './entity-registry';

// ---------------------------------------------------------------------------
// Non-entity UI colors
// ---------------------------------------------------------------------------

export const UI_COLORS = {
  pipe: '#64748b',      // slate
  port: '#94a3b8',      // slate-400
  text: '#1e293b',      // slate-800
  bg: '#f8fafc',        // slate-50
  selected: '#3b82f6',  // blue-500
  warning: '#f59e0b',   // amber-500
  error: '#ef4444',     // red-500
  water: '#bae6fd',     // sky-200
  reserved: '#6b7280',  // gray-500
  available: '#d1d5db', // gray-300
} as const;

// ---------------------------------------------------------------------------
// Entity color lookup
// ---------------------------------------------------------------------------

export function entityColor(kind: string): string {
  return NODE_REGISTRY.get(kind)?.color ?? UI_COLORS.text;
}
