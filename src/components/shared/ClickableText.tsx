import { Fragment, type ReactNode } from 'react';
import {
  tokenizeClickableText,
  type TextToken,
  type TokenKind,
} from '../../lib/clickableTextTokenizer';
import { cx } from './LearningUI';

export { tokenizeClickableText, type TextToken, type TokenKind };

export interface ClickableTextProps {
  text: string;
  targetWords?: ReadonlySet<string>;
  onWordClick: WordClickHandler;
  stopPropagation?: boolean;
}

export type WordClickHandler = (word: string, anchor: HTMLElement) => void;

export function ClickableText({ text, targetWords, onWordClick, stopPropagation = false }: ClickableTextProps) {
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
            onClick={(event) => {
              if (stopPropagation) {
                event.stopPropagation();
              }
              onWordClick(token.normalized!, event.currentTarget);
            }}
          >
            {token.text}
          </span>
        );
      })}
    </>
  );
}
