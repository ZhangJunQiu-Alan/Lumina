import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '../runtime.ts';

const localDataMode = Boolean(getEnv('LUMINA_POSTGREST_URL') && getEnv('LUMINA_SERVICE_ROLE_JWT'));
const legacySupabaseEnabled = (getEnv('LUMINA_ALLOW_LEGACY_SUPABASE') ?? '').toLowerCase() === 'true';
const dataUrl = localDataMode
  ? (getEnv('LUMINA_DATA_URL') ?? getEnv('SUPABASE_URL'))
  : (getEnv('SUPABASE_URL') ?? getEnv('VITE_SUPABASE_URL'));
const serviceRoleKey = localDataMode
  ? getEnv('LUMINA_SERVICE_ROLE_JWT')
  : (getEnv('LUMINA_SUPABASE_SERVICE_ROLE_KEY') ?? getEnv('SUPABASE_SERVICE_ROLE_KEY'));

if (!localDataMode && !legacySupabaseEnabled) {
  throw new Error(
    'Self-hosted data mode is required. Set LUMINA_POSTGREST_URL, LUMINA_SERVICE_ROLE_JWT, and LUMINA_DATA_URL.',
  );
}

if (!dataUrl || !serviceRoleKey) {
  throw new Error(
    localDataMode
      ? 'Missing local data env vars: LUMINA_DATA_URL and LUMINA_SERVICE_ROLE_JWT'
      : 'Missing Supabase env vars: SUPABASE_URL/VITE_SUPABASE_URL and LUMINA_SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY',
  );
}

function storageRoot() {
  return path.resolve(getEnv('LUMINA_LOCAL_STORAGE_ROOT') ?? path.join(process.cwd(), 'storage'));
}

function publicBaseUrl() {
  const configured = getEnv('LUMINA_PUBLIC_BASE_URL')?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const fallback = dataUrl?.trim().replace(/\/+$/, '') ?? '';
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(fallback)) {
    return '';
  }
  return fallback;
}

function normalizeObjectPath(objectPath: string) {
  const normalized = path.posix.normalize(objectPath.replace(/^\/+/, ''));
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('Invalid storage object path.');
  }
  return normalized;
}

function objectFilePath(bucket: string, objectPath: string) {
  const normalizedBucket = normalizeObjectPath(bucket);
  const normalizedObject = normalizeObjectPath(objectPath);
  const root = storageRoot();
  const filePath = path.resolve(root, normalizedBucket, normalizedObject);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid storage object path.');
  }
  return { root, filePath, normalizedBucket, normalizedObject };
}

function publicObjectUrl(bucket: string, objectPath: string) {
  const { normalizedBucket, normalizedObject } = objectFilePath(bucket, objectPath);
  const relativeUrl = `/storage/v1/object/public/${normalizedBucket}/${normalizedObject}`;
  const base = publicBaseUrl();
  return base ? new URL(relativeUrl, `${base}/`).toString() : relativeUrl;
}

function createLocalStorageBucket(bucket: string) {
  return {
    async upload(objectPath: string, body: Uint8Array | ArrayBuffer, _options?: Record<string, unknown>) {
      try {
        const { filePath, normalizedBucket, normalizedObject } = objectFilePath(bucket, objectPath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const data = body instanceof ArrayBuffer ? new Uint8Array(body) : body;
        await fs.writeFile(filePath, data);
        const fullPath = `${normalizedBucket}/${normalizedObject}`;
        return { data: { path: normalizedObject, fullPath }, error: null };
      } catch (error) {
        return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
      }
    },
    getPublicUrl(objectPath: string) {
      return {
        data: {
          publicUrl: publicObjectUrl(bucket, objectPath),
        },
      };
    },
    async createSignedUrls(objectPaths: string[], _expiresIn: number) {
      try {
        return {
          data: objectPaths.map((objectPath) => ({
            path: objectPath,
            signedUrl: publicObjectUrl(bucket, objectPath),
          })),
          error: null,
        };
      } catch (error) {
        return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
      }
    },
    async createSignedUrl(objectPath: string, _expiresIn: number) {
      try {
        return {
          data: {
            signedUrl: publicObjectUrl(bucket, objectPath),
          },
          error: null,
        };
      } catch (error) {
        return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
      }
    },
  };
}

function createLocalStorage() {
  return {
    from(bucket: string) {
      return createLocalStorageBucket(bucket);
    },
  };
}

const dataClient = createClient(dataUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export const localStoragePublicRoot = storageRoot();

if (localDataMode) {
  (dataClient as unknown as { storage: ReturnType<typeof createLocalStorage> }).storage = createLocalStorage();
}

export const supabaseAdmin = dataClient;
