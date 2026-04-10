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
