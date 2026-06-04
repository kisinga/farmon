/**
 * Build static documentation: render every `pages/docs/**\/*.hbs` template
 * with empty context, write the result to the corresponding `docs/**\/*.md`.
 *
 * The committed `.md` files in `docs/` are build output, not authored.
 * Authors edit the `.hbs` sources under `src/lib/templates/pages/docs/`.
 *
 * Usage:
 *   npm run docs:build
 *   npm run docs:check   # build then `git diff --exit-code docs/`
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  TEMPLATES_DIR,
  PAGES_DIR,
  compileMarkdownFile,
  registerAllPartials,
} from "../src/lib/templates/hbs.js";

const PAGES_DOCS_DIR = path.join(PAGES_DIR, "docs");
// TEMPLATES_DIR = <repo>/src/lib/templates → repo root is 3 levels up
const REPO_ROOT = path.resolve(TEMPLATES_DIR, "..", "..", "..");
const DOCS_OUTPUT_DIR = path.join(REPO_ROOT, "docs");

function walkHbs(root: string): string[] {
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

function build(): { count: number } {
  registerAllPartials();

  if (!fs.existsSync(PAGES_DOCS_DIR)) {
    console.log(
      `[docs-build] no pages/docs/ directory at ${path.relative(REPO_ROOT, PAGES_DOCS_DIR)} — nothing to build`,
    );
    return { count: 0 };
  }

  const sources = walkHbs(PAGES_DOCS_DIR);
  let count = 0;

  for (const src of sources) {
    const relSrc = path.relative(PAGES_DOCS_DIR, src).replace(/\\/g, "/");
    const relOut = relSrc.replace(/\.hbs$/, ".md");
    const out = path.join(DOCS_OUTPUT_DIR, relOut);

    const tpl = compileMarkdownFile(src);
    const body = tpl({});

    const sourceRef = path
      .relative(REPO_ROOT, src)
      .replace(/\\/g, "/");
    const header = `<!-- generated from ${sourceRef} — do not edit -->\n`;

    // Ensure single newline at EOF
    const content = header + (body.endsWith("\n") ? body : body + "\n");

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, content, "utf-8");
    console.log(`  ✓ ${path.relative(REPO_ROOT, out)}`);
    count++;
  }

  console.log(`\n[docs-build] ${count} doc${count === 1 ? "" : "s"} built`);
  return { count };
}

build();
