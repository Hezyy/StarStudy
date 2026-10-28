import type { SupabaseClient } from '@supabase/supabase-js';
import type { IntegrationConfig } from './integrations';
import { validateBackup, type Backup } from './backup';
export interface RemoteSnapshot {
  revision: number;
  payload: Backup;
  updatedAt: string;
}
export interface SnapshotStore {
  read: () => Promise<RemoteSnapshot | null>;
  write: (payload: Backup, expectedRevision: number) => Promise<RemoteSnapshot>;
}
export interface SyncCursor {
  revision: number;
  dataHash: string;
  queued: boolean;
}
export class SyncConflict extends Error {
  constructor() {
    super('云端版本已变化，已停止上传。请先比较并选择本机或云端版本。');
  }
}
export async function payloadHash(backup: Backup) {
  if (!crypto.subtle) throw new Error('安全同步需要HTTPS或localhost来源');
  const bytes = new TextEncoder().encode(JSON.stringify(backup.data));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
export function syncDecision(
  localHash: string,
  cursor: SyncCursor | null,
  remote: RemoteSnapshot | null,
) {
  if (!remote) return 'upload';
  if (!cursor) return 'choose';
  const localChanged = localHash !== cursor.dataHash,
    remoteChanged = remote.revision !== cursor.revision;
  if (localChanged && remoteChanged) return 'conflict';
  if (remoteChanged) return 'download';
  if (localChanged) return 'upload';
  return 'synced';
}
export async function pushSnapshot(
  store: SnapshotStore,
  payload: Backup,
  expectedRevision: number,
) {
  validateBackup(payload);
  const remote = await store.read();
  if ((remote?.revision ?? 0) !== expectedRevision) throw new SyncConflict();
  return store.write(payload, expectedRevision);
}
let client: SupabaseClient | null = null,
  clientKey = '';
export async function cloudClient(config: IntegrationConfig) {
  if (!config.cloud.configured) throw new Error('云同步未配置；本地任务和文件备份仍可正常使用');
  if (!/^https:\/\//.test(config.cloud.url)) throw new Error('云同步要求HTTPS Supabase地址');
  const key = config.cloud.publicKey;
  if (key.startsWith('sb_secret_'))
    throw new Error('禁止在客户端使用Supabase secret/service_role密钥');
  if (key.split('.').length === 3) {
    try {
      const role = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role;
      if (role === 'service_role') throw new Error('禁止使用service_role密钥');
    } catch (e) {
      if (e instanceof Error && e.message.includes('禁止')) throw e;
    }
  }
  const fingerprint = config.cloud.url + key;
  if (!client || clientKey !== fingerprint) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(config.cloud.url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    clientKey = fingerprint;
  }
  return client;
}
export async function supabaseStore(
  config: IntegrationConfig,
): Promise<{ store: SnapshotStore; userId: string; email: string }> {
  const c = await cloudClient(config);
  const { data, error } = await c.auth.getUser();
  if (error || !data.user) throw new Error('请先登录云端账户');
  const userId = data.user.id;
  const map = (row: {
    revision: number;
    payload: unknown;
    updated_at: string;
  }): RemoteSnapshot => ({
    revision: Number(row.revision),
    payload: validateBackup(row.payload),
    updatedAt: row.updated_at,
  });
  return {
    userId,
    email: data.user.email ?? '',
    store: {
      async read() {
        const { data, error } = await c
          .from('study_snapshots')
          .select('revision,payload,updated_at')
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw new Error(`读取云端失败：${error.message}`);
        return data ? map(data) : null;
      },
      async write(payload, expectedRevision) {
        const row = {
          user_id: userId,
          revision: expectedRevision + 1,
          payload,
          updated_at: new Date().toISOString(),
        };
        const response =
          expectedRevision === 0
            ? await c
                .from('study_snapshots')
                .insert(row)
                .select('revision,payload,updated_at')
                .single()
            : await c
                .from('study_snapshots')
                .update(row)
                .eq('user_id', userId)
                .eq('revision', expectedRevision)
                .select('revision,payload,updated_at')
                .maybeSingle();
        if (response.error) {
          if (response.error.code === '23505') throw new SyncConflict();
          throw new Error(`写入云端失败：${response.error.message}`);
        }
        if (!response.data) throw new SyncConflict();
        return map(response.data);
      },
    },
  };
}
export const cursorKey = (url: string, userId: string) => `star-study-sync:${url}:${userId}`;
export function readCursor(key: string): SyncCursor | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v && Number.isInteger(v.revision) && typeof v.dataHash === 'string' ? v : null;
  } catch {
    return null;
  }
}
export function writeCursor(key: string, value: SyncCursor) {
  localStorage.setItem(key, JSON.stringify(value));
}
