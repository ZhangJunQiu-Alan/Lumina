import { GoogleGenAI } from '@google/genai';
import {
  analyzeWordBatch,
  compareWordBatches,
  formatWordBatchMismatchMessage,
  normalizeWordKey,
  sanitizeWordInput,
} from '../shared/wordBatch.js';
import type {
  EnrichedMorphology,
  EnrichedMorphologyPart,
  EnrichedWordConfusion,
  EnrichedWordRelation,
  MorphologyPartKind,
} from '../src/types.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export class EnrichmentResponseValidationError extends Error {
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
    this.name = 'EnrichmentResponseValidationError';
  }
}

export interface GeminiWordResult {
  word: string;
  ipa_uk: string;
  ipa_us: string;
  primary_meaning_zh: string;
  ner_label: string | null;
  senses: {
    pos: string;
    meaning_zh: string;
    example_sentence: string;
    example_translation_zh: string;
  }[];
  morphology: EnrichedMorphology;
  derived_words: EnrichedWordRelation[];
  synonyms: EnrichedWordRelation[];
  antonyms: EnrichedWordRelation[];
  confusions: EnrichedWordConfusion[];
  confused_word: string | null;
  confused_diff_zh: string | null;
  memory_tip: string;
}

const MORPHOLOGY_PART_KINDS: MorphologyPartKind[] = ['prefix', 'root', 'suffix'];
const MAX_MORPHOLOGY_PARTS = 4;
const MAX_RELATED_WORDS = 4;
const MAX_CONFUSIONS = 3;

function asTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function clampText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(maxLength - 1, 0)).trim()}…`;
}

function isMorphologyPartKind(value: unknown): value is MorphologyPartKind {
  return MORPHOLOGY_PART_KINDS.includes(value as MorphologyPartKind);
}

function normalizeMorphologyParts(parts: unknown): EnrichedMorphologyPart[] {
  if (!Array.isArray(parts)) return [];

  const seen = new Set<string>();
  const normalizedParts: EnrichedMorphologyPart[] = [];

  for (const part of parts) {
    if (normalizedParts.length >= MAX_MORPHOLOGY_PARTS || !part || typeof part !== 'object') {
      continue;
    }

    const record = part as Record<string, unknown>;
    const text = asTrimmedString(record.text);
    const kind = isMorphologyPartKind(record.kind) ? record.kind : 'root';

    if (!text) continue;

    const dedupeKey = `${kind}:${text.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    normalizedParts.push({
      text,
      kind,
      meaning_zh: clampText(asTrimmedString(record.meaning_zh), 40),
      note_zh: clampText(asTrimmedString(record.note_zh), 80),
    });
  }

  return normalizedParts;
}

function normalizeMorphology(rawMorphology: unknown): EnrichedMorphology {
  if (!rawMorphology || typeof rawMorphology !== 'object') {
    return {
      summary_zh: '暂未提供清晰的词根词缀拆解，可先结合词义与例句记忆。',
      parts: [],
    };
  }

  const record = rawMorphology as Record<string, unknown>;
  const summary = clampText(asTrimmedString(record.summary_zh), 120);

  return {
    summary_zh: summary || '暂未提供清晰的词根词缀拆解，可先结合词义与例句记忆。',
    parts: normalizeMorphologyParts(record.parts),
  };
}

function normalizeWordRelations(
  items: unknown,
  currentWord: string,
  limit = MAX_RELATED_WORDS,
): EnrichedWordRelation[] {
  if (!Array.isArray(items)) return [];

  const seen = new Set<string>();
  const currentWordKey = normalizeWordKey(currentWord);
  const normalizedItems: EnrichedWordRelation[] = [];

  for (const item of items) {
    if (normalizedItems.length >= limit || !item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const word = sanitizeWordInput(asTrimmedString(record.word));
    const normalizedWord = normalizeWordKey(word);

    if (!word || normalizedWord === currentWordKey || seen.has(normalizedWord)) {
      continue;
    }

    seen.add(normalizedWord);
    normalizedItems.push({
      word,
      meaning_zh: clampText(asTrimmedString(record.meaning_zh), 40),
      note_zh: clampText(asTrimmedString(record.note_zh), 80),
    });
  }

  return normalizedItems;
}

function normalizeConfusions(items: unknown, currentWord: string): EnrichedWordConfusion[] {
  if (!Array.isArray(items)) return [];

  const seen = new Set<string>();
  const currentWordKey = normalizeWordKey(currentWord);
  const normalizedItems: EnrichedWordConfusion[] = [];

  for (const item of items) {
    if (normalizedItems.length >= MAX_CONFUSIONS || !item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const word = sanitizeWordInput(asTrimmedString(record.word));
    const normalizedWord = normalizeWordKey(word);

    if (!word || normalizedWord === currentWordKey || seen.has(normalizedWord)) {
      continue;
    }

    const difference = clampText(asTrimmedString(record.difference_zh), 120);
    if (!difference) continue;

    seen.add(normalizedWord);
    normalizedItems.push({
      word,
      difference_zh: difference,
    });
  }

  return normalizedItems;
}

export function normalizeGeminiWordResult(
  entry: GeminiWordResult | Record<string, unknown>,
  wordOverride?: string,
): GeminiWordResult {
  const record = entry as Record<string, unknown>;
  const word = sanitizeWordInput(wordOverride ?? asTrimmedString(record.word));
  const confusions = normalizeConfusions(record.confusions, word);

  return {
    word,
    ipa_uk: asTrimmedString(record.ipa_uk),
    ipa_us: asTrimmedString(record.ipa_us),
    primary_meaning_zh: asTrimmedString(record.primary_meaning_zh),
    ner_label: asTrimmedString(record.ner_label) || null,
    senses: Array.isArray(record.senses) ? record.senses as GeminiWordResult['senses'] : [],
    morphology: normalizeMorphology(record.morphology),
    derived_words: normalizeWordRelations(record.derived_words, word),
    synonyms: normalizeWordRelations(record.synonyms, word),
    antonyms: normalizeWordRelations(record.antonyms, word),
    confusions,
    confused_word: confusions[0]?.word ?? null,
    confused_diff_zh: confusions[0]?.difference_zh ?? null,
    memory_tip: asTrimmedString(record.memory_tip),
  };
}

const SYSTEM_PROMPT = `You are an IELTS vocabulary expert. For each English word provided, generate structured learning data for Chinese learners.

Return ONLY a valid JSON array — no markdown fences, no explanation, no extra text.

Each element must follow this exact schema:
{
  "word": "the word exactly as given",
  "ipa_uk": "British IPA using forward slashes e.g. /ˈæl.ə.keɪt/",
  "ipa_us": "American IPA using forward slashes e.g. /ˈæl.ə.keɪt/",
  "primary_meaning_zh": "primary Chinese definition, concise",
  "ner_label": null,
  "senses": [
    {
      "pos": "v",
      "meaning_zh": "Chinese meaning for this POS",
      "example_sentence": "Natural English example sentence using the word.",
      "example_translation_zh": "Chinese translation of the example"
    }
  ],
  "morphology": {
    "summary_zh": "Chinese summary of the root/prefix/suffix memory strategy",
    "parts": [
      {
        "text": "gran",
        "kind": "root",
        "meaning_zh": "颗粒；谷粒",
        "note_zh": "提示这个词和颗粒、岩石质地相关"
      }
    ]
  },
  "derived_words": [
    {
      "word": "granular",
      "meaning_zh": "颗粒状的",
      "note_zh": "和原词同根，常见学术表达"
    }
  ],
  "synonyms": [
    {
      "word": "stone",
      "meaning_zh": "石头",
      "note_zh": "语义接近，但更泛"
    }
  ],
  "antonyms": [
    {
      "word": "soil",
      "meaning_zh": "土壤",
      "note_zh": "在材质语境里可作对照"
    }
  ],
  "confusions": [
    {
      "word": "graphite",
      "difference_zh": "graphite 是石墨，常用于铅笔芯；granite 是花岗岩，属于坚硬岩石。"
    }
  ],
  "memory_tip": "A creative Chinese mnemonic or memory hook for this word"
}

Rules:
- ner_label: only set for proper nouns (e.g. "LOCATION", "ORGANIZATION"). For all common words set null.
- senses: include all major POS forms (n/v/adj/adv). At minimum 1 sense.
- memory_tip: must be in Chinese, creative and memorable, ideally using etymology, imagery, or sound association.
- morphology.summary_zh: always provide a concise Chinese summary, even if parts is empty.
- morphology.parts: 0 to 4 items. kind must be prefix, root, or suffix.
- derived_words / synonyms / antonyms: 0 to 4 items each. Exclude the original word itself.
- confusions: 0 to 3 items. Each must explain the Chinese difference clearly.
- All Chinese text must be Simplified Chinese.`;

const ARTICLE_PROMPT = `You are an IELTS reading passage expert. Write a short IELTS-style academic reading passage (250–350 words) that naturally incorporates every vocabulary word provided.

Rules:
- Every word from the list must appear at least once, used correctly in context.
- The passage must be coherent, academic in tone, and read like an authentic IELTS passage.
- Return ONLY the passage text — no title, no headings, no markdown, no explanation.`;

export async function generateArticle(words: string[]): Promise<string> {
  const prompt = `${ARTICLE_PROMPT}\n\nVocabulary words to incorporate: ${words.join(', ')}`;

  const result = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
  });

  return result.text?.trim() ?? '';
}

export async function enrichWords(words: string[]): Promise<GeminiWordResult[]> {
  const cleanedWords = words.map(sanitizeWordInput);
  const prompt = `${SYSTEM_PROMPT}\n\nWords to process: ${cleanedWords.join(', ')}`;

  const result = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  const raw = result.text?.trim() ?? '';

  // Strip markdown fences as a fallback
  const jsonText = raw.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();

  let parsed: GeminiWordResult[];
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Gemini returned invalid JSON:\n${jsonText.slice(0, 300)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Gemini response is not an array');
  }

  const responseWords = parsed.map((entry) => sanitizeWordInput(typeof entry.word === 'string' ? entry.word : ''));
  const responseBatch = analyzeWordBatch(responseWords);

  if (responseBatch.duplicateWords.length > 0) {
    throw new EnrichmentResponseValidationError(
      `整理结果无效：模型返回了重复词：${responseBatch.duplicateWords.join('、')}。系统按忽略大小写和多余空格判重，请重试。`,
    );
  }

  const mismatch = compareWordBatches(cleanedWords, responseWords);
  if (mismatch.missingWords.length > 0 || mismatch.unexpectedWords.length > 0) {
    throw new EnrichmentResponseValidationError(formatWordBatchMismatchMessage(mismatch));
  }

  return parsed.map((entry, index) => normalizeGeminiWordResult(entry, responseWords[index]));
}
