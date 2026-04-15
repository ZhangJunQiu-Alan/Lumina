import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from './supabase.js';

export interface AuthenticatedRequest extends Request {
  authUserId?: string;
}

function readBearerToken(headerValue: string | undefined) {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const accessToken = readBearerToken(req.header('Authorization'));

  if (!accessToken) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.authUserId = data.user.id;
  next();
}
