import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../shared/server/supabase.ts';
import { isLocalAuthEnabled, readBearerToken, verifyLocalAccessToken } from '../shared/server/localAuth.ts';

export interface AuthenticatedRequest extends Request {
  authUserId?: string;
  authUser?: {
    id: string;
    email: string;
    full_name: string | null;
  };
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const accessToken = readBearerToken(req.header('Authorization'));

  if (!accessToken) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  if (isLocalAuthEnabled()) {
    try {
      const { user } = await verifyLocalAccessToken(accessToken);
      req.authUserId = user.id;
      req.authUser = user;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
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
