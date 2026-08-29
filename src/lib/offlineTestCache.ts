import { supabase } from './supabase';
import { readLocal, writeLocal } from './durableStorage';

export async function withOfflineTest<T>(
  kind: string,
  testId: string,
  fetchTest: () => Promise<T | null>,
): Promise<T | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return fetchTest();
  const key = `lumina.test-cache.v1.${userId}.${kind}`;
  const entries = readLocal<{ id: string; data: T }[]>(key);
  const cached = Array.isArray(entries) ? entries : [];
  const previous = cached.find((entry) => entry.id === testId)?.data;
  if (!navigator.onLine && previous) return previous;
  try {
    const next = await fetchTest();
    if (next) {
      try {
        writeLocal(key, [{ id: testId, data: next }, ...cached.filter((entry) => entry.id !== testId)].slice(0, 2));
      } catch {
        /* Draft writes report storage pressure separately. */
      }
    }
    return next;
  } catch (error) {
    if (previous) return previous;
    throw error;
  }
}
