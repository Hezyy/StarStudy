import type { Backup } from '@/services/backup';
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export async function dataHash(backup: Backup) {
  const normalized = Object.fromEntries(
    Object.entries(backup.data).map(([k, v]) => [
      k,
      [...v].sort((a, b) => a.id.localeCompare(b.id)),
    ]),
  );
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical(normalized))),
  );
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
