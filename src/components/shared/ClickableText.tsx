import { Fragment, type ReactNode } from 'react';
import { isStopWord } from '../../lib/stopWords';
import { cx } from './LearningUI';

export type TokenKind = 'content' | 'stop' | 'whitespace' | 'punct' | 'cjk';

export interface TextToken {
  kind: TokenKind;
  text: string;
  normalized?: string;
}

const WORD_CHAR_RE = /[\p{Script=Latin}0-9'-]/u;
const LETTER_OR_NUMBER_RE = /[\p{Script=Latin}0-9]/u;
const WHITESPACE_RE = /\s/u;
const CJK_RE = /\p{Script=Han}/u;
const TOKEN_TRIM_RE = /^[^a-z0-9'-]+|[^a-z0-9'-]+$/gi;

function normalizeToken(text: string) {
  return text.replace(TOKEN_TRIM_RE, '').toLowerCase();
}

function hasLetterOrNumber(text: string) {
  return LETTER_OR_NUMBER_RE.test(text);
}

export function tokenizeClickableText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (WHITESPACE_RE.test(char)) {
      let end = index + 1;
      while (end < text.length && WHITESPACE_RE.test(text[end])) {
        end += 1;
      }
      tokens.push({ kind: 'whitespace', text: text.slice(index, end) });
      index = end;
      continue;
    }

    if (CJK_RE.test(char)) {
      tokens.push({ kind: 'cjk', text: char });
      index += 1;
      continue;
    }

    if (WORD_CHAR_RE.test(char)) {
      let end = index + 1;
      while (end < text.length && WORD_CHAR_RE.test(text[end])) {
        end += 1;
      }

      const tokenText = text.slice(index, end);
      const normalized = normalizeToken(tokenText);
      if (!normalized || !hasLetterOrNumber(normalized)) {
        tokens.push({ kind: 'punct', text: tokenText });
      } else if (isStopWord(normalized)) {
        tokens.push({ kind: 'stop', text: tokenText, normalized });
      } else {
        tokens.push({ kind: 'content', text: tokenText, normalized });
      }
      index = end;
      continue;
    }

    tokens.push({ kind: 'punct', text: char });
    index += 1;
  }

  return tokens;
}

export interface ClickableTextProps {
  text: string;
  targetWords?: ReadonlySet<string>;
  onWordClick: (word: string, anchor: HTMLElement) => void;
}

export function ClickableText({ text, targetWords, onWordClick }: ClickableTextProps) {
  return (
    <>
      {tokenizeClickableText(text).map((token, index): ReactNode => {
        if (token.kind !== 'content' || !token.normalized) {
          return <Fragment key={`${index}-${token.text}`}>{token.text}</Fragment>;
        }

        const isTarget = targetWords?.has(token.normalized) ?? false;

        return (
          <span
            key={`${index}-${token.text}`}
            className={cx(
              'rounded px-0.5 py-0.5 cursor-pointer transition-colors',
              isTarget
                ? 'bg-apple-blue/10 text-apple-blue font-bold hover:bg-apple-blue/20'
                : 'hover:bg-apple-blue/10',
            )}
            data-clickable-word={token.normalized}
            onClick={(event) => onWordClick(token.normalized!, event.currentTarget)}
          >
            {token.text}
          </span>
        );
      })}
    </>
  );
}
