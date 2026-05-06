import { CLOZE_BLANK, type ClozePrompt } from './cloze';
import { tokenizeClickableText } from './clickableTextTokenizer';

export function extractRound2ClickableWords(prompt: ClozePrompt): string[] {
  const words = new Set<string>();
  const visibleSentenceParts = prompt.blankedSentence.split(CLOZE_BLANK);

  for (const part of visibleSentenceParts) {
    for (const token of tokenizeClickableText(part)) {
      if (token.kind === 'content' && token.normalized) {
        words.add(token.normalized);
      }
    }
  }

  return [...words];
}
