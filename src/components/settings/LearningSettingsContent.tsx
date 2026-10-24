import { useState, type ReactNode } from 'react';
import {
  AlertCircle,
  BookOpen,
  Clock3,
  FileText,
  Globe2,
  Loader2,
  MessageSquareText,
  Repeat2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';
import {
  AUTO_PLAY_GAP_OPTIONS,
  AUTO_PLAY_REPEAT_OPTIONS,
  buildReinforcementRoundTogglePatch,
  CORRECT_ANSWER_REVEAL_OPTIONS,
  LEARNING_PREFERENCES_DEFAULTS,
  SPEECH_PLAYBACK_RATE_OPTIONS,
  WRONG_ANSWER_REVEAL_OPTIONS,
} from '../../lib/learningPreferences';
import { ARTICLE_REINFORCEMENT_ENABLED } from '../../lib/aiFeatures';
import type { LearningPreferences, PronunciationLocale, SpeechPlaybackRate } from '../../types';

type PreferenceKey = keyof LearningPreferences;
type PreferenceStatus = 'idle' | 'saving' | 'error';

interface PreferenceFeedback {
  status: PreferenceStatus;
  message?: string;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function formatSeconds(ms: number, fixed = false) {
  const seconds = ms / 1000;
  return `${fixed ? seconds.toFixed(1) : seconds}秒`;
}

function StatusPill({ feedback }: { feedback?: PreferenceFeedback }) {
  if (!feedback || feedback.status !== 'error') return null;

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
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cx(
        'setting-options isolate w-full overflow-hidden rounded-[16px] border border-[#eadfcd] shadow-[0_10px_28px_rgba(79,62,38,0.10),inset_0_1px_0_rgba(255,255,255,0.85)]',
        disabled && 'opacity-45',
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cx(
              'min-h-[52px] px-2.5 text-sm font-black text-[#5f4f42] transition-colors',
              active && 'bg-[#19c8b9] text-white shadow-[0_12px_28px_rgba(25,200,185,0.30)]',
              !active && !disabled && 'hover:bg-[#fff8ec]',
              disabled && 'cursor-not-allowed',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleControl({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-9 w-[4.125rem] rounded-full transition-colors shadow-[0_10px_24px_rgba(79,62,38,0.10)]',
        checked ? 'bg-[#19c8b9]' : 'bg-[#ded4c8]',
      )}
    >
      <span
        className={cx(
          'absolute left-0 top-1 h-7 w-7 rounded-full bg-white shadow-[0_6px_14px_rgba(51,41,30,0.22)] transition-transform',
          checked ? 'translate-x-[2.125rem]' : 'translate-x-1',
        )}
      />
    </button>
  );
}

function SettingGroup({ children }: { children: ReactNode }) {
  return <section className="divide-y divide-[#eadfcd] border-t border-[#eadfcd]">{children}</section>;
}

function SettingRow({
  icon: Icon,
  title,
  feedback,
  control,
  disabled = false,
}: {
  icon: LucideIcon;
  title: string;
  feedback?: PreferenceFeedback;
  control: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={cx('setting-row', disabled && 'opacity-50')}>
      <div className="setting-row__label">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#eadfcd] bg-[#fffdf8] text-[#6a5848] shadow-[0_8px_22px_rgba(79,62,38,0.08),inset_0_1px_0_rgba(255,255,255,0.95)]">
          <Icon className="h-5 w-5" strokeWidth={2.35} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-lg font-black leading-tight text-[#5a4a3d]">{title}</h3>
          <StatusPill feedback={feedback} />
        </div>
      </div>
      <div className="setting-row__control">
        <div className="flex justify-end">{control}</div>
      </div>
      {feedback?.status === 'error' && feedback.message && (
        <p className="w-full text-sm font-bold leading-6 text-apple-red">{feedback.message}</p>
      )}
    </div>
  );
}

export const LearningSettingsContent = ({ className = '' }: { className?: string }) => {
  const { preferences, isLoading, loadError, savePreferences } = useLearningPreferences();
  const [feedbackByKey, setFeedbackByKey] = useState<Partial<Record<PreferenceKey, PreferenceFeedback>>>({});
  const [resetFeedback, setResetFeedback] = useState<PreferenceFeedback>({ status: 'idle' });

  const handleSave = async (key: PreferenceKey, patch: Partial<LearningPreferences>) => {
    const isUnchanged = Object.entries(patch).every(([patchKey, patchValue]) => {
      const currentValue = preferences[patchKey as PreferenceKey];
      return currentValue === patchValue;
    });

    if (isUnchanged) return;

    setFeedbackByKey((prev) => ({
      ...prev,
      [key]: { status: 'idle' },
    }));

    try {
      await savePreferences(patch);
      setFeedbackByKey((prev) => ({
        ...prev,
        [key]: { status: 'idle' },
      }));
    } catch (error) {
      setFeedbackByKey((prev) => ({
        ...prev,
        [key]: {
          status: 'error',
          message: error instanceof Error ? error.message : '保存失败',
        },
      }));
    }
  };

  const handleResetDefaults = async () => {
    setResetFeedback({ status: 'saving' });

    try {
      await savePreferences(LEARNING_PREFERENCES_DEFAULTS);
      setFeedbackByKey({});
      setResetFeedback({ status: 'idle' });
    } catch (error) {
      setResetFeedback({
        status: 'error',
        message: error instanceof Error ? error.message : '保存失败',
      });
    }
  };

  const handleReinforcementRoundToggle = (key: 'round2Enabled' | 'reinforcementRound3Enabled', checked: boolean) => {
    void handleSave(key, buildReinforcementRoundTogglePatch(preferences, key, checked));
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-[#19c8b9]" />
          <p className="mt-5 text-xl font-black text-[#5a4a3d]">正在读取学习设置</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cx('w-full', className)}>
      {loadError && (
        <div className="mb-5 rounded-[20px] border border-apple-red/15 bg-apple-red/8 px-4 py-3 text-apple-red">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <p className="text-sm font-bold leading-6">{loadError}</p>
          </div>
        </div>
      )}

      <SettingGroup>
        <SettingRow
          icon={Globe2}
          title="默认发音"
          feedback={feedbackByKey.defaultPronunciationLocale}
          control={
            <SegmentedOptionGroup<PronunciationLocale>
              options={[
                { label: 'UK', value: 'uk' },
                { label: 'US', value: 'us' },
              ]}
              value={preferences.defaultPronunciationLocale}
              onChange={(next) => {
                void handleSave('defaultPronunciationLocale', { defaultPronunciationLocale: next });
              }}
            />
          }
        />
      </SettingGroup>

      <SettingGroup>
        <SettingRow
          icon={Volume2}
          title="自动朗读"
          feedback={feedbackByKey.autoPlayEnabled}
          control={
            <ToggleControl
              checked={preferences.autoPlayEnabled}
              onChange={(checked) => {
                void handleSave('autoPlayEnabled', { autoPlayEnabled: checked });
              }}
            />
          }
        />
        <SettingRow
          icon={Volume2}
          title="查词浮窗自动朗读"
          feedback={feedbackByKey.popoverAutoPlayEnabled}
          control={
            <ToggleControl
              checked={preferences.popoverAutoPlayEnabled}
              onChange={(checked) => {
                void handleSave('popoverAutoPlayEnabled', { popoverAutoPlayEnabled: checked });
              }}
            />
          }
        />
        <SettingRow
          icon={Volume2}
          title="答对后朗读例句"
          feedback={feedbackByKey.clozeSentenceAutoPlayEnabled}
          control={
            <ToggleControl
              checked={preferences.clozeSentenceAutoPlayEnabled}
              onChange={(checked) => {
                void handleSave('clozeSentenceAutoPlayEnabled', { clozeSentenceAutoPlayEnabled: checked });
              }}
            />
          }
        />
        <SettingRow
          icon={SlidersHorizontal}
          title="朗读速度"
          feedback={feedbackByKey.speechPlaybackRate}
          control={
            <SegmentedOptionGroup<number>
              options={SPEECH_PLAYBACK_RATE_OPTIONS.map((rate) => ({
                label: `${rate}倍`,
                value: rate,
              }))}
              value={preferences.speechPlaybackRate}
              onChange={(next) => {
                void handleSave('speechPlaybackRate', { speechPlaybackRate: next as SpeechPlaybackRate });
              }}
            />
          }
        />
        <SettingRow
          icon={Repeat2}
          title="朗读次数"
          feedback={feedbackByKey.autoPlayRepeatCount}
          control={
            <SegmentedOptionGroup<number>
              options={AUTO_PLAY_REPEAT_OPTIONS.map((count) => ({
                label: `${count}次`,
                value: count,
              }))}
              value={preferences.autoPlayRepeatCount}
              onChange={(next) => {
                void handleSave('autoPlayRepeatCount', { autoPlayRepeatCount: next as 1 | 2 | 3 });
              }}
            />
          }
        />
        <SettingRow
          icon={Clock3}
          title="重复朗读间隔"
          feedback={feedbackByKey.autoPlayRepeatGapMs}
          disabled={preferences.autoPlayRepeatCount === 1}
          control={
            <SegmentedOptionGroup<number>
              options={AUTO_PLAY_GAP_OPTIONS.map((gap) => ({
                label: formatSeconds(gap, true),
                value: gap,
              }))}
              value={preferences.autoPlayRepeatGapMs}
              disabled={preferences.autoPlayRepeatCount === 1}
              onChange={(next) => {
                void handleSave('autoPlayRepeatGapMs', { autoPlayRepeatGapMs: next });
              }}
            />
          }
        />
      </SettingGroup>

      <SettingGroup>
        <SettingRow
          icon={MessageSquareText}
          title="答对后反馈时长"
          feedback={feedbackByKey.correctAnswerRevealMs}
          control={
            <SegmentedOptionGroup<number>
              options={CORRECT_ANSWER_REVEAL_OPTIONS.map((duration) => ({
                label: formatSeconds(duration),
                value: duration,
              }))}
              value={preferences.correctAnswerRevealMs}
              onChange={(next) => {
                void handleSave('correctAnswerRevealMs', { correctAnswerRevealMs: next as 800 | 1000 | 1500 | 2000 });
              }}
            />
          }
        />
        <SettingRow
          icon={Clock3}
          title="答错后答案显示时长"
          feedback={feedbackByKey.wrongAnswerRevealMs}
          control={
            <SegmentedOptionGroup<number>
              options={WRONG_ANSWER_REVEAL_OPTIONS.map((duration) => ({
                label: formatSeconds(duration),
                value: duration,
              }))}
              value={preferences.wrongAnswerRevealMs}
              onChange={(next) => {
                void handleSave('wrongAnswerRevealMs', { wrongAnswerRevealMs: next as 3000 | 5000 | 8000 });
              }}
            />
          }
        />
      </SettingGroup>

      <SettingGroup>
        <SettingRow
          icon={Sparkles}
          title="记忆提示"
          feedback={feedbackByKey.memoryTipEnabled}
          control={
            <ToggleControl
              checked={preferences.memoryTipEnabled}
              onChange={(checked) => {
                void handleSave('memoryTipEnabled', { memoryTipEnabled: checked });
              }}
            />
          }
        />
        <SettingRow
          icon={BookOpen}
          title="Round 3 听写"
          feedback={feedbackByKey.round2Enabled}
          control={
            <ToggleControl
              checked={preferences.round2Enabled}
              onChange={(checked) => {
                handleReinforcementRoundToggle('round2Enabled', checked);
              }}
            />
          }
        />
        <SettingRow
          icon={BookOpen}
          title="Round 2 回忆"
          feedback={feedbackByKey.reinforcementRound3Enabled}
          control={
            <ToggleControl
              checked={preferences.reinforcementRound3Enabled}
              onChange={(checked) => {
                handleReinforcementRoundToggle('reinforcementRound3Enabled', checked);
              }}
            />
          }
        />
        {ARTICLE_REINFORCEMENT_ENABLED && (
          <SettingRow
            icon={FileText}
            title="文章巩固"
            feedback={feedbackByKey.reinforcementArticleEnabled}
            control={
              <ToggleControl
                checked={preferences.reinforcementArticleEnabled}
                onChange={(checked) => {
                  void handleSave('reinforcementArticleEnabled', { reinforcementArticleEnabled: checked });
                }}
              />
            }
          />
        )}
      </SettingGroup>

      <div className="border-t border-[#eadfcd] pt-4">
        <button
          type="button"
          onClick={() => {
            void handleResetDefaults();
          }}
          disabled={resetFeedback.status === 'saving'}
          className="mx-auto flex min-h-12 items-center justify-center gap-3 rounded-[18px] px-5 text-base font-black text-[#8a7a69] transition-colors hover:bg-[#fff8ec] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {resetFeedback.status === 'saving' ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <RotateCcw className="h-5 w-5" />
          )}
          恢复默认设置
          <StatusPill feedback={resetFeedback} />
        </button>

        {resetFeedback.status === 'error' && resetFeedback.message && (
          <p className="mt-2 text-center text-sm font-bold text-apple-red">{resetFeedback.message}</p>
        )}
      </div>
    </div>
  );
};
