import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import type { LibraryGroupSummary } from '../../types';

const roundLabels = {
  round1: '第一轮 · 记忆',
  round2: '第二轮 · 回忆',
  round3: '第三轮 · 听写',
  article: '文章巩固',
};

export function PersonalLearningGroups({
  groups,
  onContinue,
}: {
  groups: LibraryGroupSummary[];
  onContinue: (groupId: string) => Promise<void> | void;
}) {
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const startingRef = useRef(false);
  const pendingGroups = groups
    .filter((group) => group.sourceType === 'custom' && group.status !== 'completed' && !group.completedAt)
    .sort((left, right) => (right.lastActiveAt || right.createdAt).localeCompare(left.lastActiveAt || left.createdAt));

  const continueGroup = async (groupId: string) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStartingId(groupId);
    setError('');
    try {
      await onContinue(groupId);
    } catch {
      setError('学习组暂时无法打开，请重试。');
    } finally {
      startingRef.current = false;
      setStartingId(null);
    }
  };

  return (
    <section
      aria-labelledby="personal-learning-groups-title"
      className="mb-6 rounded-3xl border border-black/5 bg-white/65 p-5 sm:p-6"
    >
      <h3 id="personal-learning-groups-title" className="text-lg font-bold text-text-primary">
        继续学习
      </h3>
      {pendingGroups.length === 0 ? (
        <p className="mt-2 text-sm text-text-secondary">暂无未完成的学习组。可在下方选择单词开始学习。</p>
      ) : (
        <ul className="mt-3 divide-y divide-black/5">
          {pendingGroups.map((group) => (
            <li key={group.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="min-w-0 flex-1 basis-48">
                <Link
                  to={`/app/library/group/${group.id}`}
                  className="font-bold text-text-primary hover:text-apple-blue"
                >
                  {group.title}
                </Link>
                <p className="mt-1 text-sm text-text-secondary">
                  {roundLabels[group.sessionRound ?? 'round1']} · 共 {group.wordCount} 词
                </p>
                {group.progress ? (
                  <>
                    <p className="mt-1 text-xs text-text-secondary">
                      本轮已完成 {group.progress.completed}/{group.progress.total} 词
                    </p>
                    <progress
                      aria-label={`${group.title}本轮进度`}
                      value={group.progress.completed}
                      max={Math.max(group.progress.total, 1)}
                      className="mt-2 h-1.5 w-full max-w-xs accent-apple-blue"
                    />
                  </>
                ) : (
                  <p className="mt-1 text-xs text-text-secondary">进入学习后查看本轮进度</p>
                )}
              </div>
              <button
                type="button"
                disabled={startingId !== null || group.wordCount === 0}
                aria-label={`继续学习：${group.title}`}
                onClick={() => void continueGroup(group.id)}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-apple-blue px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {startingId === group.id && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                {startingId === group.id ? '正在打开' : '继续学习'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-apple-red">
          {error}
        </p>
      )}
    </section>
  );
}
