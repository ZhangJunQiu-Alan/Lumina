import assert from 'node:assert/strict';
import { tokenizeClickableText } from '../src/components/shared/ClickableText.tsx';
import { isStopWord } from '../src/lib/stopWords.ts';

const simpleTokens = tokenizeClickableText('The salt is on the table.');
assert.deepEqual(
  simpleTokens
    .filter((token) => token.kind === 'content')
    .map((token) => token.normalized),
  ['salt', 'table'],
);

for (const word of ['should', 'could', 'would', 'might']) {
  assert.equal(isStopWord(word), true);
}

const mixedTokens = tokenizeClickableText('盐 salt 在 table 上。');
assert.deepEqual(
  mixedTokens
    .filter((token) => token.kind === 'content')
    .map((token) => token.normalized),
  ['salt', 'table'],
);
assert.equal(mixedTokens.some((token) => token.kind === 'cjk' && token.text === '盐'), true);

console.log('clickable text tokenizer checks passed');
