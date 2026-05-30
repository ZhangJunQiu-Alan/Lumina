import {
  analyzeWordBatch,
  compareWordBatches,
  formatWordBatchMismatchMessage,
  normalizeWordKey,
  sanitizeWordInput,
} from '../wordBatch.ts';
import { getEnv } from '../runtime.ts';
import { logger } from './logger.ts';
import type {
  ArticleSentence,
  EnrichedMorphology,
  EnrichedMorphologyPart,
  EnrichedWordConfusion,
  EnrichedWordRelation,
  MorphologyPartKind,
} from '../types.ts';

const GEMINI_API_KEY = getEnv('GEMINI_API_KEY') ?? '';
function readPositiveIntEnv(name: string, fallback: number) {
  const raw = getEnv(name)?.trim();
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const ENRICH_MODEL = getEnv('GEMINI_ENRICH_MODEL')?.trim() || 'gemini-2.5-flash';
const ARTICLE_MODEL = getEnv('GEMINI_ARTICLE_MODEL')?.trim() || 'gemini-2.5-flash';
const DEFAULT_ENRICH_CHUNK_SIZE = readPositiveIntEnv('GEMINI_ENRICH_BATCH_SIZE', 10);
const DEFAULT_ENRICH_MAX_CONCURRENCY = readPositiveIntEnv('GEMINI_ENRICH_MAX_CONCURRENCY', 15);
const ENRICH_MAX_OUTPUT_TOKENS = readPositiveIntEnv('GEMINI_ENRICH_MAX_OUTPUT_TOKENS', 8192);
const MAX_ENRICH_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 2000;

interface GeminiGenerateOptions {
  model: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  thinkingBudget?: number;
}

async function generateGeminiJsonText(options: GeminiGenerateOptions) {
  if (!GEMINI_API_KEY) {
    throw new EnrichmentServiceUnavailableError('AI 服务缺少 GEMINI_API_KEY。');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: options.temperature,
          maxOutputTokens: options.maxOutputTokens,
        },
        ...(typeof options.thinkingBudget === 'number'
          ? { thinkingConfig: { thinkingBudget: options.thinkingBudget } }
          : {}),
      }),
    },
  );

  const payload = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string; status?: string; code?: number };
  };

  if (!response.ok) {
    const message = payload.error?.message ?? response.statusText;
    throw new Error(`Gemini API error: ${message}`);
  }

  return payload.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim() ?? '';
}

export interface GeminiCallOptions {
  source?: string;
  enrichmentType?: 'lite' | 'batch' | 'full' | 'forms_only';
}

function normalizeGeminiCallSource(source: string | undefined) {
  return source?.trim() || 'unknown';
}

function buildGeminiWordsPreview(words: string[]) {
  return words.slice(0, 5);
}

function logGeminiCallSuccess(input: {
  enrichmentType: 'lite' | 'batch' | 'full' | 'forms_only';
  source?: string;
  words: string[];
  durationMs: number;
  retryCount: number;
}) {
  logger.info('gemini_call', {
    enrichment_type: input.enrichmentType,
    source: normalizeGeminiCallSource(input.source),
    word_count: input.words.length,
    word: input.words.length === 1 ? input.words[0] : undefined,
    words_preview: input.words.length > 1 ? buildGeminiWordsPreview(input.words) : undefined,
    model: ENRICH_MODEL,
    success: true,
    duration_ms: input.durationMs,
    retry_count: input.retryCount,
  });
}

function logGeminiCallFailure(input: {
  enrichmentType: 'lite' | 'batch' | 'full' | 'forms_only';
  source?: string;
  words: string[];
  durationMs: number;
  retryCount: number;
  error: unknown;
}) {
  logger.error('gemini_call', input.error, {
    enrichment_type: input.enrichmentType,
    source: normalizeGeminiCallSource(input.source),
    word_count: input.words.length,
    word: input.words.length === 1 ? input.words[0] : undefined,
    words_preview: input.words.length > 1 ? buildGeminiWordsPreview(input.words) : undefined,
    model: ENRICH_MODEL,
    success: false,
    duration_ms: input.durationMs,
    retry_count: input.retryCount,
  });
}

export class EnrichmentResponseValidationError extends Error {
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
    this.name = 'EnrichmentResponseValidationError';
  }
}

export class EnrichmentServiceUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = 'EnrichmentServiceUnavailableError';
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
  forms: string[];
}

export interface LiteEnrichResult {
  word: string;
  primary_meaning_zh: string;
  senses: {
    pos: string;
    meaning_zh: string;
  }[];
  forms: string[];
}

interface LiteBatchEnrichResult extends LiteEnrichResult {
  input: string;
}

const MORPHOLOGY_PART_KINDS: MorphologyPartKind[] = ['prefix', 'root', 'suffix'];
const MAX_MORPHOLOGY_PARTS = 3;
const MAX_RELATED_WORDS = 3;
const MAX_CONFUSIONS = 2;
const MAX_SENSES = 3;
const MAX_LITE_SENSES = 4;
const MAX_LITE_FORMS = 8;
const LITE_ENRICH_MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_LITE_ENRICH_BATCH_SIZE = readPositiveIntEnv('GEMINI_LITE_ENRICH_BATCH_SIZE', 10);
const DEFAULT_LITE_ENRICH_MAX_CONCURRENCY = readPositiveIntEnv('GEMINI_LITE_ENRICH_MAX_CONCURRENCY', 3);
const LITE_ENRICH_BATCH_MAX_OUTPUT_TOKENS = readPositiveIntEnv('GEMINI_LITE_ENRICH_BATCH_MAX_OUTPUT_TOKENS', 4096);

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

function normalizeSenses(items: unknown): GeminiWordResult['senses'] {
  if (!Array.isArray(items)) return [];

  const seen = new Set<string>();
  const normalizedSenses: GeminiWordResult['senses'] = [];

  for (const item of items) {
    if (normalizedSenses.length >= MAX_SENSES || !item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const pos = clampText(asTrimmedString(record.pos), 20);
    const meaningZh = clampText(asTrimmedString(record.meaning_zh), 80);
    const exampleSentence = clampText(asTrimmedString(record.example_sentence), 220);
    const exampleTranslationZh = clampText(asTrimmedString(record.example_translation_zh), 120);

    if (!pos || !meaningZh || !exampleSentence || !exampleTranslationZh) {
      continue;
    }

    const dedupeKey = `${pos.toLowerCase()}::${meaningZh.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    normalizedSenses.push({
      pos,
      meaning_zh: meaningZh,
      example_sentence: exampleSentence,
      example_translation_zh: exampleTranslationZh,
    });
  }

  return normalizedSenses;
}

function normalizeLiteSenses(items: unknown): LiteEnrichResult['senses'] {
  if (!Array.isArray(items)) return [];

  const seen = new Set<string>();
  const normalizedSenses: LiteEnrichResult['senses'] = [];

  for (const item of items) {
    if (normalizedSenses.length >= MAX_LITE_SENSES || !item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const pos = clampText(asTrimmedString(record.pos), 20);
    const meaningZh = clampText(asTrimmedString(record.meaning_zh), 60);

    if (!pos || !meaningZh) continue;

    const dedupeKey = `${pos.toLowerCase()}::${meaningZh.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    normalizedSenses.push({
      pos,
      meaning_zh: meaningZh,
    });
  }

  return normalizedSenses;
}

function normalizeLiteForms(items: unknown, currentWord: string): string[] {
  if (!Array.isArray(items)) return [];

  const currentWordKey = normalizeWordKey(currentWord);
  const seen = new Set<string>();
  const normalizedForms: string[] = [];

  for (const item of items) {
    if (normalizedForms.length >= MAX_LITE_FORMS || typeof item !== 'string') {
      continue;
    }

    const form = normalizeWordKey(item);
    if (!form || form === currentWordKey || seen.has(form)) {
      continue;
    }

    seen.add(form);
    normalizedForms.push(form);
  }

  return normalizedForms;
}

function chunkWords(words: string[], chunkSize: number) {
  return Array.from(
    { length: Math.ceil(words.length / chunkSize) },
    (_, index) => words.slice(index * chunkSize, (index + 1) * chunkSize),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) return [];

  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRateLimitError(error: unknown) {
  const message = getErrorMessage(error);
  return message.includes('429') || message.includes('RESOURCE_EXHAUSTED');
}

function isRetriableEnrichmentError(error: unknown) {
  if (error instanceof EnrichmentResponseValidationError) {
    return true;
  }

  const message = getErrorMessage(error);
  return [
    'invalid JSON',
    'response is not an array',
    '整理结果无效',
    '轻量查词结果无效',
  ].some((marker) => message.includes(marker));
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
    senses: normalizeSenses(record.senses),
    morphology: normalizeMorphology(record.morphology),
    derived_words: normalizeWordRelations(record.derived_words, word),
    synonyms: normalizeWordRelations(record.synonyms, word),
    antonyms: normalizeWordRelations(record.antonyms, word),
    confusions,
    confused_word: confusions[0]?.word ?? null,
    confused_diff_zh: confusions[0]?.difference_zh ?? null,
    memory_tip: asTrimmedString(record.memory_tip),
    forms: normalizeLiteForms(record.forms, word),
  };
}

export function normalizeLiteEnrichResult(
  entry: LiteEnrichResult | Record<string, unknown>,
  wordOverride?: string,
): LiteEnrichResult {
  const record = entry as Record<string, unknown>;
  const fallbackWord = sanitizeWordInput(wordOverride ?? '');
  const word = sanitizeWordInput(asTrimmedString(record.word) || fallbackWord);
  const normalizedWord = normalizeWordKey(word);

  return {
    word: normalizedWord,
    primary_meaning_zh: clampText(asTrimmedString(record.primary_meaning_zh), 80),
    senses: normalizeLiteSenses(record.senses),
    forms: normalizeLiteForms(record.forms, normalizedWord),
  };
}

function normalizeLiteBatchEnrichResult(
  entry: LiteBatchEnrichResult | Record<string, unknown>,
  inputOverride?: string,
): LiteBatchEnrichResult {
  const record = entry as Record<string, unknown>;
  const input = sanitizeWordInput(asTrimmedString(record.input) || inputOverride || '');
  const normalized = normalizeLiteEnrichResult(record, input);

  return {
    input,
    ...normalized,
  };
}

function getMissingRequiredFields(entry: GeminiWordResult) {
  const missingFields: string[] = [];

  if (!entry.word) missingFields.push('word');
  if (!entry.ipa_uk) missingFields.push('ipa_uk');
  if (!entry.ipa_us) missingFields.push('ipa_us');
  if (!entry.primary_meaning_zh) missingFields.push('primary_meaning_zh');
  if (!entry.memory_tip) missingFields.push('memory_tip');
  if (!entry.morphology.summary_zh) missingFields.push('morphology.summary_zh');
  if (entry.senses.length === 0) missingFields.push('senses');

  return missingFields;
}

function getMissingLiteRequiredFields(entry: LiteEnrichResult) {
  const missingFields: string[] = [];

  if (!entry.word) missingFields.push('word');
  if (!entry.primary_meaning_zh) missingFields.push('primary_meaning_zh');
  if (entry.senses.length === 0) missingFields.push('senses');

  return missingFields;
}

const SYSTEM_PROMPT = `You are an IELTS vocabulary expert. For each English word provided, generate structured learning data for Chinese learners.

Return ONLY a valid JSON array — no markdown fences, no extra text. Keep descriptions CONCISE.

Schema per element:
{
  "word": "...",
  "ipa_uk": "...",
  "ipa_us": "...",
  "primary_meaning_zh": "...",
  "ner_label": null,
  "senses": [{"pos": "...", "meaning_zh": "...", "example_sentence": "...", "example_translation_zh": "..."}],
  "morphology": {"summary_zh": "...", "parts": [{"text": "...", "kind": "root/prefix/suffix", "meaning_zh": "...", "note_zh": "..."}]},
  "derived_words": [{"word": "...", "meaning_zh": "...", "note_zh": "..."}],
  "synonyms": [{"word": "...", "meaning_zh": "...", "note_zh": "..."}],
  "antonyms": [{"word": "...", "meaning_zh": "...", "note_zh": "..."}],
  "confusions": [{"word": "...", "difference_zh": "..."}],
  "memory_tip": "...",
  "forms": ["common variations of this word, e.g. plural, past tense, gerund, comparative/superlative"]
}

Rules:
- primary_meaning_zh: very concise.
- senses: max 3 major POS forms. Short examples.
- memory_tip: creative, memorable, but short.
- morphology: summary_zh under 80 chars. max 3 parts.
- derived_words/synonyms/antonyms: max 3 each.
- forms: LOWERCASE strings, only forms that LOOK DIFFERENT from the base word. Do NOT include the base word itself. Empty array if no variations. Max 8.
- All Chinese text must be Simplified Chinese.`;

const LITE_ENRICH_PROMPT = `You are an English-Chinese vocabulary helper. For ONE English word or word form, return concise structured data for Chinese learners.

Return ONLY a valid JSON object — no markdown fences, no extra text.

Schema:
{
  "word": "canonical dictionary headword/base form",
  "primary_meaning_zh": "very short 1-line summary",
  "senses": [
    { "pos": "n" | "v" | "adj" | "adv" | "phr" | "...", "meaning_zh": "concise meaning, semicolon-separated if multiple" }
  ],
  "forms": ["common variations of this word, e.g. plural, past tense, gerund"]
}

Rules:
- word: return the canonical dictionary headword/base form. For example, "decided" should return "decide".
- senses: max 4, ordered by frequency.
- meaning_zh: under 30 Simplified Chinese characters.
- forms: include only forms that look DIFFERENT from the base word (don't include the word itself). Empty array if no variations.
- All Chinese must be Simplified.`;

const LITE_BATCH_ENRICH_PROMPT = `You are an English-Chinese vocabulary helper. For EACH English word or word form provided, return concise structured data for Chinese learners.

Return ONLY a valid JSON array — no markdown fences, no extra text.

Schema per element:
{
  "input": "exact input word as provided",
  "word": "canonical dictionary headword/base form",
  "primary_meaning_zh": "very short 1-line summary",
  "senses": [
    { "pos": "n" | "v" | "adj" | "adv" | "phr" | "...", "meaning_zh": "concise meaning, semicolon-separated if multiple" }
  ],
  "forms": ["common variations of this word, e.g. plural, past tense, gerund"]
}

Rules:
- input: preserve the exact input word from the request list.
- word: return the canonical dictionary headword/base form. For example, "decided" should return "decide".
- Return exactly one object per input word.
- senses: max 4, ordered by frequency.
- meaning_zh: under 30 Simplified Chinese characters.
- forms: include only forms that look DIFFERENT from the base word (don't include the word itself). Empty array if no variations.
- All Chinese must be Simplified.`;

const ARTICLE_PROMPT = `You are an IELTS reading passage expert. Write a short IELTS-style academic reading passage (250–350 words) that naturally incorporates every vocabulary word provided, and provide a Simplified Chinese translation for each sentence.

Rules:
- Every word from the list must appear at least once, used correctly in context.
- The passage must be coherent, academic in tone, and read like an authentic IELTS passage.
- Split the passage into complete English sentences.
- Each Chinese translation must correspond to exactly one English sentence.
- All Chinese text must be Simplified Chinese.
- Return ONLY valid JSON — no markdown fences, no title, no headings, no explanation.

Schema:
{
  "sentences": [
    { "en": "English sentence.", "zh": "对应的中文翻译。" }
  ]
}`;

export interface GeneratedArticle {
  sentences: ArticleSentence[];
}

function normalizeGeneratedArticle(value: unknown): GeneratedArticle {
  const payload = value as { sentences?: unknown };
  const sentences = Array.isArray(payload?.sentences)
    ? payload.sentences
        .map((entry) => {
          const sentence = entry as Partial<ArticleSentence>;
          return {
            en: typeof sentence.en === 'string' ? sentence.en.trim() : '',
            zh: typeof sentence.zh === 'string' ? sentence.zh.trim() : '',
          };
        })
        .filter((sentence) => sentence.en && sentence.zh)
    : [];

  if (sentences.length === 0) {
    throw new EnrichmentResponseValidationError('文章生成结果无效：缺少英文句子和中文翻译。');
  }

  return { sentences };
}

export async function generateArticle(words: string[]): Promise<GeneratedArticle> {
  const prompt = `${ARTICLE_PROMPT}\n\nVocabulary words to incorporate: ${words.join(', ')}`;

  const raw = await generateGeminiJsonText({
    model: ARTICLE_MODEL,
    prompt,
    temperature: 0.35,
    maxOutputTokens: ENRICH_MAX_OUTPUT_TOKENS,
  });
  const jsonText = raw.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    throw new EnrichmentResponseValidationError('文章生成结果无效：模型没有返回合法 JSON。');
  }

  return normalizeGeneratedArticle(parsed);
}

async function enrichWordLiteOnce(word: string): Promise<LiteEnrichResult> {
  const cleanedWord = sanitizeWordInput(word);
  const prompt = `${LITE_ENRICH_PROMPT}\n\nWord to process: ${cleanedWord}`;

  const raw = await generateGeminiJsonText({
    model: ENRICH_MODEL,
    prompt,
    temperature: 0.2,
    maxOutputTokens: LITE_ENRICH_MAX_OUTPUT_TOKENS,
  });
  const jsonText = raw.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    logger.warn('[enrichWordLite] Gemini returned invalid JSON preview', {
      preview: jsonText.slice(0, 300),
    });
    throw new EnrichmentResponseValidationError('轻量查词结果无效：模型没有返回合法 JSON。');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new EnrichmentResponseValidationError('轻量查词结果无效：模型返回的数据结构不正确。');
  }

  const normalized = normalizeLiteEnrichResult(parsed as Record<string, unknown>, cleanedWord);
  const missingFields = getMissingLiteRequiredFields(normalized);
  if (missingFields.length > 0) {
    throw new EnrichmentResponseValidationError(
      `轻量查词结果无效：${normalized.word || cleanedWord || 'unknown'} 缺少必要字段：${missingFields.join(', ')}`,
    );
  }

  return normalized;
}

export async function enrichWordLite(
  word: string,
  options: GeminiCallOptions = {},
  retryCount = 0,
  startedAt = Date.now(),
): Promise<LiteEnrichResult> {
  const loggedWord = sanitizeWordInput(word);

  try {
    const result = await enrichWordLiteOnce(word);
    logGeminiCallSuccess({
      enrichmentType: 'lite',
      source: options.source,
      words: [loggedWord || word],
      durationMs: Date.now() - startedAt,
      retryCount,
    });
    return result;
  } catch (error) {
    const message = getErrorMessage(error);

    if (isRateLimitError(error)) {
      if (retryCount < MAX_ENRICH_RETRIES) {
        const delayMs = BASE_RETRY_DELAY_MS * (retryCount + 1);
        logger.warn('[enrichWordLite] rate-limited before retry', {
          word: loggedWord || word,
          delay_ms: delayMs,
          retry_count: retryCount + 1,
          max_retries: MAX_ENRICH_RETRIES,
        });
        await sleep(delayMs);
        return enrichWordLite(word, options, retryCount + 1, startedAt);
      }

      const unavailableError = new EnrichmentServiceUnavailableError('AI 轻量查词服务当前较忙，请过一两分钟再试。');
      logGeminiCallFailure({
        enrichmentType: 'lite',
        source: options.source,
        words: [loggedWord || word],
        durationMs: Date.now() - startedAt,
        retryCount,
        error: unavailableError,
      });
      throw new EnrichmentServiceUnavailableError('AI 轻量查词服务当前较忙，请过一两分钟再试。');
    }

    if (retryCount < MAX_ENRICH_RETRIES) {
      logger.warn('[enrichWordLite] retrying after error', {
        word: loggedWord || word,
        message,
        retry_count: retryCount + 1,
        max_retries: MAX_ENRICH_RETRIES,
      });
      return enrichWordLite(word, options, retryCount + 1, startedAt);
    }

    if (isRetriableEnrichmentError(error)) {
      const validationError = new EnrichmentResponseValidationError('轻量查词结果无效：模型多次返回不完整数据，请稍后重试。');
      logGeminiCallFailure({
        enrichmentType: 'lite',
        source: options.source,
        words: [loggedWord || word],
        durationMs: Date.now() - startedAt,
        retryCount,
        error: validationError,
      });
      throw validationError;
    }

    const unavailableError = new EnrichmentServiceUnavailableError('AI 轻量查词暂时不可用，请稍后重试。');
    logGeminiCallFailure({
      enrichmentType: 'lite',
      source: options.source,
      words: [loggedWord || word],
      durationMs: Date.now() - startedAt,
      retryCount,
      error: unavailableError,
    });
    throw unavailableError;
  }
}

async function enrichWordsLiteChunk(words: string[]): Promise<LiteEnrichResult[]> {
  const cleanedWords = words.map(sanitizeWordInput).filter(Boolean);
  const prompt = `${LITE_BATCH_ENRICH_PROMPT}\n\nWords to process: ${cleanedWords.join(', ')}`;

  const raw = await generateGeminiJsonText({
    model: ENRICH_MODEL,
    prompt,
    temperature: 0.2,
    maxOutputTokens: LITE_ENRICH_BATCH_MAX_OUTPUT_TOKENS,
  });
  const jsonText = raw.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    logger.warn('[enrichWordsLiteChunk] Gemini returned invalid JSON preview', {
      preview: jsonText.slice(0, 300),
    });
    throw new EnrichmentResponseValidationError('批量轻量查词结果无效：模型没有返回合法 JSON。');
  }

  if (!Array.isArray(parsed)) {
    throw new EnrichmentResponseValidationError('批量轻量查词结果无效：模型返回的数据结构不正确。');
  }

  const normalizedEntries = parsed.map((entry, index) => normalizeLiteBatchEnrichResult(
    entry as Record<string, unknown>,
    cleanedWords[index],
  ));
  const responseInputs = normalizedEntries.map((entry) => entry.input);
  const responseBatch = analyzeWordBatch(responseInputs);

  if (responseBatch.duplicateWords.length > 0) {
    throw new EnrichmentResponseValidationError(
      `批量轻量查词结果无效：模型返回了重复输入：${responseBatch.duplicateWords.join('、')}。`,
    );
  }

  const mismatch = compareWordBatches(cleanedWords, responseInputs);
  if (mismatch.missingWords.length > 0 || mismatch.unexpectedWords.length > 0) {
    throw new EnrichmentResponseValidationError(formatWordBatchMismatchMessage(mismatch));
  }

  const invalidEntry = normalizedEntries.find((entry) => getMissingLiteRequiredFields(entry).length > 0);
  if (invalidEntry) {
    throw new EnrichmentResponseValidationError(
      `批量轻量查词结果无效：${invalidEntry.word || invalidEntry.input || 'unknown'} 缺少必要字段：${getMissingLiteRequiredFields(invalidEntry).join(', ')}`,
    );
  }

  const entryByInputKey = new Map(
    normalizedEntries.map((entry) => [normalizeWordKey(entry.input), entry]),
  );

  return cleanedWords.map((word) => {
    const entry = entryByInputKey.get(normalizeWordKey(word));
    if (!entry) {
      throw new EnrichmentResponseValidationError(`批量轻量查词结果无效：缺少 ${word}。`);
    }
    return {
      word: entry.word,
      primary_meaning_zh: entry.primary_meaning_zh,
      senses: entry.senses,
      forms: entry.forms,
    };
  });
}

async function enrichWordsLiteResilient(
  words: string[],
  options: GeminiCallOptions = {},
  retryCount = 0,
  startedAt = Date.now(),
): Promise<LiteEnrichResult[]> {
  try {
    const results = await enrichWordsLiteChunk(words);
    logGeminiCallSuccess({
      enrichmentType: 'lite',
      source: options.source,
      words,
      durationMs: Date.now() - startedAt,
      retryCount,
    });
    return results;
  } catch (error) {
    const message = getErrorMessage(error);

    if (isRateLimitError(error)) {
      if (retryCount < MAX_ENRICH_RETRIES) {
        const delayMs = BASE_RETRY_DELAY_MS * (retryCount + 1);
        logger.warn('[enrichWordsLite] rate-limited before retry', {
          word_count: words.length,
          words_preview: buildGeminiWordsPreview(words),
          delay_ms: delayMs,
          retry_count: retryCount + 1,
          max_retries: MAX_ENRICH_RETRIES,
        });
        await sleep(delayMs);
        return enrichWordsLiteResilient(words, options, retryCount + 1, startedAt);
      }

      const unavailableError = new EnrichmentServiceUnavailableError('AI 批量轻量查词服务当前较忙，请过一两分钟再试。');
      logGeminiCallFailure({
        enrichmentType: 'lite',
        source: options.source,
        words,
        durationMs: Date.now() - startedAt,
        retryCount,
        error: unavailableError,
      });
      throw unavailableError;
    }

    if (retryCount < MAX_ENRICH_RETRIES) {
      logger.warn('[enrichWordsLite] retrying after error', {
        word_count: words.length,
        words_preview: buildGeminiWordsPreview(words),
        message,
        retry_count: retryCount + 1,
        max_retries: MAX_ENRICH_RETRIES,
      });
      return enrichWordsLiteResilient(words, options, retryCount + 1, startedAt);
    }

    if (isRetriableEnrichmentError(error) && words.length > 1) {
      const midpoint = Math.ceil(words.length / 2);
      logGeminiCallFailure({
        enrichmentType: 'lite',
        source: options.source,
        words,
        durationMs: Date.now() - startedAt,
        retryCount,
        error,
      });
      logger.warn('[enrichWordsLite] splitting batch after validation failure', {
        word_count: words.length,
        first_half_count: midpoint,
        second_half_count: words.length - midpoint,
        message,
      });
      const firstHalf = await enrichWordsLiteResilient(words.slice(0, midpoint), options);
      const secondHalf = await enrichWordsLiteResilient(words.slice(midpoint), options);
      return [...firstHalf, ...secondHalf];
    }

    if (isRetriableEnrichmentError(error)) {
      const validationError = new EnrichmentResponseValidationError('批量轻量查词结果无效：模型多次返回不完整数据，请稍后重试。');
      logGeminiCallFailure({
        enrichmentType: 'lite',
        source: options.source,
        words,
        durationMs: Date.now() - startedAt,
        retryCount,
        error: validationError,
      });
      throw validationError;
    }

    const unavailableError = new EnrichmentServiceUnavailableError('AI 批量轻量查词暂时不可用，请稍后重试。');
    logGeminiCallFailure({
      enrichmentType: 'lite',
      source: options.source,
      words,
      durationMs: Date.now() - startedAt,
      retryCount,
      error: unavailableError,
    });
    throw unavailableError;
  }
}

export async function enrichWordsLite(
  words: string[],
  options: GeminiCallOptions = {},
): Promise<LiteEnrichResult[]> {
  const cleanedWords = words.map(sanitizeWordInput).filter(Boolean);
  const chunks = chunkWords(cleanedWords, DEFAULT_LITE_ENRICH_BATCH_SIZE);
  const chunkResults = await mapWithConcurrency(
    chunks,
    DEFAULT_LITE_ENRICH_MAX_CONCURRENCY,
    (chunk, index) => {
      logger.info('[enrichWordsLite] chunk start', {
        chunk_index: index + 1,
        chunk_count: chunks.length,
        word_count: chunk.length,
        words_preview: buildGeminiWordsPreview(chunk),
        source: normalizeGeminiCallSource(options.source),
        enrichment_type: 'lite',
      });
      return enrichWordsLiteResilient(chunk, options);
    },
  );

  return chunkResults.flat();
}

async function enrichWordsChunk(words: string[]): Promise<GeminiWordResult[]> {
  const cleanedWords = words.map(sanitizeWordInput);
  const prompt = `${SYSTEM_PROMPT}\n\nWords to process: ${cleanedWords.join(', ')}`;

  const raw = await generateGeminiJsonText({
    model: ENRICH_MODEL,
    prompt,
    temperature: 0.2,
    maxOutputTokens: ENRICH_MAX_OUTPUT_TOKENS,
  });

  // Strip markdown fences as a fallback
  const jsonText = raw.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();

  let parsed: GeminiWordResult[];
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    logger.warn('[enrichWordsChunk] Gemini returned invalid JSON preview', {
      preview: jsonText.slice(0, 300),
    });
    throw new EnrichmentResponseValidationError('整理结果无效：模型返回了不完整的数据。');
  }

  if (!Array.isArray(parsed)) {
    throw new EnrichmentResponseValidationError('整理结果无效：模型返回的数据结构不正确。');
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

  const normalizedEntries = parsed.map((entry, index) => normalizeGeminiWordResult(entry, responseWords[index]));
  const invalidEntry = normalizedEntries.find((entry) => getMissingRequiredFields(entry).length > 0);

  if (invalidEntry) {
    throw new EnrichmentResponseValidationError(
      `整理结果无效：${invalidEntry.word || 'unknown'} 缺少必要字段：${getMissingRequiredFields(invalidEntry).join(', ')}`,
    );
  }

  return normalizedEntries;
}

async function enrichWordsResilient(
  words: string[],
  options: GeminiCallOptions = {},
  retryCount = 0,
  startedAt = Date.now(),
): Promise<GeminiWordResult[]> {
  const enrichmentType = options.enrichmentType ?? 'batch';

  try {
    const results = await enrichWordsChunk(words);
    logGeminiCallSuccess({
      enrichmentType,
      source: options.source,
      words,
      durationMs: Date.now() - startedAt,
      retryCount,
    });
    return results;
  } catch (error) {
    const message = getErrorMessage(error);

    if (isRateLimitError(error)) {
      if (retryCount < MAX_ENRICH_RETRIES) {
        const delayMs = BASE_RETRY_DELAY_MS * (retryCount + 1);
        logger.warn('[enrichWords] rate-limited before retry', {
          word_count: words.length,
          words_preview: buildGeminiWordsPreview(words),
          delay_ms: delayMs,
          retry_count: retryCount + 1,
          max_retries: MAX_ENRICH_RETRIES,
        });
        await sleep(delayMs);
        return enrichWordsResilient(words, options, retryCount + 1, startedAt);
      }

      const unavailableError = new EnrichmentServiceUnavailableError('AI 词条整理服务当前较忙，请过一两分钟再试。');
      logGeminiCallFailure({
        enrichmentType,
        source: options.source,
        words,
        durationMs: Date.now() - startedAt,
        retryCount,
        error: unavailableError,
      });
      throw unavailableError;
    }

    if (retryCount < MAX_ENRICH_RETRIES) {
      logger.warn('[enrichWords] retrying after error', {
        word_count: words.length,
        words_preview: buildGeminiWordsPreview(words),
        message,
        retry_count: retryCount + 1,
        max_retries: MAX_ENRICH_RETRIES,
      });
      return enrichWordsResilient(words, options, retryCount + 1, startedAt);
    }

    if (isRetriableEnrichmentError(error) && words.length > 1) {
      const midpoint = Math.ceil(words.length / 2);
      logGeminiCallFailure({
        enrichmentType,
        source: options.source,
        words,
        durationMs: Date.now() - startedAt,
        retryCount,
        error,
      });
      logger.warn('[enrichWords] splitting batch after validation failure', {
        word_count: words.length,
        first_half_count: midpoint,
        second_half_count: words.length - midpoint,
        message,
      });
      const firstHalf = await enrichWordsResilient(words.slice(0, midpoint), options);
      const secondHalf = await enrichWordsResilient(words.slice(midpoint), options);
      return [...firstHalf, ...secondHalf];
    }

    if (isRetriableEnrichmentError(error)) {
      const validationError = new EnrichmentResponseValidationError('整理结果无效：模型多次返回不完整数据，请稍后重试。');
      logGeminiCallFailure({
        enrichmentType,
        source: options.source,
        words,
        durationMs: Date.now() - startedAt,
        retryCount,
        error: validationError,
      });
      throw validationError;
    }

    const unavailableError = new EnrichmentServiceUnavailableError('AI 词条整理暂时不可用，请稍后重试。');
    logGeminiCallFailure({
      enrichmentType,
      source: options.source,
      words,
      durationMs: Date.now() - startedAt,
      retryCount,
      error: unavailableError,
    });
    throw unavailableError;
  }
}

export async function enrichWords(words: string[], options: GeminiCallOptions = {}): Promise<GeminiWordResult[]> {
  const cleanedWords = words.map(sanitizeWordInput).filter(Boolean);
  const chunks = chunkWords(cleanedWords, DEFAULT_ENRICH_CHUNK_SIZE);
  const chunkResults = await mapWithConcurrency(
    chunks,
    DEFAULT_ENRICH_MAX_CONCURRENCY,
    (chunk, index) => {
      logger.info('[enrichWords] chunk start', {
        chunk_index: index + 1,
        chunk_count: chunks.length,
        word_count: chunk.length,
        words_preview: buildGeminiWordsPreview(chunk),
        source: normalizeGeminiCallSource(options.source),
        enrichment_type: options.enrichmentType ?? 'batch',
      });
      return enrichWordsResilient(chunk, options);
    },
  );

  return chunkResults.flat();
}

// ============================================================
// Forms-only batched enrichment
// Used by:
//   1. backfill script (one-time, fills the form gap on existing 13k+ words)
//   2. anywhere we want to populate vocabulary_item_forms without re-running
//      a full LLM call.
// Designed for high throughput: bigger chunks, higher concurrency, smaller token budget.
// ============================================================

const FORMS_ONLY_CHUNK_SIZE = readPositiveIntEnv('GEMINI_FORMS_BATCH_SIZE', 30);
const FORMS_ONLY_MAX_CONCURRENCY = readPositiveIntEnv('GEMINI_FORMS_MAX_CONCURRENCY', 25);
const FORMS_ONLY_MAX_OUTPUT_TOKENS = readPositiveIntEnv('GEMINI_FORMS_MAX_OUTPUT_TOKENS', 2048);

const FORMS_ONLY_PROMPT = `For each English word provided, return its common inflected forms (plural, past tense, gerund, comparative/superlative) and close derivatives that share the same root and meaning (e.g., decide → decision, decisive).

Return ONLY a valid JSON array — no markdown fences, no extra text.

Schema:
[
  { "word": "<exact base word as provided>", "forms": ["form1", "form2", ...] }
]

Rules:
- "word": preserve casing exactly as provided in the input.
- "forms": LOWERCASE strings, only forms that LOOK DIFFERENT from the base word.
- "forms": do NOT include the base word itself.
- "forms": empty array if no variations exist.
- max 8 forms per word.
- include morphological variants (plural, tense, comparative) AND close derivatives sharing the same root.`;

export interface FormsOnlyResult {
  word: string;
  forms: string[];
}

async function enrichFormsOnlyChunk(words: string[]): Promise<FormsOnlyResult[]> {
  const cleanedWords = words.map(sanitizeWordInput);
  const prompt = `${FORMS_ONLY_PROMPT}\n\nWords: ${cleanedWords.join(', ')}`;

  const raw = await generateGeminiJsonText({
    model: ENRICH_MODEL,
    prompt,
    temperature: 0.2,
    maxOutputTokens: FORMS_ONLY_MAX_OUTPUT_TOKENS,
    thinkingBudget: 0,
  });
  const jsonText = raw.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new EnrichmentResponseValidationError('forms-only: malformed JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new EnrichmentResponseValidationError('forms-only: response not an array');
  }

  const results: FormsOnlyResult[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const word = sanitizeWordInput(asTrimmedString(record.word));
    if (!word) continue;
    const baseKey = normalizeWordKey(word);
    const rawForms = record.forms;
    const forms = Array.isArray(rawForms)
      ? Array.from(
          new Set(
            rawForms
              .map((f) => normalizeWordKey(asTrimmedString(f)))
              .filter((f) => f && f !== baseKey),
          ),
        ).slice(0, MAX_LITE_FORMS)
      : [];
    results.push({ word, forms });
  }
  return results;
}

async function enrichFormsOnlyResilient(
  words: string[],
  options: GeminiCallOptions = {},
  retryCount = 0,
  startedAt = Date.now(),
): Promise<FormsOnlyResult[]> {
  try {
    const results = await enrichFormsOnlyChunk(words);
    logGeminiCallSuccess({
      enrichmentType: 'forms_only',
      source: options.source,
      words,
      durationMs: Date.now() - startedAt,
      retryCount,
    });
    return results;
  } catch (error) {
    const message = getErrorMessage(error);

    if (isRateLimitError(error)) {
      if (retryCount < MAX_ENRICH_RETRIES) {
        const delayMs = BASE_RETRY_DELAY_MS * (retryCount + 1);
        logger.warn('[enrichFormsOnly] rate-limited before retry', {
          word_count: words.length,
          delay_ms: delayMs,
          retry_count: retryCount + 1,
        });
        await sleep(delayMs);
        return enrichFormsOnlyResilient(words, options, retryCount + 1, startedAt);
      }
      const err = new EnrichmentServiceUnavailableError('forms-only: rate-limited after retries');
      logGeminiCallFailure({
        enrichmentType: 'forms_only',
        source: options.source,
        words,
        durationMs: Date.now() - startedAt,
        retryCount,
        error: err,
      });
      throw err;
    }

    if (retryCount < MAX_ENRICH_RETRIES) {
      logger.warn('[enrichFormsOnly] retrying after error', {
        word_count: words.length,
        message,
        retry_count: retryCount + 1,
      });
      return enrichFormsOnlyResilient(words, options, retryCount + 1, startedAt);
    }

    logGeminiCallFailure({
      enrichmentType: 'forms_only',
      source: options.source,
      words,
      durationMs: Date.now() - startedAt,
      retryCount,
      error,
    });
    throw error;
  }
}

export async function enrichFormsOnly(
  words: string[],
  options: GeminiCallOptions = {},
): Promise<FormsOnlyResult[]> {
  const cleanedWords = words.map(sanitizeWordInput).filter(Boolean);
  if (cleanedWords.length === 0) return [];

  const chunks = chunkWords(cleanedWords, FORMS_ONLY_CHUNK_SIZE);
  const results = await mapWithConcurrency(
    chunks,
    FORMS_ONLY_MAX_CONCURRENCY,
    async (chunk, index) => {
      logger.info('[enrichFormsOnly] chunk start', {
        chunk_index: index + 1,
        chunk_count: chunks.length,
        word_count: chunk.length,
        source: normalizeGeminiCallSource(options.source),
      });
      try {
        return await enrichFormsOnlyResilient(chunk, options);
      } catch (error) {
        logger.error('[enrichFormsOnly] chunk failed permanently, skipping', {
          chunk_index: index + 1,
          word_count: chunk.length,
          words_preview: buildGeminiWordsPreview(chunk),
          error: getErrorMessage(error),
        });
        return [];
      }
    },
  );
  return results.flat();
}
