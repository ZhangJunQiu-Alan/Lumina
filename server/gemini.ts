import { GoogleGenAI } from '@google/genai';
import {
  analyzeWordBatch,
  compareWordBatches,
  formatWordBatchMismatchMessage,
  sanitizeWordInput,
} from '../shared/wordBatch.js';

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
  confused_word: string | null;
  confused_diff_zh: string | null;
  memory_tip: string;
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
  "confused_word": "most commonly confused English word or null",
  "confused_diff_zh": "Chinese explanation of the difference, or null",
  "memory_tip": "A creative Chinese mnemonic or memory hook for this word"
}

Rules:
- ner_label: only set for proper nouns (e.g. "LOCATION", "ORGANIZATION"). For all common words set null.
- senses: include all major POS forms (n/v/adj/adv). At minimum 1 sense.
- memory_tip: must be in Chinese, creative and memorable, ideally using etymology, imagery, or sound association.
- confused_word: the single most common confusion word. null if no clear pair.
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

  return parsed.map((entry, index) => ({
    ...entry,
    word: responseWords[index],
  }));
}
