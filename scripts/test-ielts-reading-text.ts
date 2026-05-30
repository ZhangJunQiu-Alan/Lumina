import assert from 'node:assert/strict';
import { normalizeIeltsPassageBody, splitIeltsPassageParagraphs } from '../src/lib/ieltsReadingText.ts';

const wrapped = [
  'children will have formed ideas about rainforests- what',
  'and where they are, why they are important, what endan-',
  'gers them- independent of any formal tuition. It is also',
  'possible that some of these ideas will be mistaken.',
  "Many studies have shown that children harbour misconceptions about 'pure', cur-",
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

const cambridge4Spacing = [
  'about the duration ofa normal classroom period. In the face oft he frequent',
  'coverage, what endan gers them-independent of any formal tuition.',
  "Many studies have shown misconceptions about 'pure', cur riculum science.",
  'These misconceptions become incorpo rated into a multifaceted framework.',
  'The ~econd question concerned the geographical location ofr ain forests.',
  'About r8% oft he pupils referred specifically to logging activity.',
  'One misconception, expressed by some ro% of the pupils, was about acid rain.',
].join('\n\n');

const cambridge4Normalized = normalizeIeltsPassageBody(cambridge4Spacing);
assert.match(cambridge4Normalized, /duration of a normal classroom period/);
assert.match(cambridge4Normalized, /face of the frequent/);
assert.match(cambridge4Normalized, /what endangers them- independent/);
assert.match(cambridge4Normalized, /'pure', curriculum science/);
assert.match(cambridge4Normalized, /become incorporated into/);
assert.match(cambridge4Normalized, /The second question concerned/);
assert.match(cambridge4Normalized, /About 18% of the pupils/);
assert.match(cambridge4Normalized, /some 10% of the pupils/);

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

const singleBreakWrapped = [
  'Researchers often begin with broad claims about',
  'classroom behaviour and then test them with',
  'careful interviews over several school terms.',
  'The first results are useful because they show',
  'which ideas pupils can explain without help.',
  'Later studies ask a different group of pupils',
  'to compare two explanations and describe why',
  'one answer seems more convincing after discussion.',
].join('\n');

const singleBreakParagraphs = splitIeltsPassageParagraphs(singleBreakWrapped);
assert.equal(singleBreakParagraphs.length, 2);
assert.match(singleBreakParagraphs[0], /without help\.$/);
assert.match(singleBreakParagraphs[1], /^Later studies/);

const fullWidthSingleBreak = [
  'Archaeology is partly fieldwork and partly careful interpretation of cultural material.',
  'It asks researchers to connect small discoveries with a wider account of human history.',
  'The work also requires conservation because sites may be damaged by careless handling.',
  'Evidence can be lost quickly.',
  'Anthropology is concerned with humanity in both physical and cultural terms.',
  'Researchers therefore compare living communities, inherited customs and material remains.',
  'Those comparisons help explain why different societies solve similar problems differently.',
].join('\n');

const fullWidthParagraphs = splitIeltsPassageParagraphs(fullWidthSingleBreak);
assert.equal(fullWidthParagraphs.length, 2);
assert.match(fullWidthParagraphs[0], /lost quickly\.$/);
assert.match(fullWidthParagraphs[1], /^Anthropology/);

const headedSingleBreak = [
  'Background',
  'Typically, children do not end up on the streets because of one cause.',
  'A combination of schools, family breakdown and income pressure is usually involved.',
  'Conclusion',
  'Small loans can help when they are connected to training and local support.',
].join('\n');

assert.deepEqual(
  splitIeltsPassageParagraphs(headedSingleBreak).map((paragraph) => paragraph.slice(0, 20).trim()),
  ['Background', 'Typically, children', 'Conclusion', 'Small loans can help'],
);

console.log('IELTS reading text normalization tests passed.');
