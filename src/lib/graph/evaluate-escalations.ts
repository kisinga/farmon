/**
 * Automation-driven escalation.
 *
 * When a route has an active automation, all warning-severity
 * constraints on that route escalate to errors. An automated route
 * running unattended MUST have safety mechanisms that are merely
 * recommended for manual routes.
 */
import type { RuleDiagnostic } from '../validation.types';
import type { Route } from './routes';

interface AutomationLike {
  route: string;
  enabled: boolean;
}

export function evaluateEscalations(
  baseDiagnostics: RuleDiagnostic[],
  routes: Route[],
  automations: AutomationLike[],
): RuleDiagnostic[] {
  const automatedRoutes = new Set(
    automations.filter(a => a.enabled).map(a => a.route),
  );

  if (automatedRoutes.size === 0) return [];

  return baseDiagnostics
    .filter(d => d.severity === 'warning' && d.target && automatedRoutes.has(d.target))
    .map(d => ({
      ...d,
      severity: 'error' as const,
      message: `${d.message} (required — route has active automation)`,
      ruleId: `${d.ruleId}:escalated`,
    }));
}
