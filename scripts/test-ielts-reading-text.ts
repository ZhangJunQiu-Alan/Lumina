import assert from 'node:assert/strict';
import {
  normalizeIeltsPassageBody,
  splitIeltsPassageParagraphs,
} from '../src/lib/ieltsReadingText.ts';

const wrapped = [
  'children will have formed ideas about rainforests- what',
  'and where they are, why they are important, what endan-',
  'gers them- independent of any formal tuition. It is also',
  'possible that some of these ideas will be mistaken.',
  'Many studies have shown that children harbour misconceptions about \'pure\', cur-',
  'riculum science. These misconceptions do not remain isolated but become incorpo-',
  'rated into a multifaceted, but organised, conceptual framework, making it and the',
  'component ideas, some of which are erroneous, more robust but also accessible to',
  'modification.',
].join('\n\n');

const normalized = normalizeIeltsPassageBody(wrapped);
assert.equal(normalized.includes('endan-\n'), false);
assert.equal(normalized.includes('cur-\n'), false);
assert.equal(normalized.includes('incorpo-\n'), false);
assert.match(normalized, /what endangers them- independent/);
assert.match(normalized, /'pure', curriculum science/);
assert.match(normalized, /become incorporated into/);
assert.equal(normalizeIeltsPassageBody(normalized), normalized);

const paragraphs = splitIeltsPassageParagraphs(wrapped);
assert.ok(paragraphs.length < 5);
assert.ok(paragraphs.every((paragraph) => paragraph.length > 80));

const labelled = [
  'A Volcanoes are the ultimate earth-moving machinery. A violent eruption can blow',
  'the top few kilometres off a mountain, scatter fine ash practically all over the globe.',
  'B Geologists consider the earth as having a molten core, surrounded by a semi-molten',
  'mantle and a brittle, outer skin.',
].join('\n\n');

assert.match(normalizeIeltsPassageBody(labelled), /\n\nB Geologists/);

console.log('IELTS reading text normalization tests passed.');
