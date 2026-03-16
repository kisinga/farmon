/** Format 32-char hex App Key as C++ LORAWAN_APP_KEY array for secrets.h */
export function formatAppKeyAsCpp(hex: string): string {
  const h = hex.replace(/\s/g, '').toLowerCase().slice(0, 32);
  if (h.length < 32) return '';
  const bytes = h.match(/.{2}/g)!.map((pair) => '0x' + pair);
  const line1 = bytes.slice(0, 8).join(', ');
  const line2 = bytes.slice(8, 16).join(', ');
  return `static const uint8_t LORAWAN_APP_KEY[16] = {\n    ${line1},\n    ${line2}\n};`;
}

/** Copy text to clipboard; fallback for when Clipboard API is restricted (e.g. HTTP). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand('copy');
      return true;
    } finally {
      document.body.removeChild(el);
    }
  }
}
