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

/** The viewer's identity + their site's people — the context every "who did it"
 *  decision is relative to. `owners` is the full co-owner id set (always complete,
 *  from `site.owners`) and is what decides membership, so an empty/partial `people`
 *  directory never mislabels a co-owner as an outsider. `people` is the best-effort
 *  contact directory (name/email) for the hover detail; `meEmail` is the viewer's. */
export interface InitiatorCtx {
  meId: string;
  meEmail?: string;
  owners: ReadonlySet<string>;
  people: ReadonlyMap<string, { name?: string; email?: string }>;
}

/** A resolved initiator: the bare chip `label` ('you' / a name / 'Support' / an
 *  automation's name), the `support` flag for the warning-chip styling, and a fuller
 *  `title` for the hover (name · email · relationship). The phrasing ("by …" /
 *  "Automation: …") is added afterwards by {@link formatInitiator}. */
export interface ResolvedInitiator {
  label: string;
  support: boolean;
  title: string;
}

/** Resolve a raw actor (user id + server-resolved name + origin) to the viewer-
 *  relative identity, the SINGLE rule shared by commands, route transitions, and the
 *  live route card:
 *   - an automation         → its name (origin adds the "Automation:" prefix later)
 *   - the viewer themselves → "you" (hover: their email)
 *   - another co-owner      → their name (hover: name · email · co-owner)
 *   - an outsider (admin who took control) → "Support" (never their name — no leak)
 *   - no actor (SYSTEM)     → '' */
export function resolveInitiator(
  a: { origin?: string; actorId?: string; actorName?: string },
  ctx: InitiatorCtx,
): ResolvedInitiator {
  if (a.origin === 'AUTOMATION') {
    const label = a.actorName ?? '';
    return { label, support: false, title: label ? `Automation · ${label}` : '' };
  }
  if (!a.actorId) return { label: '', support: false, title: '' };
  if (a.actorId === ctx.meId) {
    return { label: 'you', support: false, title: ctx.meEmail ? `You · ${ctx.meEmail}` : 'You' };
  }
  if (ctx.owners.has(a.actorId)) {
    const p = ctx.people.get(a.actorId);
    const name = p?.name || a.actorName;
    const detail = [name, p?.email].filter(Boolean).join(' · ');
    return {
      label: name || 'operator',
      support: false,
      title: detail ? `${detail} · co-owner` : 'Co-owner of this site',
    };
  }
  return { label: 'Support', support: true, title: 'Support — an operator acting on your site' };
}
