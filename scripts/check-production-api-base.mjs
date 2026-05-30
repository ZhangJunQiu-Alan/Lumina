import fs from 'node:fs';
import path from 'node:path';

const distAssetsDir = path.resolve('dist/assets');

if (!fs.existsSync(distAssetsDir)) {
  console.error('dist/assets does not exist. Run npm run build before this check.');
  process.exit(1);
}

const jsFiles = fs
  .readdirSync(distAssetsDir)
  .filter((file) => file.endsWith('.js'))
  .map((file) => path.join(distAssetsDir, file));

if (jsFiles.length === 0) {
  console.error('No built JavaScript assets found in dist/assets.');
  process.exit(1);
}

const bundleText = jsFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

const requiredMarkers = ['/api/home/overview', '/functions/v1/api'];

const missingMarkers = requiredMarkers.filter((marker) => !bundleText.includes(marker));

if (missingMarkers.length > 0) {
  console.error(
    [
      'Production API gateway check failed.',
      `Missing bundle markers: ${missingMarkers.join(', ')}`,
      'The production frontend must route /api requests through the Supabase Edge Function gateway.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log('Production API gateway check passed.');
