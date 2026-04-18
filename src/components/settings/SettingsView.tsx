import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  Repeat2,
  Volume2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';
import {
  AUTO_PLAY_GAP_OPTIONS,
  AUTO_PLAY_REPEAT_OPTIONS,
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
    return (
      <span className="rounded-full bg-black/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-text-secondary">
        自动同步
      </span>
    );
  }

  if (feedback.status === 'saving') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-[#12192b]/8 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-text-primary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        保存中
      </span>
    );
  }

  if (feedback.status === 'saved') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-apple-green/12 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-apple-green">
        <CheckCircle2 className="h-3.5 w-3.5" />
        已保存
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-apple-red/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-apple-red">
      <AlertCircle className="h-3.5 w-3.5" />
      保存失败
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
  const gridColsClass = options.length >= 3 ? 'sm:grid-cols-3' : options.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1';

  return (
    <div className={`grid gap-2 ${gridColsClass}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-[22px] border px-4 py-4 text-left transition-all ${
              disabled
                ? 'cursor-not-allowed border-white/60 bg-white/38 text-text-secondary/55'
                : active
                ? 'border-apple-blue/15 bg-apple-blue text-white shadow-[0_18px_34px_rgba(0,122,255,0.22)]'
                : 'border-white/70 bg-white/72 text-text-primary hover:-translate-y-0.5 hover:bg-white'
            }`}
          >
            <p className="text-sm font-black">{option.label}</p>
            {option.hint && (
              <p className={`mt-1 text-xs ${active && !disabled ? 'text-white/78' : 'text-text-secondary'}`}>
                {option.hint}
              </p>
            )}
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
      className={`inline-flex h-12 min-w-[118px] items-center justify-between rounded-full px-4 transition-all ${
        checked
          ? 'bg-apple-blue text-white shadow-[0_18px_34px_rgba(0,122,255,0.22)]'
          : 'bg-black/6 text-text-secondary'
      }`}
    >
      <span className="text-sm font-black">{checked ? '已开启' : '已关闭'}</span>
      <span
        className={`h-7 w-7 rounded-full transition-transform ${
          checked ? 'translate-x-0 bg-white/95' : 'bg-white'
        }`}
      />
    </button>
  );
}

function SettingRow({
  title,
  description,
  feedback,
  control,
  hint,
  disabled = false,
}: {
  title: string;
  description: string;
  feedback?: PreferenceFeedback;
  control: ReactNode;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`rounded-[28px] border border-white/70 bg-white/66 p-5 shadow-[0_14px_32px_rgba(0,0,0,0.04)] ${disabled ? 'opacity-75' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h3 className="text-lg font-black text-text-primary">{title}</h3>
          <p className="mt-2 text-sm leading-7 text-text-secondary">{description}</p>
        </div>
        <StatusPill feedback={feedback} />
      </div>

      <div className="mt-5">{control}</div>

      {feedback?.status === 'error' && feedback.message && (
        <p className="mt-3 text-sm leading-6 text-apple-red">{feedback.message}</p>
      )}

      {hint && (
        <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}

function SettingsCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  children,
}: {
  icon: typeof Volume2;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass relative overflow-hidden rounded-[34px] p-6 shadow-[0_28px_64px_rgba(14,26,56,0.08)] md:p-7"
    >
      <div className="pointer-events-none absolute -right-10 top-0 h-40 w-40 rounded-full bg-apple-blue/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">{eyebrow}</p>
            <h2 className="mt-2 text-2xl font-black text-text-primary">{title}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-text-secondary">{description}</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">{children}</div>
      </div>
    </motion.section>
  );
}

export const SettingsView = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { preferences, isLoading, loadError, savePreferences } = useLearningPreferences();
  const [feedbackByKey, setFeedbackByKey] = useState<Partial<Record<PreferenceKey, PreferenceFeedback>>>({});
  const feedbackTimeoutsRef = useRef<Partial<Record<PreferenceKey, ReturnType<typeof setTimeout>>>>({});

  useEffect(() => () => {
    for (const timeout of Object.values(feedbackTimeoutsRef.current) as Array<ReturnType<typeof setTimeout> | undefined>) {
      if (timeout) clearTimeout(timeout);
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
          message: error instanceof Error ? error.message : '保存失败，请稍后再试。',
        },
      }));
    }
  };

  if (isLoading) {
    return (
      <div className="glass mx-auto max-w-3xl rounded-[34px] p-16 text-center shadow-[0_28px_64px_rgba(14,26,56,0.08)]">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-apple-blue" />
        <p className="mt-5 text-2xl font-black text-text-primary">正在把你的学习设置接回来</p>
        <p className="mt-2 text-sm text-text-secondary">默认读音、连播节奏和纠错节奏都会跟着账号走。</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <motion.header
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[36px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.88),rgba(245,247,255,0.72))] p-6 shadow-[0_30px_80px_rgba(14,26,56,0.08)] backdrop-blur-2xl md:p-8"
      >
        <div className="pointer-events-none absolute -left-10 top-0 h-40 w-40 rounded-full bg-apple-blue/10 blur-3xl" />
        <div className="pointer-events-none absolute right-0 bottom-0 h-40 w-40 rounded-full bg-apple-teal/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <button
              type="button"
              onClick={() => navigate('/app/profile')}
              className="inline-flex items-center gap-2 rounded-full bg-white/82 px-4 py-2 text-sm font-bold text-text-secondary shadow-[0_10px_24px_rgba(0,0,0,0.05)] transition-colors hover:text-text-primary"
            >
              <ArrowLeft className="h-4 w-4" />
              回到我的
            </button>

            <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.28em] text-apple-blue">Learning Settings</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-text-primary md:text-5xl">
              把发音和节奏调成你习惯的样子。
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-text-secondary md:text-base">
              这里改的是整个学习系统默认怎么发音、怎么连播、答错后给你留多久看答案。改完会直接同步到当前账号，
              下次回来还是这一套。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[28px] border border-white/75 bg-white/72 px-5 py-4 shadow-[0_16px_32px_rgba(0,0,0,0.05)]">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">同步状态</p>
              <p className="mt-2 text-lg font-black text-text-primary">即时保存到账号</p>
            </div>
            <div className="rounded-[28px] border border-white/75 bg-white/72 px-5 py-4 shadow-[0_16px_32px_rgba(0,0,0,0.05)]">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">当前账号</p>
              <p className="mt-2 truncate text-lg font-black text-text-primary">
                {user?.email ?? '还没拿到邮箱'}
              </p>
            </div>
          </div>
        </div>
      </motion.header>

      {loadError && (
        <div className="rounded-[28px] border border-apple-red/15 bg-apple-red/8 px-5 py-4 text-apple-red shadow-[0_18px_40px_rgba(255,59,48,0.08)]">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div>
              <p className="text-sm font-black">设置同步暂时不顺</p>
              <p className="mt-1 text-sm leading-6">{loadError}</p>
            </div>
          </div>
        </div>
      )}

      <SettingsCard
        icon={Volume2}
        eyebrow="发音偏好"
        title="先决定默认读什么口音"
        description="新词切进来时会先按这里的口音走。手动点 UK / US 试听时，仍然只播一次，不会受连播设置影响。"
      >
        <SettingRow
          title="默认读音"
          description="自动播放默认先读英音还是美音。切到新词时，高亮的口音按钮也会跟着这里走。"
          feedback={feedbackByKey.defaultPronunciationLocale}
          control={(
            <SegmentedOptionGroup<PronunciationLocale>
              options={[
                { label: 'UK', value: 'uk', hint: '英音优先' },
                { label: 'US', value: 'us', hint: '美音优先' },
              ]}
              value={preferences.defaultPronunciationLocale}
              onChange={(next) => { void handleSave('defaultPronunciationLocale', { defaultPronunciationLocale: next }); }}
            />
          )}
        />

        <SettingRow
          title="切到新词时自动播放"
          description="开启后，每次进入新词都会按默认读音自动播；关闭后只保留手动播放按钮。"
          feedback={feedbackByKey.autoPlayEnabled}
          control={(
            <ToggleControl
              checked={preferences.autoPlayEnabled}
              onChange={(checked) => { void handleSave('autoPlayEnabled', { autoPlayEnabled: checked }); }}
            />
          )}
        />
      </SettingsCard>

      <SettingsCard
        icon={Repeat2}
        eyebrow="连播节奏"
        title="自动播放要不要多念几遍"
        description="这组配置只影响自动播放。你手动点口音按钮时，系统始终只念一遍，保证试听足够干脆。"
      >
        <SettingRow
          title="每个单词自动读几遍"
          description="新词自动播放时，按这里设定的遍数重复播放。"
          feedback={feedbackByKey.autoPlayRepeatCount}
          control={(
            <SegmentedOptionGroup<number>
              options={AUTO_PLAY_REPEAT_OPTIONS.map((count) => ({
                label: `${count} 遍`,
                value: count,
                hint: count === 1 ? '最干脆' : count === 2 ? '稳一点' : '多重复一次',
              }))}
              value={preferences.autoPlayRepeatCount}
              onChange={(next) => { void handleSave('autoPlayRepeatCount', { autoPlayRepeatCount: next as 1 | 2 | 3 }); }}
            />
          )}
        />

        <SettingRow
          title="重复间隔"
          description="自动连播时，两遍发音之间空多久。单次播放时这个设置会保留，但当前不会生效。"
          feedback={feedbackByKey.autoPlayRepeatGapMs}
          disabled={preferences.autoPlayRepeatCount === 1}
          hint={preferences.autoPlayRepeatCount === 1 ? '单次播放时不生效' : undefined}
          control={(
            <SegmentedOptionGroup<number>
              options={AUTO_PLAY_GAP_OPTIONS.map((gap) => ({
                label: `${(gap / 1000).toFixed(1)} 秒`,
                value: gap,
                hint: gap === 800 ? '紧凑' : gap === 1200 ? '均衡' : '更从容',
              }))}
              value={preferences.autoPlayRepeatGapMs}
              disabled={preferences.autoPlayRepeatCount === 1}
              onChange={(next) => { void handleSave('autoPlayRepeatGapMs', { autoPlayRepeatGapMs: next }); }}
            />
          )}
        />
      </SettingsCard>

      <SettingsCard
        icon={Clock3}
        eyebrow="纠错节奏"
        title="答错之后，留多久给你看正确答案"
        description="这会影响第二轮和复习模式里，答错后绿色答案提示停留多久再自动跳到下一个词。"
      >
        <SettingRow
          title="答案展示时长"
          description="默认 5 秒。如果你想看得更仔细，可以延长；如果想保持强节奏，可以缩短。"
          feedback={feedbackByKey.wrongAnswerRevealMs}
          control={(
            <SegmentedOptionGroup<number>
              options={WRONG_ANSWER_REVEAL_OPTIONS.map((duration) => ({
                label: `${duration / 1000} 秒`,
                value: duration,
                hint: duration === 3000 ? '更快' : duration === 5000 ? '默认' : '看久一点',
              }))}
              value={preferences.wrongAnswerRevealMs}
              onChange={(next) => { void handleSave('wrongAnswerRevealMs', { wrongAnswerRevealMs: next as 3000 | 5000 | 8000 }); }}
            />
          )}
        />
      </SettingsCard>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => navigate('/app/profile')}
          className="inline-flex items-center gap-2 rounded-full bg-[#12192b] px-5 py-3 text-sm font-black text-white shadow-[0_18px_34px_rgba(18,25,43,0.22)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
        >
          回到账号页
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
