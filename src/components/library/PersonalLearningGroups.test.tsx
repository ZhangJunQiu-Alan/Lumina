import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonalLearningGroups } from './PersonalLearningGroups';
import type { LibraryGroupSummary } from '../../types';

const first: LibraryGroupSummary = {
  id: 'group1',
  title: '个人词库 · 第 1 组 · 3 词',
  createdAt: '2026-09-15T00:00:00Z',
  wordCount: 3,
  sourceType: 'custom',
  libraryId: null,
  status: 'active',
  sessionRound: 'round2',
  completedAt: null,
  progress: { completed: 1, total: 3 },
};
const second: LibraryGroupSummary = {
  ...first,
  id: 'group2',
  title: '个人词库 · 第 2 组 · 7 词',
  wordCount: 7,
  sessionRound: 'round1',
  progress: { completed: 2, total: 7 },
  lastActiveAt: '2026-09-16T00:00:00Z',
};
afterEach(cleanup);

describe('continue personal learning groups', () => {
  it('lists every unfinished personal group with accurate round, size and progress', async () => {
    const onContinue = vi.fn();
    render(
      <MemoryRouter>
        <PersonalLearningGroups
          groups={[
            first,
            second,
            { ...first, id: 'done', title: '已完成组', status: 'completed' },
            { ...first, id: 'dated', title: '有完成时间', completedAt: first.createdAt },
            { ...first, id: 'official', title: '官方学习组', sourceType: 'system' },
          ]}
          onContinue={onContinue}
        />
      </MemoryRouter>,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText(second.title)).toBeInTheDocument();
    expect(within(items[0]).getByText('第一轮 · 记忆 · 共 7 词')).toBeInTheDocument();
    expect(within(items[0]).getByText('本轮已完成 2/7 词')).toBeInTheDocument();
    expect(within(items[1]).getByText('第二轮 · 回忆 · 共 3 词')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: first.title })).toHaveAttribute('href', '/app/library/group/group1');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `继续学习：${first.title}` }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `继续学习：${second.title}` }));
    });
    expect(onContinue.mock.calls).toEqual([['group1'], ['group2']]);
  });

  it('blocks duplicate starts, retains both entries after failure and allows retry', async () => {
    let rejectStart!: (error: Error) => void;
    const onContinue = vi.fn().mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    render(
      <MemoryRouter>
        <PersonalLearningGroups groups={[first, second]} onContinue={onContinue} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: `继续学习：${first.title}` }));
    expect(screen.getByRole('button', { name: `继续学习：${second.title}` })).toBeDisabled();
    await act(async () => {
      rejectStart(new Error('network failure'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('学习组暂时无法打开，请重试。');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `继续学习：${second.title}` }));
    });
    expect(onContinue).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows how to start when there are no pending groups', () => {
    render(
      <MemoryRouter>
        <PersonalLearningGroups groups={[]} onContinue={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText('暂无未完成的学习组。可在下方选择单词开始学习。')).toBeInTheDocument();
  });
});
