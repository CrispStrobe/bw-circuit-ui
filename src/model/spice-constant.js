import { parseSpiceValue } from './si.js';

const LIMITS = Object.freeze({ definitions: 256, tokens: 256, depth: 32 });
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;
// The micro sign in both spellings (U+00B5 from CP1252 vendor models, U+03BC
// from UTF-8 editors) is a scale factor here exactly as `U` is; see the
// MICRO_SIGN note in si.js. It must be INSIDE the suffix group, not merely
// absent from the trailing-character class: `55\u00b5` already matched `55`
// as a number and then died on the sign as an unsupported token.
const NUMBER = /^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:MEG|MIL|[TGMKUNPF\u00b5\u03bc])?(?![A-Za-z0-9_.])/i;

function stripOuterBraces (source) {
  const text = String(source).trim();
  if (!text.startsWith('{')) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i === text.length - 1 ? text.slice(1, -1).trim() : text;
      if (depth < 0) return text;
    }
  }
  return text;
}

function tokenize (source) {
  const text = stripOuterBraces(source);
  const tokens = [];
  let at = 0;
  while (at < text.length) {
    if (/\s/.test(text[at])) { at++; continue; }
    const tail = text.slice(at);
    const number = NUMBER.exec(tail);
    if (number) {
      const value = parseSpiceValue(number[0]);
      if (!Number.isFinite(value)) throw new Error('numeric literal is not finite');
      tokens.push({ type: 'number', value });
      at += number[0].length;
    } else {
      const ident = IDENT.exec(tail);
      if (ident) {
        tokens.push({ type: 'identifier', value: ident[0].toLowerCase() });
        at += ident[0].length;
      } else if ('()+-*/'.includes(text[at])) {
        tokens.push({ type: text[at] });
        at++;
      } else {
        throw new Error(`unsupported token at ${JSON.stringify(tail.slice(0, 16))}`);
      }
    }
    if (tokens.length > LIMITS.tokens) throw new Error(`expression exceeds ${LIMITS.tokens} tokens`);
  }
  if (!tokens.length) throw new Error('empty constant expression');
  return tokens;
}

export function parseConstantExpression (source) {
  const tokens = tokenize(source);
  let at = 0;
  let nodes = 0;
  const make = node => {
    if (++nodes > LIMITS.tokens) throw new Error(`expression exceeds ${LIMITS.tokens} nodes`);
    return node;
  };
  const peek = type => tokens[at]?.type === type;
  const take = type => {
    if (!peek(type)) throw new Error(`expected ${type}, found ${tokens[at]?.type || 'end'}`);
    return tokens[at++];
  };
  const primary = depth => {
    if (depth > LIMITS.depth) throw new Error(`expression exceeds depth ${LIMITS.depth}`);
    if (peek('number')) return make({ type: 'number', value: take('number').value });
    if (peek('identifier')) return make({ type: 'identifier', name: take('identifier').value });
    if (peek('(')) {
      take('(');
      const node = sum(depth + 1);
      take(')');
      return node;
    }
    throw new Error(`expected constant, found ${tokens[at]?.type || 'end'}`);
  };
  const unary = depth => {
    if (peek('+') || peek('-')) {
      const operator = tokens[at++].type;
      return make({ type: 'unary', operator, value: unary(depth + 1) });
    }
    return primary(depth);
  };
  const product = depth => {
    let left = unary(depth);
    while (peek('*') || peek('/')) {
      const operator = tokens[at++].type;
      left = make({ type: 'binary', operator, left, right: unary(depth) });
    }
    return left;
  };
  const sum = depth => {
    let left = product(depth);
    while (peek('+') || peek('-')) {
      const operator = tokens[at++].type;
      left = make({ type: 'binary', operator, left, right: product(depth) });
    }
    return left;
  };
  const ast = sum(0);
  if (at !== tokens.length) throw new Error(`unexpected ${tokens[at].type}`);
  return ast;
}

export function evaluateConstantExpression (source, resolve = () => undefined) {
  const ast = typeof source === 'string' ? parseConstantExpression(source) : source;
  const visit = (node, depth = 0) => {
    if (depth > LIMITS.depth) throw new Error(`expression exceeds depth ${LIMITS.depth}`);
    if (node.type === 'number') return node.value;
    if (node.type === 'identifier') {
      const value = resolve(node.name);
      if (!Number.isFinite(value)) throw new Error(`undefined constant ${node.name}`);
      return value;
    }
    if (node.type === 'unary') {
      const value = visit(node.value, depth + 1);
      return node.operator === '-' ? -value : value;
    }
    const left = visit(node.left, depth + 1);
    const right = visit(node.right, depth + 1);
    if (node.operator === '/' && right === 0) throw new Error('division by zero');
    const value = node.operator === '+' ? left + right
      : node.operator === '-' ? left - right
        : node.operator === '*' ? left * right : left / right;
    if (!Number.isFinite(value)) throw new Error('constant expression is not finite');
    return value;
  };
  const value = visit(ast);
  if (!Number.isFinite(value)) throw new Error('constant expression is not finite');
  return value;
}

function assignments (card) {
  const match = /^\s*\.params?\s+([\s\S]+)$/i.exec(String(card));
  if (!match) throw new Error('not a .param card');
  const body = match[1];
  const starts = [...body.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/g)];
  if (!starts.length) throw new Error('.param has no assignments');
  if (starts[0].index !== 0) throw new Error('unsupported text before first .param assignment');
  return starts.map((item, index) => ({
    name: item[1].toLowerCase(),
    expression: body.slice(item.index + item[0].length,
      index + 1 < starts.length ? starts[index + 1].index : body.length).trim(),
  }));
}

export function resolveConstantParameters (cards) {
  const definitions = new Map();
  const losses = [];
  for (const source of cards) {
    let parsed;
    try { parsed = assignments(source); } catch (error) {
      losses.push({ name: null, source, reason: error.message });
      continue;
    }
    for (const definition of parsed) {
      if (definitions.size >= LIMITS.definitions && !definitions.has(definition.name)) {
        losses.push({ name: definition.name, source,
          reason: `parameter set exceeds ${LIMITS.definitions} definitions` });
        continue;
      }
      if (definitions.has(definition.name)) {
        losses.push({ name: definition.name, source,
          reason: `duplicate parameter ${definition.name}` });
        definitions.get(definition.name).duplicate = true;
        continue;
      }
      definitions.set(definition.name, { ...definition, source });
    }
  }
  const values = new Map();
  const state = new Map();
  const resolving = [];
  const resolve = name => {
    if (values.has(name)) return values.get(name);
    const definition = definitions.get(name);
    if (!definition || definition.duplicate) throw new Error(`undefined constant ${name}`);
    if (state.get(name) === 'visiting') throw new Error(`cyclic parameter ${name}`);
    if (state.get(name) === 'failed') throw new Error(`unresolved parameter ${name}`);
    if (resolving.length >= LIMITS.depth) throw new Error(`parameter dependency exceeds depth ${LIMITS.depth}`);
    state.set(name, 'visiting');
    resolving.push(name);
    try {
      const value = evaluateConstantExpression(definition.expression, resolve);
      values.set(name, value);
      state.set(name, 'done');
      return value;
    } catch (error) {
      state.set(name, 'failed');
      throw error;
    } finally {
      resolving.pop();
    }
  };
  for (const [name, definition] of definitions) {
    if (definition.duplicate || values.has(name)) continue;
    try { resolve(name); } catch (error) {
      losses.push({ name, source: definition.source, reason: error.message });
    }
  }
  return { values, losses };
}
