import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadEnv, build } from 'vite';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const mode = process.argv.includes('--debug') ? 'debug' : 'release';
const env = { ...process.env, ...loadEnv('mobile', root, 'VITE_') };
const api = env.VITE_API_BASE_URL;
if (!api || !api.startsWith('https://')) throw new Error('Set an HTTPS VITE_API_BASE_URL in .env.mobile.local');
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error('Missing public data configuration');
const javaHome = process.env.LUMINA_ANDROID_JAVA_HOME || '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const sdk = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
const android = path.join(root, 'mobile/android');
if (!fs.existsSync(path.join(javaHome, 'bin/java')) || !fs.existsSync(sdk)) {
  throw new Error('Install Android Studio and SDK, or set LUMINA_ANDROID_JAVA_HOME and ANDROID_HOME');
}
if (mode === 'release' && !fs.existsSync('mobile/signing.local.properties')) {
  throw new Error('Run npm run android:signing:init once; keep the resulting key backed up');
}
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...env, JAVA_HOME: javaHome, ANDROID_HOME: sdk },
  });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status})`);
};
run('npm', ['run', 'typecheck']);
await build({
  mode: 'mobile',
  define: { 'import.meta.env.VITE_NATIVE_APP': '"true"' },
  build: { outDir: 'dist-mobile', target: 'chrome111', sourcemap: false },
});
run('npx', ['cap', 'sync', 'android']);
fs.writeFileSync(path.join(android, 'local.properties'), `sdk.dir=${sdk}\n`, { mode: 0o600 });
run('./gradlew', [mode === 'release' ? 'assembleRelease' : 'assembleDebug', 'lint', '--console=plain'], android);
const { versionName } = JSON.parse(fs.readFileSync('mobile/release.json', 'utf8'));
const source = path.join(android, `app/build/outputs/apk/${mode}/app-${mode}.apk`);
fs.mkdirSync('mobile/releases', { recursive: true });
const target = `mobile/releases/Lumina-${versionName}-${mode}.apk`;
fs.copyFileSync(source, target);
const bytes = fs.readFileSync(target);
fs.writeFileSync(`${target}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  ${path.basename(target)}\n`);
const buildTools = fs
  .readdirSync(path.join(sdk, 'build-tools'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .at(-1);
run(path.join(sdk, 'build-tools', buildTools, 'apksigner'), ['verify', '--verbose', '--print-certs', target]);
console.log(`APK: ${path.resolve(target)} (${(bytes.length / 1024 / 1024).toFixed(1)} MiB)`);
