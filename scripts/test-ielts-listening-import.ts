import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

async function assertListeningImport(bookNumber: number, maxFallbackHotspots: number) {
  await execFileAsync('node', [
    '--import',
    'tsx',
    '--env-file=.env',
    'scripts/import-ielts-listening.ts',
    '--book',
    String(bookNumber),
    '--dry-run',
  ], {
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

console.log('IELTS listening import tests passed.');
