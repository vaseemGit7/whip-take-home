export function sanitizePayload(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizePayload);
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(obj as object)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    result[key] = sanitizePayload((obj as Record<string, unknown>)[key]);
  }
  return result;
}
