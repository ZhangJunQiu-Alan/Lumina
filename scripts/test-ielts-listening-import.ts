import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

await execFileAsync('node', [
  '--import',
  'tsx',
  '--env-file=.env',
  'scripts/import-ielts-listening.ts',
  '--book',
  '4',
  '--dry-run',
], {
  maxBuffer: 20 * 1024 * 1024,
});

const report = JSON.parse(await readFile('output/ielts-listening/cambridge-4-listening.report.json', 'utf8')) as {
  summary: {
    testCount: number;
    sectionCount: number;
    questionCount: number;
    answerCount: number;
    audioCount: number;
  };
  errors: string[];
};

assert.equal(report.summary.testCount, 4);
assert.equal(report.summary.sectionCount, 16);
assert.equal(report.summary.questionCount, 160);
assert.equal(report.summary.answerCount, 160);
assert.equal(report.summary.audioCount, 16);
assert.deepEqual(report.errors, []);

console.log('IELTS listening import tests passed.');
