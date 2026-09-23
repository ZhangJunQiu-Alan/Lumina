import { supabase } from './supabase';
import { readLocal, writeLocal } from './durableStorage';

export interface SyncJob {
  id: string;
  kind: string;
  revision: string;
  payload: unknown;
}

type Handler = (payload: unknown, userId: string) => Promise<void>;
const handlers = new Map<string, Handler>();
const active = new Map<string, Promise<void>>();
const key = (userId: string) => `lumina.sync.v1.${userId}`;

export function pendingJobs(userId: string): SyncJob[] {
  const items = readLocal<SyncJob[]>(key(userId));
  return Array.isArray(items) ? items.filter((job) => job?.id && job.kind && job.revision) : [];
}

export function registerSyncHandler(kind: string, handler: Handler) {
  handlers.set(kind, handler);
}

export function enqueueSync(userId: string, id: string, kind: string, payload: unknown) {
  const job = { id, kind, payload, revision: crypto.randomUUID() };
  const queue = pendingJobs(userId).filter((item) => item.id !== id);
  writeLocal(key(userId), [...queue, job]);
  window.dispatchEvent(new Event('lumina:sync-change'));
  return job;
}

export function flushSyncQueue(userId: string): Promise<void> {
  if (active.has(userId)) return active.get(userId)!;
  const run = (async () => {
    while (navigator.onLine !== false) {
      const job = pendingJobs(userId).find((item) => handlers.has(item.kind));
      if (!job) return;
      const handler = handlers.get(job.kind)!;
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== userId) return;
      try {
        await handler(job.payload, userId);
        writeLocal(
          key(userId),
          pendingJobs(userId).filter((item) => item.revision !== job.revision),
        );
        window.dispatchEvent(new Event('lumina:sync-change'));
      } catch {
        // Keep the exact payload until acknowledged, including after app termination.
        return;
      }
    }
  })().finally(() => active.delete(userId));
  active.set(userId, run);
  return run;
}
