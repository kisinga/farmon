/**
 * YAML fragment utilities — correct-by-construction indentation.
 *
 * Entity codegen returns zero-indented YAML fragments. These utilities
 * handle indentation when composing fragments into final documents,
 * eliminating the class of bugs where an entity returns wrong leading whitespace.
 */

/**
 * Indent every non-empty line of a YAML fragment by `spaces` spaces.
 * Trims trailing whitespace from each line.
 */
export function indent(fragment: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return fragment
    .split('\n')
    .map(line => line.trim() ? pad + line.trimEnd() : '')
    .join('\n');
}

/**
 * Join YAML list items into a section body.
 * Each item is a zero-indented YAML fragment starting with `- platform: ...`.
 * Indents each to `spaces` and separates with blank lines.
 */
export function joinYamlItems(items: string[], spaces: number = 2): string {
  return items.map(item => indent(item, spaces)).join('\n\n');
}

/**
 * A YAML-safe double-quoted scalar for an arbitrary (possibly user-supplied)
 * string. JSON's string grammar is a strict subset of YAML's double-quoted
 * style, so `JSON.stringify` produces a valid scalar — quotes, backslashes and
 * control characters escaped. Use it for any free text emitted as a `key:
 * <value>` (e.g. a user-named entity's `name:`), where a stray `"` would
 * otherwise break the document.
 */
export function yamlString(s: string): string {
  return JSON.stringify(s);
}
