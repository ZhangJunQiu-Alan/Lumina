import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageKey = 'lumina.localAuth.session';
const session = () => ({
  access_token: 'test-token',
  refresh_token: 'test-refresh',
  expires_at: Date.now() / 1000 + 3600,
  user: { id: 'alice' },
});
let map: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  map = new Map([[storageKey, JSON.stringify(session())]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('session recovery', () => {
  it('retains a valid session on network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { supabase } = await import('./supabase');
    const result = await supabase.auth.getSession();
    expect(result.data.session?.user.id).toBe('alice');
    expect(map.has(storageKey)).toBe(true);
  });
  it('retains a session during a server outage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    const { supabase } = await import('./supabase');
    expect((await supabase.auth.getSession()).data.session?.user.id).toBe('alice');
  });
  it('removes a session only on an authoritative authentication rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const { supabase } = await import('./supabase');
    expect((await supabase.auth.getSession()).data.session).toBeNull();
    expect(map.has(storageKey)).toBe(false);
  });
  it('deduplicates parallel validation and preserves the refresh token', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ session: { ...session(), refresh_token: '' } })));
    vi.stubGlobal('fetch', fetcher);
    const { supabase } = await import('./supabase');
    await Promise.all([supabase.auth.getSession(), supabase.auth.getSession()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await supabase.auth.getSession()).data.session?.refresh_token).toBe('test-refresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refreshes an expired cloud session', async () => {
    map.set(storageKey, JSON.stringify({ ...session(), expires_at: Date.now() / 1000 - 10 }));
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...session(), access_token: 'renewed' })));
    vi.stubGlobal('fetch', fetcher);
    const { supabase } = await import('./supabase');
    expect((await supabase.auth.getSession()).data.session?.access_token).toBe('renewed');
    expect(fetcher.mock.calls[0][0]).toContain('grant_type=refresh_token');
  });
  it('handles registration requiring email confirmation without a session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ session: null, user: { id: 'pending' } }))),
    );
    const { supabase } = await import('./supabase');
    const result = await supabase.auth.signUp({ email: 'test@example.com', password: 'not-a-real-password' });
    expect(result.error).toBeNull();
    expect(result.data.session).toBeNull();
  });
});
