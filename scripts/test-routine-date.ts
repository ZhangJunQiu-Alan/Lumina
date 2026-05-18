import assert from 'node:assert/strict';
import { toRoutineDateKey, routineDateKeyFromIso } from '../src/lib/routineDate.js';

function run() {
  assert.equal(
    toRoutineDateKey(new Date('2026-05-17T20:59:59.000Z'), 'Asia/Shanghai'),
    '2026-05-17',
  );
  assert.equal(
    toRoutineDateKey(new Date('2026-05-17T21:00:00.000Z'), 'Asia/Shanghai'),
    '2026-05-18',
  );
  assert.equal(
    routineDateKeyFromIso('2026-05-18T08:59:59.000Z', 'America/New_York'),
    '2026-05-17',
  );
  assert.equal(
    routineDateKeyFromIso('2026-05-18T09:00:00.000Z', 'America/New_York'),
    '2026-05-18',
  );

  console.log('Routine date checks passed.');
}

run();
