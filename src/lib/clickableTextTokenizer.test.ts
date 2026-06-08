import { describe, expect, it } from 'vitest';
import { tokenizeClickableText } from './clickableTextTokenizer';

const contentWords = (text: string) =>
  tokenizeClickableText(text)
    .filter((token) => token.kind === 'content')
    .map((token) => token.normalized);

describe('tokenizeClickableText', () => {
  it('filters lookup fragments and keeps natural words clickable', () => {
    const words = contentWords(
      "oxygen O2 H2O h o n ox oxy- -gen hydro- earth's DNA well-developed isn't o'clock atmosphere",
    );

    expect(words).toEqual(['oxygen', 'well-developed', "isn't", "o'clock", 'atmosphere']);
  });
});
