/**
 * Shared Handlebars instance for all MajiFlow documentation rendering.
 *
 * Two consumers:
 *  - electron/lib/generators/site-readme.ts  (per-install doc, runtime)
 *  - scripts/docs-build.ts                   (static docs, build time)
 *
 * Both want the same helpers and the same partial library. This module is
 * the single source for both — register a helper or a partial here, every
 * doc gets it.
 *
 * Path resolution walks up from __dirname looking for the templates root.
 * That makes it robust across:
 *   - source execution via tsx (test/site-doc-snapshot.test.ts)
 *   - compiled execution from dist-electron/
 *   - asar-packaged Electron runtime
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Handlebars from "handlebars";
import { marked } from "marked";

// Markdown rendering — synchronous so it composes with HBS's sync render path.
// `gfm: true` enables GitHub-flavored markdown (tables, strikethrough, task lists).
marked.setOptions({ gfm: true, breaks: false, async: false });

// ---------------------------------------------------------------------------
// Templates directory discovery
// ---------------------------------------------------------------------------
function findTemplatesRoot(start: string): string {
  let dir = start;
  for (;;) {
    const candidate = path.join(dir, "packages", "core", "src", "templates");
    if (fs.existsSync(path.join(candidate, "documentation.css"))) return candidate;

    // Also handle the case where __dirname IS already inside the templates
    // dir (compiled location: dist-electron/packages/core/src/templates/).
    // The hbs files live at the source location, not the compiled one.
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        "[hbs] could not locate packages/core/src/templates (no documentation.css found while walking up from " +
          start +
          ")",
      );
    }
    dir = parent;
  }
}

export const TEMPLATES_DIR = findTemplatesRoot(__dirname);
export const PARTIALS_DIR = path.join(TEMPLATES_DIR, "partials");
export const PAGES_DIR = path.join(TEMPLATES_DIR, "pages");

// ---------------------------------------------------------------------------
// Handlebars instance + helpers
// ---------------------------------------------------------------------------
export const hbs = Handlebars.create();

hbs.registerHelper("eq", function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return a === b ? options.fn(this) : options.inverse(this);
});

// Passthrough to built-in unless (kept for parity with the previous inline setup)
hbs.registerHelper("unless", Handlebars.helpers["unless"]);

// `{{{{raw}}}} ... {{{{/raw}}}}` — emit body verbatim, no HBS parsing inside.
// Used by docs-build.ts to wrap fenced markdown code blocks so their `{{ }}`
// stays literal. Returns the body string unchanged.
hbs.registerHelper("raw", function (this: unknown, options: Handlebars.HelperOptions) {
  return options.fn(this);
});

/**
 * `{{md "partial-name"}}` — load a markdown partial, render it through HBS
 * (so it can itself reference partials), run through marked, return as a
 * SafeString so HBS doesn't re-escape the HTML.
 *
 * Use this in the per-install HTML template to embed shared markdown content.
 * In a markdown page template, prefer the plain `{{> partial-name }}` form
 * (no marked render — the partial text is already markdown).
 */
hbs.registerHelper("md", function (this: unknown, name: unknown) {
  if (typeof name !== "string") return "";
  registerAllPartials();
  const src = (hbs.partials as Record<string, string>)[name];
  if (typeof src !== "string") {
    throw new Error(`[hbs] {{md "${name}"}}: partial not found. Looked in ${PARTIALS_DIR}/${name}.hbs`);
  }
  // Render HBS first (so the partial can use sub-partials and helpers), then marked.
  const expanded = hbs.compile(src)(this);
  const html = marked.parse(expanded) as string;
  return new Handlebars.SafeString(html);
});

// ---------------------------------------------------------------------------
// Partial auto-registration
// ---------------------------------------------------------------------------
function walkHbsFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".hbs")) out.push(full);
    }
  }
  return out;
}

let partialsRegistered = false;

/**
 * Register every `partials/**\/*.hbs` file as a Handlebars partial.
 * Partial names use forward-slash relative paths, e.g.:
 *   partials/glossary/site.hbs           →  {{> glossary/site }}
 *   partials/sections/wiring/psu.hbs     →  {{> sections/wiring/psu }}
 *
 * Idempotent — safe to call multiple times.
 */
export function registerAllPartials(): void {
  if (partialsRegistered) return;
  for (const file of walkHbsFiles(PARTIALS_DIR)) {
    const rel = path
      .relative(PARTIALS_DIR, file)
      .replace(/\\/g, "/")
      .replace(/\.hbs$/, "");
    hbs.registerPartial(rel, fs.readFileSync(file, "utf-8"));
  }
  partialsRegistered = true;
}

// ---------------------------------------------------------------------------
// Convenience loaders
// ---------------------------------------------------------------------------
const compiledCache = new Map<string, HandlebarsTemplateDelegate>();

/** Compile a template by absolute path (cached). Auto-registers partials first. */
export function compileFile(absPath: string): HandlebarsTemplateDelegate {
  registerAllPartials();
  const cached = compiledCache.get(absPath);
  if (cached) return cached;
  const src = fs.readFileSync(absPath, "utf-8");
  const compiled = hbs.compile(src);
  compiledCache.set(absPath, compiled);
  return compiled;
}

/**
 * Render a registered partial by name with a context, returning the markdown
 * output. Used by the in-app Deploy panel to render the same `.hbs` partial
 * the static docs use, but with a runtime-computed diff context. Partials are
 * auto-registered on first call.
 */
export function renderPartial(name: string, context: unknown): string {
  registerAllPartials();
  const src = (hbs.partials as Record<string, string>)[name];
  if (typeof src !== "string") {
    throw new Error(`[hbs] renderPartial("${name}"): partial not found in ${PARTIALS_DIR}`);
  }
  return hbs.compile(src)(context);
}

/**
 * Compile a markdown-source template (page or partial) by absolute path,
 * pre-processing fenced code blocks so their `{{ }}` content is treated
 * literally by HBS instead of parsed as expressions.
 *
 * Use this for `pages/docs/**\/*.hbs` and any markdown partial that may
 * contain code samples with template syntax (Angular, Handlebars, Jinja, etc.).
 */
export function compileMarkdownFile(absPath: string): HandlebarsTemplateDelegate {
  registerAllPartials();
  const cacheKey = absPath + "::md";
  const cached = compiledCache.get(cacheKey);
  if (cached) return cached;
  const src = fs.readFileSync(absPath, "utf-8");
  const wrapped = escapeFencedCodeBlocks(src);
  const compiled = hbs.compile(wrapped);
  compiledCache.set(cacheKey, compiled);
  return compiled;
}

/**
 * Wrap each fenced code block (```lang ... ```) in `{{{{raw}}}}...{{{{/raw}}}}`
 * so that any `{{ }}` inside is emitted verbatim. The raw delimiters themselves
 * are consumed by Handlebars and don't appear in output.
 */
function escapeFencedCodeBlocks(src: string): string {
  return src.replace(
    /^(```[^\n]*\n)([\s\S]*?)(\n```)/gm,
    (_, open: string, body: string, close: string) =>
      `${open}{{{{raw}}}}${body}{{{{/raw}}}}${close}`,
  );
}

/** Compile a page template by relative path under `pages/`. */
export function compilePage(relPath: string): HandlebarsTemplateDelegate {
  return compileFile(path.join(PAGES_DIR, relPath));
}
