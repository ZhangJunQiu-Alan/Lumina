import { supabase } from './supabase';

interface ApiFetchOptions extends RequestInit {
  requiresAuth?: boolean;
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

  return fetch(input, {
    ...rest,
    headers: requestHeaders,
  });
}
