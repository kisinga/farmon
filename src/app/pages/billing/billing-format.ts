/**
 * Pure billing display/boundary helpers — no Angular, so the tsx unit suite
 * (test/billing-format.test.ts) can import them directly.
 *
 * Money invariant (backend architecture §5): all money in data is integer MINOR
 * units (KES cents); usage is integer millilitres. Conversion to major units /
 * litres happens here, at the form/display boundary only.
 */

/** Format integer minor units as a currency string with 2 decimals. */
export function formatMoney(minor: number, currency = 'KES'): string {
  try {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency,
      // 'code' renders "KES 1,500.50" — the default symbol form ("Ksh") differs
      // between ICU builds, and the product copy says KES.
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    // Unknown currency code — fall back to a plain prefixed number.
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

/**
 * Parse a user-typed major-units amount ("1,234.56") into integer minor units.
 * Returns null for empty, negative, non-numeric or >2-decimal input — the form
 * treats null as invalid. String math (no floats) so 0.1 + 0.2 style drift
 * can't creep into money.
 */
export function parseMoneyToMinor(input: string): number | null {
  const s = input.trim();
  // Commas are accepted only as well-formed thousands separators ("1,234.56"),
  // never as loose grouping ("1,2,3" must not silently become 123).
  if (s.includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(s)) return null;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s.replace(/,/g, ''));
  if (!m) return null;
  const whole = parseInt(m[1]!, 10);
  const cents = m[2] ? parseInt(m[2].padEnd(2, '0'), 10) : 0;
  return whole * 100 + cents;
}

/** Integer millilitres → whole litres for display (nearest litre). */
export function mlToLitres(ml: number): number {
  return Math.round(ml / 1000);
}

/** Integer millilitres → grouped litre string, e.g. "12,345 L". */
export function formatLitres(ml: number): string {
  return `${mlToLitres(ml).toLocaleString('en-KE')} L`;
}

/** ISO timestamp → short date, '' for empty/invalid. */
export function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/** ISO timestamp → short date + time, '' for empty/invalid. */
export function fmtDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}
