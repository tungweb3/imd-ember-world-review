export const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 200000;
export const jsonByteLength = text => new TextEncoder().encode(text).length;

/** JSON key order is immaterial; unsupported numbers, prototypes and cycles fail closed. */
export function canonicalJSON(value) {
  const ancestors = new Set();
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw Error('JSON_COMPLEXITY_LIMIT');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item)) throw Error('JSON_NUMBER_INVALID');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object' || ancestors.has(item)) throw Error('JSON_VALUE_INVALID');
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw Error('JSON_OBJECT_INVALID');
    ancestors.add(item);
    let result;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) throw Error('JSON_ARRAY_INVALID');
      result = '[' + item.map(child => visit(child, depth + 1)).join(',') + ']';
    } else {
      result = '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + visit(item[key], depth + 1)).join(',') + '}';
    }
    ancestors.delete(item);
    return result;
  }
  const result = visit(value, 0);
  if (jsonByteLength(result) > MAX_JSON_BYTES) throw Error('JSON_SIZE_LIMIT');
  return result;
}

/** Integer JSON subset for local envelopes; rejects duplicate keys and precision-losing tokens. */
export function parseStrictJSON(source) {
  if (typeof source !== 'string') throw Error('JSON_TEXT_REQUIRED');
  if (jsonByteLength(source) > MAX_JSON_BYTES) throw Error('JSON_SIZE_LIMIT');
  let offset = 0, nodes = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(source[offset] ?? '\0')) offset++; };
  const fail = () => { throw Error('JSON_SYNTAX_INVALID'); };
  function string() {
    if (source[offset] !== '"') fail();
    const start = offset++;
    while (offset < source.length) {
      const character = source[offset++];
      if (character === '"') {
        try { return JSON.parse(source.slice(start, offset)); } catch { fail(); }
      }
      if (character === '\\') offset++;
    }
    fail();
  }
  function value(depth) {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw Error('JSON_COMPLEXITY_LIMIT');
    whitespace();
    const character = source[offset];
    if (character === '"') return string();
    if (character === '[') {
      offset++; whitespace();
      const result = [];
      if (source[offset] === ']') { offset++; return result; }
      while (true) {
        result.push(value(depth + 1)); whitespace();
        if (source[offset] === ']') { offset++; return result; }
        if (source[offset++] !== ',') fail();
      }
    }
    if (character === '{') {
      offset++; whitespace();
      const result = {}, keys = new Set();
      if (source[offset] === '}') { offset++; return result; }
      while (true) {
        whitespace(); const key = string();
        if (keys.has(key)) throw Error('JSON_DUPLICATE_PROPERTY');
        keys.add(key); whitespace();
        if (source[offset++] !== ':') fail();
        Object.defineProperty(result, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        whitespace();
        if (source[offset] === '}') { offset++; return result; }
        if (source[offset++] !== ',') fail();
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(literal, offset)) { offset += literal.length; return result; }
    }
    const number = source.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!number) fail();
    offset += number[0].length;
    if (!/^-?(?:0|[1-9]\d*)$/.test(number[0])) throw Error('JSON_NUMBER_INVALID');
    const result = Number(number[0]);
    if (!Number.isSafeInteger(result)) throw Error('JSON_NUMBER_INVALID');
    return result;
  }
  const result = value(0); whitespace();
  if (offset !== source.length) fail();
  return result;
}
