import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClozePrompt } from '../../lib/cloze';
import type { Word } from '../../types';
import {
  AnswerFeedbackCard,
  InputSessionShell,
  renderProgressBar,
  Round1ConfusingCard,
  Round1MemoryTipCard,
  Round1MorphologyCard,
  Round1RelationsCard,
} from './Round1Cards';

function makeWord(overrides: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    word: 'allocate',
    phonetic: '/ˈæləkeɪt/',
    pos_tags: ['v'],
    ner_entities: [],
    chinese_definition: '分配',
    senses: [{ pos: 'v', meaning_zh: '分配', example_sentence: '', example_translation_zh: '' }],
    example_sentences: [],
    morphology: { summaryZh: '', parts: [] },
    derivedWords: [],
    synonyms: [],
    antonyms: [],
    confusingPairs: [],
    ...overrides,
  } as Word;
}

describe('Round1MorphologyCard', () => {
  it('renders the summary and derived words', () => {
    render(
      <Round1MorphologyCard
        word={makeWord({
          morphology: { summaryZh: 'al- 表示朝向', parts: [] },
          derivedWords: [{ word: 'allocation', meaningZh: '分配', noteZh: '' }],
        })}
      />,
    );
    expect(screen.getByText('单词拆解')).toBeInTheDocument();
    expect(screen.getByText('al- 表示朝向')).toBeInTheDocument();
    expect(screen.getByText('派生词')).toBeInTheDocument();
    expect(screen.getByText('allocation')).toBeInTheDocument();
  });

  it('renders nothing without morphology content', () => {
    const { container } = render(<Round1MorphologyCard word={makeWord()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Round1RelationsCard', () => {
  it('renders synonyms and antonyms', () => {
    render(
      <Round1RelationsCard
        word={makeWord({
          synonyms: [{ word: 'assign', meaningZh: '', noteZh: '' }],
          antonyms: [{ word: 'withhold', meaningZh: '', noteZh: '' }],
        })}
      />,
    );
    expect(screen.getByText('近义词')).toBeInTheDocument();
    expect(screen.getByText('反义词')).toBeInTheDocument();
    expect(screen.getByText('assign')).toBeInTheDocument();
    expect(screen.getByText('withhold')).toBeInTheDocument();
  });

  it('renders nothing without relations', () => {
    const { container } = render(<Round1RelationsCard word={makeWord()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Round1ConfusingCard', () => {
  const baseProps = {
    activeExampleKey: null,
    canPlayExampleAudio: false,
    exampleLocale: 'us' as const,
    onPlayExample: () => {},
  };

  it('renders confusing-pair differences', () => {
    render(
      <Round1ConfusingCard
        {...baseProps}
        word={makeWord({ confusingPairs: [{ word: 'allot', difference: 'allot 多指定额分配' }] })}
      />,
    );
    expect(screen.getByText('易混词义对比')).toBeInTheDocument();
    expect(screen.getByText('allot 多指定额分配')).toBeInTheDocument();
  });

  it('renders nothing without pairs or examples', () => {
    const { container } = render(<Round1ConfusingCard {...baseProps} word={makeWord()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Round1MemoryTipCard', () => {
  it('renders the memory tip', () => {
    render(<Round1MemoryTipCard memoryTip="联想 a-lot-of 分配很多" />);
    expect(screen.getByText('记忆提示')).toBeInTheDocument();
    expect(screen.getByText('联想 a-lot-of 分配很多')).toBeInTheDocument();
  });
});

describe('AnswerFeedbackCard', () => {
  it('shows the success state with the target word', () => {
    render(<AnswerFeedbackCard word={makeWord()} clozePrompt={null} />);
    expect(screen.getByText('回答正确')).toBeInTheDocument();
    expect(screen.getByText('allocate')).toBeInTheDocument();
  });

  it('shows the wrong state with the expected form and the typed answer', () => {
    const clozePrompt: ClozePrompt = {
      blankedSentence: '',
      translation: '',
      expectedForm: 'allocated',
      baseForm: 'allocate',
      formLabel: '过去式',
      senseIndex: 0,
    };
    render(<AnswerFeedbackCard word={makeWord()} clozePrompt={clozePrompt} isWrong wrongInput="alocated" />);
    expect(screen.getByText('答案有误 · 正确答案如下')).toBeInTheDocument();
    expect(screen.getByText('allocated')).toBeInTheDocument();
    expect(screen.getByText('原形 · allocate')).toBeInTheDocument();
    expect(screen.getByText(/alocated/)).toBeInTheDocument();
  });
});

describe('InputSessionShell', () => {
  it('renders the round chrome and the main slot', () => {
    render(<InputSessionShell type="round1" currentIndex={0} queueLength={5} main={<div>主体内容</div>} />);
    expect(screen.getByText('主体内容')).toBeInTheDocument();
  });
});

describe('renderProgressBar', () => {
  it('shows the 1-based position out of the queue length', () => {
    render(<>{renderProgressBar(2, 10)}</>);
    expect(screen.getByText('第 3 / 10 个词')).toBeInTheDocument();
  });
});
