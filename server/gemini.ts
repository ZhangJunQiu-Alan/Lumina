import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

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
  "ipa_uk": "British IPA e.g. /ˈæl.ə.keɪt/",
  "ipa_us": "American IPA e.g. /ˈæl.ə.keɪt/",
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
  const prompt = `${SYSTEM_PROMPT}\n\nWords to process: ${words.join(', ')}`;

  const result = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
  });

  const raw = result.text?.trim() ?? '';

  // Strip markdown fences if Gemini adds them despite instructions
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

  return parsed;
}
