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

/** The viewer's identity + their site's owner set — the context every "who did it"
 *  decision is relative to. `owners` is the full co-owner id set (multi-owner sites);
 *  anyone outside it (and not the viewer) is an outsider, i.e. Support. */
export interface InitiatorCtx {
  meId: string;
  owners: ReadonlySet<string>;
}

/** Resolve a raw actor (user id + server-resolved name + origin) to the viewer-
 *  relative identity, the SINGLE rule shared by commands, route transitions, and the
 *  live route card:
 *   - an automation        → its name (origin carries the "Automation:" prefix later)
 *   - the viewer themselves → "you"
 *   - another co-owner      → their name
 *   - an outsider (admin who took control) → "Support" (never their name — no leak)
 *   - no actor (SYSTEM)     → ''
 *  Returns the bare label plus `support` for the warning-chip styling; the phrasing
 *  ("by …" / "Automation: …") is added afterwards by {@link formatInitiator}. */
export function resolveInitiator(
  a: { origin?: string; actorId?: string; actorName?: string },
  ctx: InitiatorCtx,
): { label: string; support: boolean } {
  if (a.origin === 'AUTOMATION') return { label: a.actorName ?? '', support: false };
  if (!a.actorId) return { label: '', support: false };
  if (a.actorId === ctx.meId) return { label: 'you', support: false };
  if (ctx.owners.has(a.actorId)) return { label: a.actorName || 'operator', support: false };
  return { label: 'Support', support: true };
}
