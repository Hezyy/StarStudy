/** Coordinate autosync/import/restore across tabs. The server CAS remains the final authority. */
const pending = new Map<string, Promise<unknown>>();
export async function accountOperation<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request(`star-study-account-write:${accountId}`, fn);
  const previous = pending.get(accountId) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(fn);
  pending.set(accountId, current);
  try {
    return await current;
  } finally {
    if (pending.get(accountId) === current) pending.delete(accountId);
  }
}
