/**
 * Self-contained stylesheet for the assembled per-site documentation HTML.
 *
 * A browser-safe TS constant (the old generator read this from disk via Node
 * `fs`; the assembler runs in the browser, so it ships as a string). Keep in
 * sync with the visual language of the app's other surfaces.
 */
export const DOC_CSS = `
:root {
  --brand: #0EA5E9;
  --brand-dark: #0C4A6E;
  --brand-light: #E0F2FE;
  --text: #1a1a1a;
  --text-muted: #6b7280;
  --border: #e5e7eb;
  --bg-subtle: #f9fafb;
  --bg-card: #f8f9fa;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--text); max-width: 900px; margin: 0 auto; padding: 32px 40px;
  font-size: 13px; line-height: 1.6;
}
.doc-header {
  display: flex; align-items: center; gap: 16px;
  padding-bottom: 20px; margin-bottom: 24px;
  border-bottom: 3px solid var(--brand);
}
.doc-header .logo { flex-shrink: 0; }
.doc-header h1 { font-size: 22px; font-weight: 700; color: var(--brand-dark); margin-bottom: 2px; }
.doc-header .subtitle { color: var(--text-muted); font-size: 12px; }
.doc-header .pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.pill {
  display: inline-block; padding: 2px 10px; border-radius: 12px;
  font-size: 11px; font-weight: 500;
  background: var(--brand-light); color: var(--brand-dark);
}
h2 {
  font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--brand-dark); margin: 28px 0 10px;
  padding-bottom: 6px; border-bottom: 2px solid var(--brand-light);
}
h3 { font-size: 13px; font-weight: 600; margin: 16px 0 6px; color: var(--text); }
h4 { font-size: 12px; font-weight: 600; margin: 12px 0 4px; color: var(--text-muted); }
table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 12px; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
th {
  background: var(--brand-dark); color: white;
  font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
}
tr:nth-child(even) { background: var(--bg-subtle); }
tr:hover { background: var(--brand-light); }
.badge {
  display: inline-block; padding: 1px 8px; border-radius: 10px;
  font-size: 10px; font-weight: 600; text-transform: uppercase;
}
.badge-pump { background: #FEF3C7; color: #92400E; }
.badge-gravity { background: #D1FAE5; color: #065F46; }
.system-header {
  display: flex; align-items: center; gap: 8px; margin: 18px 0 8px;
  padding: 6px 10px; border-radius: 6px; background: var(--bg-subtle);
}
.system-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.diagram { margin: 12px 0; text-align: center; }
.diagram svg {
  max-width: 100%; height: auto;
  border: 1px solid var(--border); border-radius: 8px; background: white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.diagram.topology { margin: 12px 0; max-width: 100%; }
.diagram.topology svg { display: block; width: 100%; height: auto; max-width: 100%; margin: 0 auto; }
.diagram.pinout { margin: 12px 0; max-width: 100%; }
.diagram.pinout svg { display: block; width: 100%; height: auto; max-width: 820px; margin: 0 auto; }
ul, ol { padding-left: 20px; margin: 8px 0; }
li { margin: 4px 0; }
p { margin: 6px 0; }
blockquote {
  margin: 8px 0; padding: 6px 14px; border-left: 3px solid var(--brand-light);
  color: var(--text-muted); background: var(--bg-subtle);
}
code {
  background: var(--bg-subtle); border: 1px solid var(--border);
  padding: 1px 5px; border-radius: 3px; font-size: 11px;
  font-family: ui-monospace, 'SF Mono', monospace;
}
.installation { margin-top: 28px; padding-top: 16px; border-top: 3px solid var(--brand-light); }
.footer {
  margin-top: 40px; padding: 16px 0;
  border-top: 2px solid var(--brand-light);
  display: flex; justify-content: space-between; align-items: center;
  font-size: 10px; color: var(--text-muted);
}
.footer .brand { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--brand-dark); }
.print-button {
  position: fixed; top: 16px; right: 16px; z-index: 1000;
  padding: 8px 14px; border: 1px solid var(--brand); border-radius: 6px;
  background: var(--brand); color: #fff; font-size: 13px; font-weight: 600;
  cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.12);
}
.print-button:hover { background: var(--brand-dark); border-color: var(--brand-dark); }
@media print {
  body { padding: 0; max-width: none; }
  .diagram svg { border: none; box-shadow: none; }
  h2 { page-break-after: avoid; }
  table { page-break-inside: avoid; }
  tr:hover { background: inherit; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 8px 40px; }
  .print-button { display: none; }
}
`;
