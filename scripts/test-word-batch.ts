import assert from 'node:assert/strict';
import { analyzeWordBatch, collapseCanonicalWordBatch } from '../shared/wordBatch.js';

{
  const batch = analyzeWordBatch(['Neglect', 'neglect']);
  assert.deepEqual(batch.duplicateWords, ['Neglect']);
}

{
  const batch = analyzeWordBatch(['rule out', 'rule   out']);
  assert.deepEqual(batch.words, ['rule out', 'rule out']);
  assert.deepEqual(batch.duplicateWords, ['rule out']);
}

{
  const batch = analyzeWordBatch(['initially', 'proactive', 'stakeholder']);
  assert.deepEqual(batch.duplicateWords, []);
}

{
  const words = Array.from({ length: 30 }, (_, index) => `word ${index + 1}`);
  words.push('word 1');
  const batch = analyzeWordBatch(words, { limit: 30 });
  assert.equal(batch.words.length, 30);
  assert.deepEqual(batch.duplicateWords, []);
}

{
  const batch = collapseCanonicalWordBatch([
    { word: 'Dogs', canonicalWord: 'dog' },
    { word: 'dog', canonicalWord: 'dog' },
    { word: 'children', canonicalWord: 'child' },
    { word: '  better  ', canonicalWord: 'good' },
  ]);

  assert.deepEqual(batch.words, ['dog', 'child', 'good']);
  assert.deepEqual(batch.changedWords, [
    { word: 'Dogs', canonicalWord: 'dog' },
    { word: 'children', canonicalWord: 'child' },
    { word: 'better', canonicalWord: 'good' },
  ]);
  assert.deepEqual(batch.collapsedWords, ['dog']);
}

console.log('word batch validation checks passed');
