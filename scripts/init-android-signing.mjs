import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const settings = path.join(root, 'mobile/signing.local.properties');
const folder = path.join(os.homedir(), '.config/lumina-signing');
const keyStore = path.join(folder, 'lumina-mobile-release.jks');
if (fs.existsSync(settings) || fs.existsSync(keyStore))
  throw new Error('Signing identity already exists. Refusing to replace it.');
fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
const password = randomBytes(36).toString('base64url');
const keytool = path.join(
  process.env.LUMINA_ANDROID_JAVA_HOME || '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  'bin/keytool',
);
const result = spawnSync(
  keytool,
  [
    '-genkeypair',
    '-keystore',
    keyStore,
    '-storetype',
    'JKS',
    '-alias',
    'lumina-mobile',
    '-keyalg',
    'RSA',
    '-keysize',
    '3072',
    '-validity',
    '10000',
    '-dname',
    'CN=Lumina Mobile',
    '-storepass:env',
    'LUMINA_SIGNING_PASSWORD',
    '-keypass:env',
    'LUMINA_SIGNING_PASSWORD',
  ],
  { stdio: 'pipe', env: { ...process.env, LUMINA_SIGNING_PASSWORD: password } },
);
if (result.error || result.status !== 0) throw new Error('Key generation failed; inspect the local Java installation');
fs.chmodSync(keyStore, 0o600);
fs.writeFileSync(
  settings,
  `storeFile=${keyStore}\nstorePassword=${password}\nkeyAlias=lumina-mobile\nkeyPassword=${password}\n`,
  { mode: 0o600, flag: 'wx' },
);
console.log(
  'Signing key created. Back up ~/.config/lumina-signing and mobile/signing.local.properties securely. Do not share them with APK recipients.',
);
