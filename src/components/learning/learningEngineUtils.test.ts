import { describe, expect, it } from 'vitest';
import type { Word } from '../../types';
import {
  getRelationDetailText,
  getRound1ExampleItems,
  getRound1WordItems,
  hasDisplayText,
  hasRound1ContextContent,
  hasRound1MorphologyContent,
  hasRound1RelationsContent,
  hasRound1WordItems,
  isTextEditingTarget,
  stripDiacritics,
  trimDisplayText,
  VOCABULARY_ISSUE_OPTIONS,
} from './learningEngineUtils';

function makeWord(overrides: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    word: 'allocate',
    phonetic: '/ˈæləkeɪt/',
    pos_tags: ['v'],
    ner_entities: [],
    chinese_definition: '分配',
    senses: [],
    example_sentences: [],
    morphology: { summaryZh: '', parts: [] },
    derivedWords: [],
    synonyms: [],
    antonyms: [],
    confusingPairs: [],
    ...overrides,
  } as Word;
}

describe('trimDisplayText / hasDisplayText', () => {
  it('trims and treats null/whitespace as empty', () => {
    expect(trimDisplayText('  hi  ')).toBe('hi');
    expect(trimDisplayText(null)).toBe('');
    expect(trimDisplayText(undefined)).toBe('');
    expect(hasDisplayText('  ')).toBe(false);
    expect(hasDisplayText(' x')).toBe(true);
    expect(hasDisplayText(null)).toBe(false);
  });
});

describe('getRound1WordItems / hasRound1WordItems', () => {
  it('filters blank-word items and applies the optional limit', () => {
    const items = [{ word: 'a' }, { word: '   ' }, { word: 'b' }, { word: 'c' }];
    expect(getRound1WordItems(items).map((i) => i.word)).toEqual(['a', 'b', 'c']);
    expect(getRound1WordItems(items, 2).map((i) => i.word)).toEqual(['a', 'b']);
    expect(hasRound1WordItems(items)).toBe(true);
    expect(hasRound1WordItems([{ word: '' }, { word: '  ' }])).toBe(false);
  });
});

describe('getRelationDetailText', () => {
  it('joins meaning and note with a middle dot, dropping empties', () => {
    expect(getRelationDetailText({ meaningZh: '分配', noteZh: '正式' })).toBe('分配 · 正式');
    expect(getRelationDetailText({ meaningZh: '分配' })).toBe('分配');
    expect(getRelationDetailText({ noteZh: '  ' })).toBe('');
  });
});

describe('getRound1ExampleItems', () => {
  it('keeps at most two senses with examples and maps translation when present', () => {
    const word = makeWord({
      senses: [
        { pos: 'v', meaning_zh: '', example_sentence: 'one', example_translation_zh: '一' },
        { pos: 'v', meaning_zh: '', example_sentence: '  ', example_translation_zh: '' },
        { pos: 'v', meaning_zh: '', example_sentence: 'two', example_translation_zh: '' },
        { pos: 'v', meaning_zh: '', example_sentence: 'three', example_translation_zh: '' },
      ],
    });
    const items = getRound1ExampleItems(word);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ sentence: 'one', translation: '一' });
    expect(items[1]).toMatchObject({ sentence: 'two', translation: undefined });
    expect(items[0].key).toContain(word.id);
  });
});

describe('Round1 content predicates', () => {
  it('detects morphology, relations, and context content', () => {
    expect(hasRound1MorphologyContent(makeWord())).toBe(false);
    expect(hasRound1MorphologyContent(makeWord({ morphology: { summaryZh: 'x', parts: [] } }))).toBe(true);
    expect(
      hasRound1MorphologyContent(makeWord({ derivedWords: [{ word: 'allocation', meaningZh: '', noteZh: '' }] })),
    ).toBe(true);

    expect(hasRound1RelationsContent(makeWord())).toBe(false);
    expect(hasRound1RelationsContent(makeWord({ synonyms: [{ word: 'assign', meaningZh: '', noteZh: '' }] }))).toBe(
      true,
    );
    expect(hasRound1RelationsContent(makeWord({ antonyms: [{ word: 'withhold', meaningZh: '', noteZh: '' }] }))).toBe(
      true,
    );

    expect(hasRound1ContextContent(makeWord())).toBe(false);
    expect(hasRound1ContextContent(makeWord({ confusingPairs: [{ word: 'allot', difference: 'x' }] }))).toBe(true);
    expect(
      hasRound1ContextContent(
        makeWord({ senses: [{ pos: 'v', meaning_zh: '', example_sentence: 'ex', example_translation_zh: '' }] }),
      ),
    ).toBe(true);
  });
});

describe('stripDiacritics', () => {
  it('removes combining marks', () => {
    expect(stripDiacritics('café')).toBe('cafe');
    expect(stripDiacritics('naïve résumé')).toBe('naive resume');
  });
});

describe('isTextEditingTarget', () => {
  it('returns true for inputs/textareas and a falsy value otherwise', () => {
    expect(isTextEditingTarget(document.createElement('input'))).toBe(true);
    expect(isTextEditingTarget(document.createElement('textarea'))).toBe(true);
    // Non-editable elements fall through to `isContentEditable` (undefined in jsdom) — falsy either way.
    expect(isTextEditingTarget(document.createElement('div'))).toBeFalsy();
    expect(isTextEditingTarget(null)).toBe(false);
  });
});

describe('VOCABULARY_ISSUE_OPTIONS', () => {
  it('covers the four reportable issue types', () => {
    expect(VOCABULARY_ISSUE_OPTIONS.map((o) => o.type)).toEqual(['definition', 'example', 'pronunciation', 'other']);
    expect(VOCABULARY_ISSUE_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
  });
});
