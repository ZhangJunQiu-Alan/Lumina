import { tokenizeClickableText } from './clickableTextTokenizer';

export function extractIeltsReadingLookupWords(text: string): string[] {
  const words = new Set<string>();

  for (const token of tokenizeClickableText(text)) {
    if (token.kind === 'content' && token.normalized) {
      words.add(token.normalized);
    }
  }

  return [...words];
}
