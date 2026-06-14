/**
 * Initiator phrasing → one vocabulary for "who/what is behind this" across the
 * dashboard, so the route card's live origin line and the activity timeline's
 * actor chip can never drift apart. Given a run/transition's origin token and a
 * resolved label (a name, an automation's name, or the literal "you"), returns the
 * display string:
 *   - "you"                — the viewer's own manual action (label already "you")
 *   - "by Jane"            — another operator's manual action
 *   - "Automation: Morning"— an automation, or bare "Automation" with no name
 *   - "Manual"             — a manual action with no resolved name
 *   - ""                   — nothing to attribute (SYSTEM / no label)
 *
 * Support actions (admin-on-behalf) are styled differently and pass their label
 * through unchanged at the call site, so they don't route through here.
 */
export function formatInitiator(origin: string | undefined, label: string | undefined): string {
  if (label === 'you') return 'you';
  if (origin === 'AUTOMATION') return label ? `Automation: ${label}` : 'Automation';
  if (origin === 'MANUAL') return label ? `by ${label}` : 'Manual';
  return label ? `by ${label}` : '';
}
