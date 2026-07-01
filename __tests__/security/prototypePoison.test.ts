/**
 * Prototype Pollution Defense Tests
 *
 * A malicious mini app can craft a JSON payload with __proto__, constructor,
 * or prototype keys to pollute Object.prototype on the RN JS thread:
 *
 *   { "__proto__": { "isAdmin": true } }
 *
 * After JSON.parse this does NOT pollute in V8 (JSON.parse creates a clean
 * object), but if the host passes the parsed object to Object.assign or
 * iterates keys and assigns to another object's prototype, pollution can occur.
 *
 * Defense: sanitizePayload() recursively strips these keys before the payload
 * reaches any capability handler.
 */

import {sanitizePayload} from '../../src/bridge/sanitize';

describe('sanitizePayload — prototype pollution defense', () => {
  it('strips __proto__ at top level', () => {
    const input = JSON.parse('{"__proto__":{"isAdmin":true},"foo":"bar"}');
    const result = sanitizePayload(input) as Record<string, unknown>;

    expect(result.foo).toBe('bar');
    expect('__proto__' in result).toBe(false);
    // Verify no pollution occurred on the actual prototype
    expect(({}  as any).isAdmin).toBeUndefined();
  });

  it('strips constructor at top level', () => {
    const input = {constructor: {prototype: {isAdmin: true}}, safe: 'value'};
    const result = sanitizePayload(input) as Record<string, unknown>;

    expect(result.safe).toBe('value');
    expect('constructor' in result).toBe(false);
  });

  it('strips prototype at top level', () => {
    const input = {prototype: {isAdmin: true}, safe: 'value'};
    const result = sanitizePayload(input) as Record<string, unknown>;

    expect(result.safe).toBe('value');
    expect('prototype' in result).toBe(false);
  });

  it('strips poison keys nested inside clean objects', () => {
    const input = {
      nested: {
        __proto__: {isAdmin: true},
        deep: {
          constructor: 'evil',
          safe: 42,
        },
      },
    };
    const result = sanitizePayload(input) as any;

    expect(result.nested).toBeDefined();
    expect('__proto__' in result.nested).toBe(false);
    expect('constructor' in result.nested.deep).toBe(false);
    expect(result.nested.deep.safe).toBe(42);
  });

  it('strips poison keys inside array elements', () => {
    const input = [
      {__proto__: {evil: true}, keep: 'me'},
      {safe: 'value'},
    ];
    const result = sanitizePayload(input) as any[];

    expect(result[0].keep).toBe('me');
    expect('__proto__' in result[0]).toBe(false);
    expect(result[1].safe).toBe('value');
  });

  it('passes through primitive values unchanged', () => {
    expect(sanitizePayload(42)).toBe(42);
    expect(sanitizePayload('string')).toBe('string');
    expect(sanitizePayload(true)).toBe(true);
    expect(sanitizePayload(null)).toBe(null);
    expect(sanitizePayload(undefined)).toBe(undefined);
  });

  it('passes through clean objects unchanged', () => {
    const input = {name: 'hello', count: 5, nested: {x: 1}};
    const result = sanitizePayload(input) as any;

    expect(result.name).toBe('hello');
    expect(result.count).toBe(5);
    expect(result.nested.x).toBe(1);
  });

  it('result object has null prototype (immune to future prototype lookups)', () => {
    const input = {key: 'value'};
    const result = sanitizePayload(input);

    // Object.create(null) means no inherited toString, hasOwnProperty, etc.
    expect(Object.getPrototypeOf(result)).toBe(null);
  });

  it('handles deeply nested poison without crashing', () => {
    const deepInput: Record<string, unknown> = {};
    let cur: Record<string, unknown> = deepInput;
    for (let i = 0; i < 50; i++) {
      cur.child = {__proto__: {level: i}, value: i};
      cur = cur.child as Record<string, unknown>;
    }

    expect(() => sanitizePayload(deepInput)).not.toThrow();
    const result = sanitizePayload(deepInput) as any;
    expect(result.child).toBeDefined();
    expect('__proto__' in result.child).toBe(false);
  });

  it('does not mutate the original input object', () => {
    const input = {__proto__: {evil: true}, safe: 'value'} as any;
    sanitizePayload(input);

    // Input object is unchanged
    expect(input.safe).toBe('value');
  });
});
