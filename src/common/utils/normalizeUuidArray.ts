/**
 * Normalize incoming query parameter to a flat string array, supporting both
 * `?ids=a&ids=b` (express extended parser) and `?ids=a,b` formats.
 *
 * Behavior:
 *   - `undefined`                  → `undefined` (preserves "filter not set")
 *   - `string` without comma       → `[string]`
 *   - `string` with commas         → `string.split(',').map(trim).filter(Boolean)`
 *   - `string[]` (already flat)    → flatten any comma-split sub-values
 *
 * UUID validity is enforced by downstream `@IsUUID('all', { each: true })`.
 * This helper only shapes the input.
 */
export function normalizeUuidArray(value: unknown): string[] | undefined {
  if (value === undefined || null === value) return undefined;

  if (Array.isArray(value)) {
    return value
      .flatMap((item) =>
        'string' === typeof item ? item.split(',') : [String(item)]
      )
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if ('string' === typeof value) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  // Unknown shape — let downstream validators reject it.
  return undefined;
}
