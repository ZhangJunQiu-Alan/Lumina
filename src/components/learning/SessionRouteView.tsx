import React from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import type { ArticleSentence, PersistedLearningSession, RoundType, Word } from '../../types';
import type { ReviewRecovery } from '../../lib/learningRecovery';
import { IslandButton } from '../shared/AnimalPrimitives';
import { LearningEngine, type LearningSessionSnapshot } from './LearningEngine';
import { ArticleView } from './ArticleView';

export interface SessionRouteViewProps {
  userId?: string;
  round: RoundType;
  words: Word[];
  activeLearningGroupId: string | null;
  activeSessionSeed: PersistedLearningSession | null;
  activeReviewRecovery: ReviewRecovery | null;
  articleSentences: ArticleSentence[] | null;
  articleGenerationError: string;
  articleReinforcementEnabled: boolean;
  round1CanWaitForMoreWords: boolean;
  sessionLeadingAction: React.ReactNode;
  sessionActions: React.ReactNode;
  onNavigateHome: () => void;
  onRetryArticleGeneration: () => void;
  onRoundComplete: () => void;
  onLearningSessionChange: (session: LearningSessionSnapshot) => void;
  onReviewChange: (recovery: ReviewRecovery) => void;
  onWordMastered: (wordId: string) => void;
  onWordMasteredRollback: (word: Word) => void;
}

export function SessionRouteView({
  userId,
  round,
  words,
  activeLearningGroupId,
  activeSessionSeed,
  activeReviewRecovery,
  articleSentences,
  articleGenerationError,
  articleReinforcementEnabled,
  round1CanWaitForMoreWords,
  sessionLeadingAction,
  sessionActions,
  onNavigateHome,
  onRetryArticleGeneration,
  onRoundComplete,
  onLearningSessionChange,
  onReviewChange,
  onWordMastered,
  onWordMasteredRollback,
}: SessionRouteViewProps) {
  if (words.length === 0) {
    return (
      <div className="glass mx-auto max-w-3xl rounded-apple-lg p-16 text-center shadow-xl">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">这里还没有内容</p>
        <h2 className="mt-4 text-3xl font-black text-text-primary">回到首页，查看今天的学习安排。</h2>
        <IslandButton onClick={onNavigateHome} className="mt-8" tone="mint" size="large">
          回到首页
        </IslandButton>
      </div>
    );
  }

  if (round === 'article' && articleReinforcementEnabled) {
    if (articleSentences === null) {
      if (articleGenerationError) {
        return (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass p-16 rounded-apple-lg shadow-2xl flex flex-col items-center gap-6 text-center"
          >
            <AlertCircle className="h-10 w-10 text-apple-red" />
            <div>
              <p className="font-black text-xl text-text-primary">文章暂时没有生成</p>
              <p className="mt-2 text-sm font-bold text-text-secondary">{articleGenerationError}</p>
            </div>
            <button
              type="button"
              onClick={onRetryArticleGeneration}
              className="flex items-center justify-center gap-2 rounded-2xl bg-apple-blue px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-apple-blue/20 transition-transform active:scale-95"
            >
              <RefreshCw className="h-4 w-4" />
              再试一次
            </button>
          </motion.div>
        );
      }

      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass p-16 rounded-apple-lg shadow-2xl flex flex-col items-center gap-6"
        >
          <Loader2 className="w-10 h-10 text-apple-green animate-spin" />
          <p className="font-black text-xl">正在生成巩固文章，失败后最多自动重试 3 次</p>
        </motion.div>
      );
    }

    return <ArticleView sentences={articleSentences} words={words} onFinish={onRoundComplete} />;
  }

  return (
    <React.Fragment key={`${activeLearningGroupId ?? 'review'}:${round}`}>
      <LearningEngine
        userId={userId}
        type={round}
        words={words}
        initialSession={activeSessionSeed}
        onComplete={onRoundComplete}
        onSessionChange={onLearningSessionChange}
        initialReviewRecovery={activeReviewRecovery}
        onReviewChange={onReviewChange}
        onWordMastered={onWordMastered}
        onWordMasteredRollback={onWordMasteredRollback}
        sessionLeadingAction={sessionLeadingAction}
        sessionActions={sessionActions}
        round1CanWaitForMoreWords={round1CanWaitForMoreWords}
      />
    </React.Fragment>
  );
}
