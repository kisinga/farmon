/**
 * compute-expression.ts
 *
 * Expression language for compute variables. Provides tokenizing, parsing,
 * validation, humanization, bytecode size estimation, and recipe→expression
 * conversion.
 *
 * Grammar:
 *   expression = term (('+' | '-') term)*
 *   term       = factor (('*' | '/') factor)*
 *   factor     = primary | '-' factor
 *   primary    = NUMBER | FIELD_REF | '(' expression ')' | func_call
 *   func_call  = FUNC_NAME '(' args ')'
 *   FIELD_REF  = 'f' DIGIT+
 *
 * Sources: firmware/pkg/settings/settings.go (opcodes),
 *          firmware/pkg/compute/vm.go (stack VM semantics)
 */

import { DeviceVariable } from '../services/api.types';

// ─── Opcode constants (must match firmware/pkg/settings/settings.go) ────────

export const OP = {
  LoadField:  0x01,
  PushF32:    0x02,
  Add:        0x10,
  Sub:        0x11,
  Mul:        0x12,
  Div:        0x13,
  CmpGT:      0x20,
  CmpLT:      0x21,
  CmpGTE:     0x22,
  CmpLTE:     0x23,
  Min2:       0x30,
  Max2:       0x31,
  Abs:        0x32,
  Neg:        0x33,
  Accum:      0x40,
  WindowAvg:  0x41,
  Clamp:      0x42,
  Mod:        0x14,
  Select:     0x24,
  Delta:      0x43,
} as const;

// ─── Tokens ─────────────────────────────────────────────────────────────────

export type TokenType =
  | 'number' | 'field_ref' | 'ident'
  | '+' | '-' | '*' | '/' | '%' | '(' | ')' | ',';

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

export function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    // Whitespace
    if (/\s/.test(expr[i])) { i++; continue; }

    // Single-char operators / delimiters
    if ('+-*/(),%'.includes(expr[i])) {
      tokens.push({ type: expr[i] as TokenType, pos: i, value: expr[i] });
      i++;
      continue;
    }

    // Number literal (integer or float)
    if (/[0-9.]/.test(expr[i])) {
      const start = i;
      while (i < expr.length && /[0-9.eE\-+]/.test(expr[i])) {
        // Allow 'e' or 'E' only after digits, and +/- only after e/E
        if ((expr[i] === '+' || expr[i] === '-') && i > start && expr[i - 1] !== 'e' && expr[i - 1] !== 'E') break;
        i++;
      }
      tokens.push({ type: 'number', value: expr.slice(start, i), pos: start });
      continue;
    }

    // Field ref (f0, f1, f12, ...) or identifier (min, max, avg, ...)
    if (/[a-zA-Z_]/.test(expr[i])) {
      const start = i;
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) i++;
      const word = expr.slice(start, i);
      if (/^f\d+$/.test(word)) {
        tokens.push({ type: 'field_ref', value: word, pos: start });
      } else {
        tokens.push({ type: 'ident', value: word, pos: start });
      }
      continue;
    }

    throw new ExpressionError(`Unexpected character '${expr[i]}'`, i);
  }
  return tokens;
}

// ─── AST ────────────────────────────────────────────────────────────────────

export type ASTNode =
  | { type: 'number'; value: number }
  | { type: 'field_ref'; index: number }
  | { type: 'binary_op'; op: '+' | '-' | '*' | '/' | '%'; left: ASTNode; right: ASTNode }
  | { type: 'unary_neg'; arg: ASTNode }
  | { type: 'call'; name: string; args: ASTNode[] };

export class ExpressionError extends Error {
  constructor(message: string, public pos?: number) {
    super(message);
    this.name = 'ExpressionError';
  }
}

// ─── Parser ─────────────────────────────────────────────────────────────────

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  parse(): ASTNode {
    const node = this.expression();
    if (this.pos < this.tokens.length) {
      throw new ExpressionError(
        `Unexpected token '${this.tokens[this.pos].value}'`,
        this.tokens[this.pos].pos,
      );
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eat(type: TokenType): Token {
    const t = this.tokens[this.pos];
    if (!t || t.type !== type) {
      throw new ExpressionError(
        `Expected '${type}' but got ${t ? `'${t.value}'` : 'end of expression'}`,
        t?.pos,
      );
    }
    this.pos++;
    return t;
  }

  private expression(): ASTNode {
    let left = this.term();
    while (this.peek()?.type === '+' || this.peek()?.type === '-') {
      const op = this.eat(this.peek()!.type).type as '+' | '-';
      const right = this.term();
      left = { type: 'binary_op', op, left, right };
    }
    return left;
  }

  private term(): ASTNode {
    let left = this.factor();
    while (this.peek()?.type === '*' || this.peek()?.type === '/' || this.peek()?.type === '%') {
      const op = this.eat(this.peek()!.type).type as '*' | '/' | '%';
      const right = this.factor();
      left = { type: 'binary_op', op, left, right };
    }
    return left;
  }

  private factor(): ASTNode {
    if (this.peek()?.type === '-') {
      this.eat('-');
      const arg = this.factor();
      return { type: 'unary_neg', arg };
    }
    return this.primary();
  }

  private primary(): ASTNode {
    const t = this.peek();
    if (!t) throw new ExpressionError('Unexpected end of expression');

    // Number literal
    if (t.type === 'number') {
      this.pos++;
      const val = parseFloat(t.value);
      if (isNaN(val)) throw new ExpressionError(`Invalid number '${t.value}'`, t.pos);
      return { type: 'number', value: val };
    }

    // Field reference
    if (t.type === 'field_ref') {
      this.pos++;
      return { type: 'field_ref', index: parseInt(t.value.slice(1), 10) };
    }

    // Function call
    if (t.type === 'ident') {
      this.pos++;
      if (this.peek()?.type === '(') {
        this.eat('(');
        const args: ASTNode[] = [];
        if (this.peek()?.type !== ')') {
          args.push(this.expression());
          while (this.peek()?.type === ',') {
            this.eat(',');
            args.push(this.expression());
          }
        }
        this.eat(')');
        return { type: 'call', name: t.value, args };
      }
      throw new ExpressionError(`Unknown identifier '${t.value}'. Did you mean a function call like '${t.value}(...)'?`, t.pos);
    }

    // Parenthesized expression
    if (t.type === '(') {
      this.eat('(');
      const node = this.expression();
      this.eat(')');
      return node;
    }

    throw new ExpressionError(`Unexpected token '${t.value}'`, t.pos);
  }
}

export function parse(expr: string): ASTNode {
  const tokens = tokenize(expr);
  if (tokens.length === 0) throw new ExpressionError('Empty expression');
  return new Parser(tokens).parse();
}

// ─── Validation ─────────────────────────────────────────────────────────────

const KNOWN_FUNCTIONS: Record<string, { minArgs: number; maxArgs: number }> = {
  min:    { minArgs: 2, maxArgs: 2 },
  max:    { minArgs: 2, maxArgs: 2 },
  abs:    { minArgs: 1, maxArgs: 1 },
  neg:    { minArgs: 1, maxArgs: 1 },
  accum:  { minArgs: 1, maxArgs: 1 },
  avg:    { minArgs: 2, maxArgs: 2 },  // avg(field, windowSize)
  clamp:  { minArgs: 3, maxArgs: 3 },  // clamp(field, min, max)
  gt:     { minArgs: 2, maxArgs: 2 },
  lt:     { minArgs: 2, maxArgs: 2 },
  gte:    { minArgs: 2, maxArgs: 2 },
  lte:    { minArgs: 2, maxArgs: 2 },
  mod:    { minArgs: 2, maxArgs: 2 },
  select: { minArgs: 3, maxArgs: 3 },
  delta:  { minArgs: 1, maxArgs: 1 },
};

export interface ExprValidationError {
  severity: 'error' | 'warning';
  message: string;
}

export function validate(ast: ASTNode, fields: DeviceVariable[]): ExprValidationError[] {
  const errors: ExprValidationError[] = [];
  const fieldIndices = new Set(fields.map(f => f.field_idx ?? -1));

  function walk(node: ASTNode): void {
    switch (node.type) {
      case 'number':
        break;
      case 'field_ref':
        if (!fieldIndices.has(node.index)) {
          errors.push({ severity: 'warning', message: `Field f${node.index} does not exist.` });
        }
        break;
      case 'binary_op':
        walk(node.left);
        walk(node.right);
        break;
      case 'unary_neg':
        walk(node.arg);
        break;
      case 'call': {
        const spec = KNOWN_FUNCTIONS[node.name];
        if (!spec) {
          errors.push({ severity: 'error', message: `Unknown function '${node.name}'.` });
        } else {
          if (node.args.length < spec.minArgs || node.args.length > spec.maxArgs) {
            errors.push({
              severity: 'error',
              message: `'${node.name}' expects ${spec.minArgs === spec.maxArgs ? spec.minArgs : `${spec.minArgs}-${spec.maxArgs}`} argument(s), got ${node.args.length}.`,
            });
          }
          // avg: second arg must be integer literal 1-16
          if (node.name === 'avg' && node.args.length >= 2) {
            const windowArg = node.args[1];
            if (windowArg.type !== 'number' || !Number.isInteger(windowArg.value) || windowArg.value < 1 || windowArg.value > 16) {
              errors.push({ severity: 'error', message: `'avg' window size must be an integer 1-16.` });
            }
          }
          // clamp: args 2 and 3 must be number literals
          if (node.name === 'clamp' && node.args.length >= 3) {
            if (node.args[1].type !== 'number') {
              errors.push({ severity: 'error', message: `'clamp' min must be a number literal.` });
            }
            if (node.args[2].type !== 'number') {
              errors.push({ severity: 'error', message: `'clamp' max must be a number literal.` });
            }
          }
        }
        for (const arg of node.args) walk(arg);
        break;
      }
    }
  }

  walk(ast);

  const size = estimateBytecodeSize(ast);
  if (size > 64) {
    errors.push({ severity: 'error', message: `Expression too complex: estimated ${size} bytes exceeds 64-byte limit.` });
  }

  return errors;
}

// ─── Bytecode size estimation ───────────────────────────────────────────────

export function estimateBytecodeSize(ast: ASTNode): number {
  switch (ast.type) {
    case 'number':    return 5;  // OpPushF32 + 4 bytes
    case 'field_ref': return 2;  // OpLoadField + 1 byte index
    case 'binary_op':
      return estimateBytecodeSize(ast.left) + estimateBytecodeSize(ast.right) + 1;
    case 'unary_neg':
      return estimateBytecodeSize(ast.arg) + 1;
    case 'call': {
      let size = ast.args.reduce((s, a) => s + estimateBytecodeSize(a), 0);
      switch (ast.name) {
        case 'avg':    size += 2; break; // OpWindowAvg + 1 byte window size
        case 'clamp':  size += 9; break; // OpClamp + 8 bytes (2x float32)
        default:       size += 1; break; // single opcode
      }
      return size;
    }
  }
}

// ─── Humanize ───────────────────────────────────────────────────────────────

/** Replace f0, f1, ... with display names for human-readable preview. */
export function humanize(expr: string, fields: DeviceVariable[]): string {
  return expr.replace(/\bf(\d+)\b/g, (match, idx) => {
    const index = parseInt(idx, 10);
    const field = fields.find(f => f.field_idx === index);
    return field ? (field.display_name || field.field_key) : match;
  });
}

// ─── Function catalog (for UI help) ────────────────────────────────────────

export interface FunctionInfo {
  name: string;
  signature: string;
  description: string;
  example: string;
}

export const FUNCTION_CATALOG: FunctionInfo[] = [
  { name: 'avg',   signature: 'avg(field, N)',          description: 'Rolling N-point average (N: 1-16)',   example: 'avg(f0, 8)' },
  { name: 'accum', signature: 'accum(field)',           description: 'Running sum (cumulative total)',      example: 'accum(f0)' },
  { name: 'clamp', signature: 'clamp(field, min, max)', description: 'Clamp value to [min, max] range',    example: 'clamp(f0, 0, 100)' },
  { name: 'min',   signature: 'min(a, b)',              description: 'Minimum of two values',              example: 'min(f0, f1)' },
  { name: 'max',   signature: 'max(a, b)',              description: 'Maximum of two values',              example: 'max(f0, f1)' },
  { name: 'abs',   signature: 'abs(value)',             description: 'Absolute value',                     example: 'abs(f0 - f1)' },
  { name: 'neg',   signature: 'neg(value)',             description: 'Negate value',                       example: 'neg(f0)' },
  { name: 'gt',    signature: 'gt(a, b)',               description: 'Returns 1 if a > b, else 0',        example: 'gt(f0, 25)' },
  { name: 'lt',    signature: 'lt(a, b)',               description: 'Returns 1 if a < b, else 0',        example: 'lt(f0, 10)' },
  { name: 'gte',   signature: 'gte(a, b)',              description: 'Returns 1 if a >= b, else 0',       example: 'gte(f0, 25)' },
  { name: 'lte',   signature: 'lte(a, b)',              description: 'Returns 1 if a <= b, else 0',       example: 'lte(f0, 10)' },
  { name: 'mod',   signature: 'mod(a, b)',              description: 'Modulo (remainder of a / b)',        example: 'mod(f0, 60)' },
  { name: 'select', signature: 'select(cond, a, b)',    description: 'Returns a when cond != 0, else b',   example: 'select(gt(f0, 100), f1, f2)' },
  { name: 'delta', signature: 'delta(field)',            description: 'Change since previous cycle',        example: 'delta(f0)' },
];

// ─── Recipe types ───────────────────────────────────────────────────────────

export type RecipeType =
  | 'unit_conversion'
  | 'smoothing'
  | 'clamping'
  | 'running_total'
  | 'comparison'
  | 'combine'
  | 'rate_of_change'
  | 'sensor_mapping'
  | 'conditional'
  | 'custom';

export interface RecipeTemplate {
  id: RecipeType;
  label: string;
  description: string;
}

export const RECIPE_TEMPLATES: RecipeTemplate[] = [
  { id: 'unit_conversion', label: 'Unit Conversion',  description: 'Scale and offset a value' },
  { id: 'smoothing',       label: 'Smoothing',        description: 'Rolling average to reduce noise' },
  { id: 'clamping',        label: 'Clamping',         description: 'Limit value to a range' },
  { id: 'running_total',   label: 'Running Total',    description: 'Cumulative sum (e.g. rainfall)' },
  { id: 'comparison',      label: 'Comparison',       description: 'Boolean flag (0 or 1)' },
  { id: 'combine',         label: 'Combine Fields',   description: 'Operate on two fields' },
  { id: 'rate_of_change',  label: 'Rate of Change',   description: 'Change per cycle (delta)' },
  { id: 'sensor_mapping',  label: 'Sensor Mapping',   description: 'Map input range to output range' },
  { id: 'conditional',     label: 'Conditional',      description: 'Choose value based on condition' },
  { id: 'custom',          label: 'Custom',           description: 'Write a raw expression' },
];

// ─── Recipe → expression conversion ─────────────────────────────────────────

export interface UnitConversionParams { fieldIdx: number; scale: number; offset: number; }
export interface SmoothingParams      { fieldIdx: number; windowSize: number; }
export interface ClampingParams       { fieldIdx: number; min: number; max: number; }
export interface RunningTotalParams   { fieldIdx: number; }
export interface ComparisonParams     { fieldIdx: number; op: 'gt' | 'lt' | 'gte' | 'lte'; threshold: number; }
export interface CombineParams        { fieldIdxA: number; fieldIdxB: number; op: '+' | '-' | '*' | '/' | 'min' | 'max'; }
export interface CustomParams         { expression: string; }
export interface RateOfChangeParams  { fieldIdx: number; scale: number; }
export interface SensorMappingParams { fieldIdx: number; inLow: number; inHigh: number; outLow: number; outHigh: number; }
export interface ConditionalParams   { condFieldIdx: number; op: 'gt' | 'lt' | 'gte' | 'lte'; threshold: number; ifTrueFieldIdx: number; ifFalseFieldIdx: number; }

export type RecipeParams =
  | { recipe: 'unit_conversion'; params: UnitConversionParams }
  | { recipe: 'smoothing';       params: SmoothingParams }
  | { recipe: 'clamping';        params: ClampingParams }
  | { recipe: 'running_total';   params: RunningTotalParams }
  | { recipe: 'comparison';      params: ComparisonParams }
  | { recipe: 'combine';         params: CombineParams }
  | { recipe: 'rate_of_change';  params: RateOfChangeParams }
  | { recipe: 'sensor_mapping';  params: SensorMappingParams }
  | { recipe: 'conditional';     params: ConditionalParams }
  | { recipe: 'custom';          params: CustomParams };

export function recipeToExpression(rp: RecipeParams): string {
  switch (rp.recipe) {
    case 'unit_conversion': {
      const { fieldIdx, scale, offset } = rp.params;
      if (offset === 0) return `f${fieldIdx} * ${scale}`;
      if (scale === 1) return `f${fieldIdx} + ${offset}`;
      return `f${fieldIdx} * ${scale} + ${offset}`;
    }
    case 'smoothing':
      return `avg(f${rp.params.fieldIdx}, ${rp.params.windowSize})`;
    case 'clamping':
      return `clamp(f${rp.params.fieldIdx}, ${rp.params.min}, ${rp.params.max})`;
    case 'running_total':
      return `accum(f${rp.params.fieldIdx})`;
    case 'comparison':
      return `${rp.params.op}(f${rp.params.fieldIdx}, ${rp.params.threshold})`;
    case 'combine': {
      const { fieldIdxA, fieldIdxB, op } = rp.params;
      if (op === 'min' || op === 'max') return `${op}(f${fieldIdxA}, f${fieldIdxB})`;
      return `f${fieldIdxA} ${op} f${fieldIdxB}`;
    }
    case 'rate_of_change': {
      const { fieldIdx, scale } = rp.params;
      if (scale === 1) return `delta(f${fieldIdx})`;
      return `delta(f${fieldIdx}) * ${scale}`;
    }
    case 'sensor_mapping': {
      const { fieldIdx, inLow, inHigh, outLow, outHigh } = rp.params;
      return `(f${fieldIdx} - ${inLow}) / (${inHigh} - ${inLow}) * (${outHigh} - ${outLow}) + ${outLow}`;
    }
    case 'conditional': {
      const { condFieldIdx, op, threshold, ifTrueFieldIdx, ifFalseFieldIdx } = rp.params;
      return `select(${op}(f${condFieldIdx}, ${threshold}), f${ifTrueFieldIdx}, f${ifFalseFieldIdx})`;
    }
    case 'custom':
      return rp.params.expression;
  }
}

// ─── Try-parse helper for the UI ────────────────────────────────────────────

export interface ParseResult {
  ast: ASTNode | null;
  errors: ExprValidationError[];
}

/** Parse and validate an expression, returning all errors (parse or semantic). */
export function parseAndValidate(expr: string, fields: DeviceVariable[]): ParseResult {
  if (!expr.trim()) {
    return { ast: null, errors: [] };
  }
  try {
    const ast = parse(expr);
    const errors = validate(ast, fields);
    return { ast, errors };
  } catch (e) {
    const msg = e instanceof ExpressionError ? e.message : 'Invalid expression';
    return { ast: null, errors: [{ severity: 'error', message: msg }] };
  }
}
