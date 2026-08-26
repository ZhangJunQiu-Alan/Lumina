import { supabase } from './supabase';

interface ApiFetchOptions extends RequestInit {
  requiresAuth?: boolean;
}

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const apiBaseUrl = configuredApiBaseUrl || '';

let cachedAccessToken: string | null = null;

void supabase.auth.getSession().then(({ data }) => {
  cachedAccessToken = data.session?.access_token ?? null;
});
supabase.auth.onAuthStateChange((_event, session) => {
  cachedAccessToken = session?.access_token ?? null;
});

export function getCachedAccessToken() {
  return cachedAccessToken;
}

export function resolveApiUrl(path: string) {
  if (!path || !apiBaseUrl || !path.startsWith('/')) {
    return path;
  }

  const normalizedBase = apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`;
  return new URL(path.replace(/^\/+/, ''), normalizedBase).toString();
}

function resolveFetchInput(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return resolveApiUrl(input);
  }

  if (typeof window !== 'undefined' && input instanceof URL && apiBaseUrl && input.origin === window.location.origin) {
    return new URL(
      `${input.pathname.replace(/^\/+/, '')}${input.search}${input.hash}`,
      apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`,
    );
  }

  return input;
}

export async function apiFetch(input: RequestInfo | URL, init: ApiFetchOptions = {}) {
  const { requiresAuth = true, headers, ...rest } = init;
  const requestHeaders = new Headers(headers ?? {});

  if (requiresAuth) {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw new Error(error.message);
    }

    const accessToken = data.session?.access_token;
    if (!accessToken) {
      throw new Error('请先登录，再继续当前操作。');
    }

    requestHeaders.set('Authorization', `Bearer ${accessToken}`);
  }

  return fetch(resolveFetchInput(input), {
    ...rest,
    headers: requestHeaders,
  });
}
