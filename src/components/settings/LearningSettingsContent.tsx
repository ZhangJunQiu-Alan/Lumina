import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock3,
  Loader2,
  Repeat2,
  RotateCcw,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';
import {
  AUTO_PLAY_GAP_OPTIONS,
  AUTO_PLAY_REPEAT_OPTIONS,
  LEARNING_PREFERENCES_DEFAULTS,
  WRONG_ANSWER_REVEAL_OPTIONS,
} from '../../lib/learningPreferences';
import type { LearningPreferences, PronunciationLocale } from '../../types';

type PreferenceKey = keyof LearningPreferences;
type PreferenceStatus = 'idle' | 'saving' | 'saved' | 'error';

interface PreferenceFeedback {
  status: PreferenceStatus;
  message?: string;
}

function StatusPill({ feedback }: { feedback?: PreferenceFeedback }) {
  if (!feedback || feedback.status === 'idle') {
    return null;
  }

  if (feedback.status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#12192b]/8 px-2.5 py-1 text-[11px] font-black text-text-primary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        保存中
      </span>
    );
  }

  if (feedback.status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-apple-green/12 px-2.5 py-1 text-[11px] font-black text-apple-green">
        <CheckCircle2 className="h-3.5 w-3.5" />
        已保存
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-apple-red/10 px-2.5 py-1 text-[11px] font-black text-apple-red">
      <AlertCircle className="h-3.5 w-3.5" />
      失败
    </span>
  );
}

function SegmentedOptionGroup<T extends string | number>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: Array<{ label: string; value: T; hint?: string }>;
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`min-h-[58px] rounded-[18px] border px-3 text-center transition-all ${
              disabled
                ? 'cursor-not-allowed border-white/60 bg-white/38 text-text-secondary/45'
                : active
                ? 'border-apple-blue bg-apple-blue text-white shadow-[0_18px_34px_rgba(0,122,255,0.25)]'
                : 'border-white/80 bg-white/78 text-text-primary shadow-[0_10px_24px_rgba(14,26,56,0.06)] hover:-translate-y-0.5 hover:bg-white'
            }`}
          >
            <span className="text-base font-black">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ToggleControl({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`inline-flex h-[58px] w-full items-center justify-between rounded-[18px] border px-4 transition-all ${
        checked
          ? 'border-apple-blue bg-apple-blue text-white shadow-[0_18px_34px_rgba(0,122,255,0.25)]'
          : 'border-white/80 bg-white/78 text-text-secondary shadow-[0_10px_24px_rgba(14,26,56,0.06)]'
      }`}
    >
      <span className="text-base font-black">{checked ? '开启' : '关闭'}</span>
      <span
        className={`h-7 w-7 rounded-full transition-transform shadow-[0_6px_16px_rgba(14,26,56,0.12)] ${
          checked ? 'bg-white/95' : 'bg-white'
        }`}
      />
    </button>
  );
}

function SettingItem({
  icon: Icon,
  title,
  description,
  feedback,
  control,
  disabled = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  feedback?: PreferenceFeedback;
  control: ReactNode;
  disabled?: boolean;
}) {
  return (
    <section className={`space-y-4 ${disabled ? 'opacity-65' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px] bg-apple-blue/10 text-apple-blue shadow-[0_10px_24px_rgba(0,122,255,0.10)]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-h-7 items-center justify-between gap-3">
            <h3 className="text-xl font-black leading-7 text-text-primary">{title}</h3>
            <StatusPill feedback={feedback} />
          </div>
          <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">{description}</p>
        </div>
      </div>

      <div className="sm:pl-[52px]">{control}</div>

      {feedback?.status === 'error' && feedback.message && (
        <p className="sm:pl-[52px] text-sm leading-6 text-apple-red">{feedback.message}</p>
      )}
    </section>
  );
}

export const LearningSettingsContent = ({ className = '' }: { className?: string }) => {
  const { preferences, isLoading, loadError, savePreferences } = useLearningPreferences();
  const [feedbackByKey, setFeedbackByKey] = useState<Partial<Record<PreferenceKey, PreferenceFeedback>>>({});
  const [resetFeedback, setResetFeedback] = useState<PreferenceFeedback>({ status: 'idle' });
  const feedbackTimeoutsRef = useRef<Partial<Record<PreferenceKey, ReturnType<typeof setTimeout>>>>({});
  const resetFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    for (const timeout of Object.values(feedbackTimeoutsRef.current) as Array<ReturnType<typeof setTimeout> | undefined>) {
      if (timeout) clearTimeout(timeout);
    }

    if (resetFeedbackTimeoutRef.current) {
      clearTimeout(resetFeedbackTimeoutRef.current);
    }
  }, []);

  const setTransientSaved = (key: PreferenceKey) => {
    if (feedbackTimeoutsRef.current[key]) {
      clearTimeout(feedbackTimeoutsRef.current[key]);
    }

    feedbackTimeoutsRef.current[key] = setTimeout(() => {
      setFeedbackByKey((prev) => ({
        ...prev,
        [key]: { status: 'idle' },
      }));
      feedbackTimeoutsRef.current[key] = undefined;
    }, 1800);
  };

  const handleSave = async (key: PreferenceKey, patch: Partial<LearningPreferences>) => {
    const isUnchanged = Object.entries(patch).every(([patchKey, patchValue]) => {
      const currentValue = preferences[patchKey as PreferenceKey];
      return currentValue === patchValue;
    });

    if (isUnchanged) return;

    setFeedbackByKey((prev) => ({
      ...prev,
      [key]: { status: 'saving' },
    }));

    try {
      await savePreferences(patch);
      setFeedbackByKey((prev) => ({
        ...prev,
        [key]: { status: 'saved' },
      }));
      setTransientSaved(key);
    } catch (error) {
      setFeedbackByKey((prev) => ({
        ...prev,
        [key]: {
          status: 'error',
          message: error instanceof Error ? error.message : '这次没写回账号，请稍后再试。',
        },
      }));
    }
  };

  const setTransientResetSaved = () => {
    if (resetFeedbackTimeoutRef.current) {
      clearTimeout(resetFeedbackTimeoutRef.current);
    }

    resetFeedbackTimeoutRef.current = setTimeout(() => {
      setResetFeedback({ status: 'idle' });
      resetFeedbackTimeoutRef.current = null;
    }, 1800);
  };

  const handleResetDefaults = async () => {
    setResetFeedback({ status: 'saving' });

    try {
      await savePreferences(LEARNING_PREFERENCES_DEFAULTS);
      setFeedbackByKey({});
      setResetFeedback({ status: 'saved' });
      setTransientResetSaved();
    } catch (error) {
      setResetFeedback({
        status: 'error',
        message: error instanceof Error ? error.message : '默认设置没能写回账号，请稍后再试。',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="glass mx-auto max-w-3xl rounded-[34px] p-16 text-center shadow-[0_28px_64px_rgba(14,26,56,0.08)]">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-apple-blue" />
        <p className="mt-5 text-2xl font-black text-text-primary">正在把你的学习节奏接回来</p>
        <p className="mt-2 text-sm text-text-secondary">默认读音、自动连播和纠错停留都会跟着账号走。</p>
      </div>
    );
  }

  return (
    <div className={`w-full max-w-3xl mx-auto space-y-8 ${className}`}>
      {loadError && (
        <div className="rounded-[22px] border border-apple-red/15 bg-apple-red/8 px-4 py-3 text-apple-red shadow-[0_14px_30px_rgba(255,59,48,0.08)]">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div>
              <p className="text-sm font-black">学习节奏暂时没接上</p>
              <p className="mt-1 text-sm leading-6">{loadError}</p>
            </div>
          </div>
        </div>
      )}

      <SettingItem
        icon={Volume2}
        title="默认口音"
        description="自动朗读优先使用的口音"
        feedback={feedbackByKey.defaultPronunciationLocale}
        control={(
          <SegmentedOptionGroup<PronunciationLocale>
            options={[
              { label: 'UK', value: 'uk' },
              { label: 'US', value: 'us' },
            ]}
            value={preferences.defaultPronunciationLocale}
            onChange={(next) => { void handleSave('defaultPronunciationLocale', { defaultPronunciationLocale: next }); }}
          />
        )}
      />

      <SettingItem
        icon={Repeat2}
        title="自动开口"
        description="进入新词时自动朗读"
        feedback={feedbackByKey.autoPlayEnabled}
        control={(
          <ToggleControl
            checked={preferences.autoPlayEnabled}
            onChange={(checked) => { void handleSave('autoPlayEnabled', { autoPlayEnabled: checked }); }}
          />
        )}
      />

      <SettingItem
        icon={Volume2}
        title="朗读次数"
        description="每个单词自动朗读的次数"
        feedback={feedbackByKey.autoPlayRepeatCount}
        control={(
          <SegmentedOptionGroup<number>
            options={AUTO_PLAY_REPEAT_OPTIONS.map((count) => ({
              label: `${count}次`,
              value: count,
            }))}
            value={preferences.autoPlayRepeatCount}
            onChange={(next) => { void handleSave('autoPlayRepeatCount', { autoPlayRepeatCount: next as 1 | 2 | 3 }); }}
          />
        )}
      />

      <SettingItem
        icon={Clock3}
        title="间隔时间"
        description="自动朗读之间的间隔"
        feedback={feedbackByKey.autoPlayRepeatGapMs}
        disabled={preferences.autoPlayRepeatCount === 1}
        control={(
          <SegmentedOptionGroup<number>
            options={AUTO_PLAY_GAP_OPTIONS.map((gap) => ({
              label: `${(gap / 1000).toFixed(1)}秒`,
              value: gap,
            }))}
            value={preferences.autoPlayRepeatGapMs}
            disabled={preferences.autoPlayRepeatCount === 1}
            onChange={(next) => { void handleSave('autoPlayRepeatGapMs', { autoPlayRepeatGapMs: next }); }}
          />
        )}
      />

      <SettingItem
        icon={Clock3}
        title="答案停留时间"
        description="答错后正确答案停留的时间"
        feedback={feedbackByKey.wrongAnswerRevealMs}
        control={(
          <SegmentedOptionGroup<number>
            options={WRONG_ANSWER_REVEAL_OPTIONS.map((duration) => ({
              label: `${duration / 1000}秒`,
              value: duration,
            }))}
            value={preferences.wrongAnswerRevealMs}
            onChange={(next) => { void handleSave('wrongAnswerRevealMs', { wrongAnswerRevealMs: next as 3000 | 5000 | 8000 }); }}
          />
        )}
      />

      <SettingItem
        icon={BookOpen}
        title="第三轮"
        description="完成第二轮后继续强化"
        feedback={feedbackByKey.reinforcementRound3Enabled}
        control={(
          <ToggleControl
            checked={preferences.reinforcementRound3Enabled}
            onChange={(checked) => { void handleSave('reinforcementRound3Enabled', { reinforcementRound3Enabled: checked }); }}
          />
        )}
      />

      <SettingItem
        icon={BookOpen}
        title="文章巩固"
        description="用短文把单词放回语境"
        feedback={feedbackByKey.reinforcementArticleEnabled}
        control={(
          <ToggleControl
            checked={preferences.reinforcementArticleEnabled}
            onChange={(checked) => { void handleSave('reinforcementArticleEnabled', { reinforcementArticleEnabled: checked }); }}
          />
        )}
      />

      <div className="border-t border-black/6 pt-2">
        <button
          type="button"
          onClick={() => { void handleResetDefaults(); }}
          disabled={resetFeedback.status === 'saving'}
          className="flex w-full items-center justify-between gap-4 rounded-[18px] px-3 py-3 text-left text-sm font-black text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="inline-flex items-center gap-3">
            {resetFeedback.status === 'saving' ? (
              <Loader2 className="h-5 w-5 animate-spin text-apple-blue" />
            ) : (
              <RotateCcw className="h-5 w-5 text-apple-blue" />
            )}
            恢复默认设置
          </span>
          <StatusPill feedback={resetFeedback} />
        </button>

        {resetFeedback.status === 'error' && resetFeedback.message && (
          <p className="mt-3 px-4 text-sm leading-6 text-apple-red">{resetFeedback.message}</p>
        )}
      </div>
    </div>
  );
};
