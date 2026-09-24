import 'dotenv/config';
import './env.js';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from '../shared/api/app.ts';
import { localStoragePublicRoot } from '../shared/server/supabase.ts';
import { logger } from '../shared/server/logger.ts';

// Serve local storage objects in local development mode
const storageRelPath = path.relative(process.cwd(), localStoragePublicRoot) || '.';
app.use(
  '/storage/v1/object/public/*',
  serveStatic({
    root: storageRelPath,
    rewriteRequestPath: (p) => p.replace(/^\/storage\/v1\/object\/public/, ''),
  }),
);

const PORT = Number(process.env.PORT) || 4000;
serve({ fetch: app.fetch, port: PORT }, () => {
  logger.info(`Server running on port ${PORT}`);
});
