/**
 * Bind expression resolver — grammar v1 (frozen):
 *
 *   <expr>      := <source> ( '|format:' <formatter> )?
 *   <source>    := 'state' | 'attributes.' <path>
 *   <path>      := [a-zA-Z0-9_.]+     (dot-separated, allows nested attrs)
 *   <formatter> := 'watts' | 'percent' | 'number:<n>' | 'datetime:relative'
 *
 * No conditionals, no math. If that's needed, users create HA template sensors.
 */

export interface HassStateLike {
  state: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export function resolveBind(expr: string, s: HassStateLike | undefined): string {
  if (!s) return '\u2014';
  const [source, formatPart] = expr.split('|');
  const raw = readSource(source.trim(), s);
  if (raw == null) return '\u2014';
  if (!formatPart) return String(raw);
  const formatter = formatPart.replace(/^format:/, '').trim();
  return formatValue(raw, formatter, s);
}

function readSource(source: string, s: HassStateLike): unknown {
  if (source === 'state') return s.state;
  if (source.startsWith('attributes.')) {
    const path = source.slice('attributes.'.length).split('.');
    let v: unknown = s.attributes;
    for (const seg of path) {
      if (v && typeof v === 'object' && seg in (v as object)) {
        v = (v as Record<string, unknown>)[seg];
      } else {
        return undefined;
      }
    }
    return v;
  }
  return undefined;
}

function formatValue(raw: unknown, formatter: string, s: HassStateLike): string {
  const str = String(raw);
  // number:<decimals>
  if (formatter.startsWith('number:')) {
    const decimals = parseInt(formatter.slice('number:'.length), 10);
    const n = Number(raw);
    if (!Number.isFinite(n)) return str;
    return n.toFixed(Number.isFinite(decimals) ? decimals : 1);
  }
  if (formatter === 'watts') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return str;
    if (n >= 1000) return `${(n / 1000).toFixed(1)} kW`;
    return `${Math.round(n)} W`;
  }
  if (formatter === 'percent') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return str;
    return `${Math.round(n)}%`;
  }
  if (formatter === 'datetime:relative') {
    const iso = String(raw);
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return str;
    return relativeTime(t, Date.now());
  }
  return str;
  // Touched `s` only via closure; keep signature for future formatters needing attrs.
  void s;
}

function relativeTime(then: number, now: number): string {
  const d = Math.round((now - then) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}
