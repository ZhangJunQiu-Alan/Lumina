import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const privateRawFixtureDir = 'content/ielts-reading/raw';

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

type ImportReport = {
  summary: {
    testCount: number;
    sectionCount: number;
    questionCount: number;
    answerCount: number;
    audioCount: number;
    paperPageCount: number;
    hotspotCount: number;
    fallbackHotspotCount: number;
  };
  errors: string[];
};

if (!(await fileExists(privateRawFixtureDir))) {
  console.log(`Skipping IELTS listening import tests: missing private fixtures at ${privateRawFixtureDir}`);
  process.exit(0);
}

async function assertListeningImport(bookNumber: number, maxFallbackHotspots: number) {
  const args = ['--import', 'tsx', 'scripts/import-ielts-listening.ts', '--book', String(bookNumber), '--dry-run'];
  if (await fileExists('.env')) {
    args.splice(2, 0, '--env-file=.env');
  }

  await execFileAsync('node', args, {
    env: {
      ...process.env,
      SUPABASE_URL: process.env.SUPABASE_URL ?? 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key',
    },
    maxBuffer: 20 * 1024 * 1024,
  });

  const report = JSON.parse(
    await readFile(`output/ielts-listening/cambridge-${bookNumber}-listening.report.json`, 'utf8'),
  ) as ImportReport;

  assert.equal(report.summary.testCount, 4);
  assert.equal(report.summary.sectionCount, 16);
  assert.equal(report.summary.questionCount, 160);
  assert.equal(report.summary.answerCount, 160);
  assert.equal(report.summary.audioCount, 16);
  assert.ok(report.summary.paperPageCount >= 16);
  assert.equal(report.summary.hotspotCount, 160);
  assert.ok(report.summary.fallbackHotspotCount <= maxFallbackHotspots);
  assert.deepEqual(report.errors, []);
}

await assertListeningImport(4, 39);
await assertListeningImport(5, 40);
await assertListeningImport(6, 12);
await assertListeningImport(7, 2);
await assertListeningImport(8, 25);
await assertListeningImport(9, 0);
await assertListeningImport(10, 6);

console.log('IELTS listening import tests passed.');
