import crypto from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { getEnv } from '../runtime.ts';

const scryptAsync = promisify(crypto.scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_HASH_PREFIX = 'scrypt';

let pool: pg.Pool | null = null;

export interface LocalAuthUser {
  id: string;
  email: string;
  full_name: string | null;
}

export interface LocalSession {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  expires_at: number;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    user_metadata: {
      full_name?: string;
    };
  };
}

interface JwtPayload {
  sub: string;
  email: string;
  role: 'authenticated' | 'service_role';
  aud: 'authenticated';
  exp: number;
  user_metadata?: {
    full_name?: string;
  };
}

function getPool() {
  if (!pool) {
    const connectionString = getEnv('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for local auth.');
    }
    pool = new pg.Pool({ connectionString });
  }
  return pool;
}

export function isLocalAuthEnabled() {
  return Boolean(getEnv('LUMINA_AUTH_JWT_SECRET') && getEnv('DATABASE_URL'));
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function assertPassword(password: string) {
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
}

async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const key = await scryptAsync(password, salt, 64);
  return `${PASSWORD_HASH_PREFIX}$${salt}$${key.toString('base64url')}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const [prefix, salt, encodedKey] = storedHash.split('$');
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !encodedKey) {
    return false;
  }

  const expected = Buffer.from(encodedKey, 'base64url');
  const actual = await scryptAsync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function base64urlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function jwtSecret() {
  const secret = getEnv('LUMINA_AUTH_JWT_SECRET');
  if (!secret) {
    throw new Error('LUMINA_AUTH_JWT_SECRET is required for local auth.');
  }
  return secret;
}

function signJwt(payload: JwtPayload) {
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = base64urlJson(payload);
  const data = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', jwtSecret()).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function decodeJwtPayload(token: string): JwtPayload {
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) {
    throw new Error('Invalid token.');
  }

  const data = `${header}.${body}`;
  const expected = crypto.createHmac('sha256', jwtSecret()).update(data).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('Invalid token.');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload;
  if (!payload.sub || payload.role !== 'authenticated' || payload.aud !== 'authenticated') {
    throw new Error('Invalid token.');
  }
  if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Expired token.');
  }
  return payload;
}

function toSession(user: LocalAuthUser): LocalSession {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TOKEN_TTL_SECONDS;
  const fullName = user.full_name?.trim() || undefined;
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    aud: 'authenticated',
    exp: expiresAt,
    user_metadata: fullName ? { full_name: fullName } : {},
  };

  return {
    access_token: signJwt(payload),
    token_type: 'bearer',
    expires_in: TOKEN_TTL_SECONDS,
    expires_at: expiresAt,
    refresh_token: '',
    user: {
      id: user.id,
      email: user.email,
      user_metadata: fullName ? { full_name: fullName } : {},
    },
  };
}

export async function createLocalUser(input: { email: string; password: string; fullName?: string }) {
  const email = normalizeEmail(input.email);
  if (!email) {
    throw new Error('Email is required.');
  }
  assertPassword(input.password);

  const passwordHash = await hashPassword(input.password);
  try {
    const { rows } = await getPool().query<LocalAuthUser>(
      `
        INSERT INTO app_users (email, password_hash, full_name)
        VALUES ($1, $2, $3)
        RETURNING id, email, full_name
      `,
      [email, passwordHash, input.fullName?.trim() || null],
    );
    return toSession(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error('Email is already registered.', { cause: error });
    }
    throw error;
  }
}

export async function authenticateLocalUser(emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  const { rows } = await getPool().query<LocalAuthUser & { password_hash: string }>(
    `
      SELECT id, email, full_name, password_hash
      FROM app_users
      WHERE lower(email) = lower($1)
      LIMIT 1
    `,
    [email],
  );

  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new Error('Invalid email or password.');
  }

  return toSession(user);
}

export async function updateLocalPassword(userId: string, password: string) {
  assertPassword(password);
  const passwordHash = await hashPassword(password);
  await getPool().query(
    `
      UPDATE app_users
      SET password_hash = $2, updated_at = now()
      WHERE id = $1
    `,
    [userId, passwordHash],
  );
}

export async function getLocalUserById(userId: string) {
  const { rows } = await getPool().query<LocalAuthUser>(
    `
      SELECT id, email, full_name
      FROM app_users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );
  return rows[0] ?? null;
}

export async function verifyLocalAccessToken(token: string) {
  const payload = decodeJwtPayload(token);
  const user = await getLocalUserById(payload.sub);
  if (!user) {
    throw new Error('User not found.');
  }
  return { payload, user, session: toSession(user) };
}

export function readBearerToken(headerValue: string | undefined) {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
