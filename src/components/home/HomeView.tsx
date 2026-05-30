import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Icon as IslandIcon, type IconName } from 'animal-island-ui';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Zap,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import type { OfficialLibraryId, OfficialStudyMode, OrbitDay, OrbitDayStatus, UserStats } from '../../types';
import { LuminaLogo } from '../brand/LuminaLogo';

interface HomeViewProps {
  stats: UserStats;
  onSelectOrbitDate: (date: string) => void;
  onStart: (selection?: { libraryId?: OfficialLibraryId | null; mode?: OfficialStudyMode | null }) => void;
  onOpenOfficialLibrary: () => void;
  isLoading?: boolean;
}

// --- Internal UI Components ---

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function OrbitMetric({
  value,
  label,
  icon: Icon,
  accent,
  islandIconName,
}: {
  value: string;
  label: string;
  icon: LucideIcon;
  accent: 'warm' | 'blue' | 'gold';
  islandIconName?: IconName;
}) {
  const tones = {
    warm: {
      card: 'border-white/60 bg-white/40',
      icon: 'text-[#c69442]',
      shadow: 'shadow-[0_12px_24px_-12px_rgba(132,98,48,0.15)]',
      stamp: 'border-[#d7bd72] bg-[#fff1b8] shadow-[#d4b66d]',
    },
    blue: {
      card: 'border-white/60 bg-white/40',
      icon: 'text-[#7b8ea7]',
      shadow: 'shadow-[0_12px_24px_-12px_rgba(88,112,148,0.15)]',
      stamp: 'border-[#91c9bd] bg-[#ddf4ed] shadow-[#88beb2]',
    },
    gold: {
      card: 'border-white/60 bg-white/40',
      icon: 'text-[#c98628]',
      shadow: 'shadow-[0_12px_24px_-12px_rgba(216,158,55,0.15)]',
      stamp: 'border-[#e2b381] bg-[#ffe3c6] shadow-[#d7a274]',
    },
  }[accent];

  return (
    <div
      className={cx(
        'home-metric home-metric-card glass flex-1 min-w-[100px] sm:min-w-[110px] rounded-[22px] border p-3 sm:p-4 transition-all hover:bg-white/60 sm:rounded-[26px] xl:p-5',
        tones.card,
        tones.shadow,
      )}
    >
      <span className="home-ticket-notch home-ticket-notch--left" aria-hidden="true" />
      <span className="home-ticket-notch home-ticket-notch--right" aria-hidden="true" />
      <div className="flex flex-col sm:flex-row items-start justify-between gap-2 sm:gap-3">
        <div className="order-2 sm:order-1">
          <div className="home-metric-value text-[24px] sm:text-[38px] lg:text-[42px] xl:text-[48px] leading-none font-bold tracking-tight text-[#2f261d] prose-serif">
            {value}
          </div>
          <div className="home-metric-label mt-1.5 text-[10px] leading-tight text-[#7a6c5a] font-medium sm:mt-2.5 sm:text-[12px] xl:mt-3 xl:text-[13px]">
            {label}
          </div>
        </div>
        <div
          className={cx(
            'home-metric-stamp order-1 sm:order-2 shrink-0 sm:pt-1',
            islandIconName ? tones.stamp : tones.icon,
          )}
        >
          {islandIconName ? (
            <IslandIcon name={islandIconName} size={32} bounce />
          ) : (
            <Icon className="home-metric-icon h-4.5 w-4.5 sm:h-6 sm:w-6 xl:h-7 xl:w-7 opacity-80" strokeWidth={2.2} />
          )}
        </div>
      </div>
    </div>
  );
}

function OrbitBadge({
  node,
  active,
  index,
  onSelect,
}: {
  node: OrbitDay;
  active: boolean;
  index: number;
  onSelect: () => void;
}) {
  const orbitMeta: Record<OrbitDayStatus, { ringClass: string; icon: LucideIcon | null; iconClass: string }> = {
    ordinary: { ringClass: 'border-white/80 bg-white/60', icon: Zap, iconClass: 'text-[#d1a65b]' },
    shielded: { ringClass: 'border-white/80 bg-[#fbfcff]/60', icon: Shield, iconClass: 'text-[#7b8ea7]' },
    gap: { ringClass: 'border-dashed border-black/10 bg-transparent', icon: null, iconClass: '' },
    perfect: { ringClass: 'border-[#efbf68] bg-[#fff6e2]', icon: Sparkles, iconClass: 'text-[#cf8922]' },
  };
  const meta = orbitMeta[node.status];

  const Icon = meta.icon;

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.05 }}
      className="home-orbit-badge group flex flex-col items-center gap-2 text-center sm:gap-2.5 xl:gap-3"
    >
      <div className="relative">
        <div
          className={cx(
            'home-orbit-ring relative flex h-[42px] w-[42px] sm:h-[58px] sm:w-[58px] items-center justify-center rounded-full border transition-all duration-500 xl:h-[68px] xl:w-[68px]',
            meta.ringClass,
            active
              ? 'ring-4 ring-[#efc16d]/30 scale-110 shadow-lg shadow-[#efc16d]/20'
              : 'hover:scale-105 hover:shadow-[0_12px_24px_-18px_rgba(76,57,24,0.35)]',
          )}
        >
          {Icon && (
            <Icon
              className={cx('home-orbit-icon h-4 w-4 sm:h-5 sm:w-5 xl:h-6 xl:w-6', meta.iconClass)}
              strokeWidth={2.15}
            />
          )}
        </div>
        {active && (
          <span className="home-orbit-flag" aria-hidden="true">
            <span className="home-leaf-shape home-leaf-shape--small" />
          </span>
        )}
      </div>
      <div className="space-y-0.5">
        <div className="text-[9px] sm:text-[10px] font-bold text-[#948572] uppercase tracking-wider xl:text-[11px]">
          {node.weekdayLabel}
        </div>
        <div className="text-[9px] sm:text-[10px] tabular-nums text-[#8d7f6b] opacity-60 xl:text-[11px]">
          {node.shortDateLabel}
        </div>
      </div>
    </motion.button>
  );
}

function SummaryMetric({
  value,
  label,
  iconName,
  tone,
}: {
  value: number;
  label: string;
  iconName: IconName;
  tone: 'review' | 'new';
}) {
  const tones = {
    review: {
      token: 'rotate-[-3deg] border-[#dcc485] bg-[#fff1b8] shadow-[0_5px_0_0_#d0b16e]',
      marker: 'bg-[#e59266]',
    },
    new: {
      token: 'rotate-[3deg] border-[#8fcbbf] bg-[#ddf4ed] shadow-[0_5px_0_0_#8fbfb4]',
      marker: 'bg-[#19c8b9]',
    },
  }[tone];

  return (
    <div className="px-2 text-center sm:px-4">
      <div className="flex min-h-[60px] items-center justify-center gap-2 sm:gap-3 xl:gap-4">
        <div
          className={cx(
            'home-summary-token relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px_15px_20px_14px] border-2 transition-transform duration-200 hover:-translate-y-0.5 sm:h-[54px] sm:w-[54px] xl:h-[62px] xl:w-[62px]',
            tones.token,
          )}
        >
          <span className="absolute left-2 top-2 h-1.5 w-1.5 rounded-full bg-white/75" />
          <span className={cx('absolute right-2 top-2 h-2 w-2 rounded-full ring-2 ring-white/60', tones.marker)} />
          <IslandIcon name={iconName} size={tone === 'review' ? 34 : 36} bounce />
        </div>
        <div className="home-summary-value min-w-[2ch] whitespace-nowrap text-2xl font-black tracking-tighter text-[#2f261d] prose-serif sm:text-4xl xl:text-5xl">
          {value}
        </div>
      </div>
      <div className="mt-1.5 text-[11px] font-bold uppercase tracking-widest text-[#847563] opacity-60 sm:text-[13px]">
        {label}
      </div>
    </div>
  );
}

function RoutineStepRow({
  label,
  status,
}: {
  label: string;
  status: UserStats['routineCard']['visibleSteps'][number]['status'];
}) {
  const isCompleted = status === 'completed';
  const isCurrent = status === 'current';

  return (
    <div className={cx('home-routine-step flex items-center gap-4 xl:gap-6', status === 'upcoming' && 'opacity-30')}>
      <div
        className={cx(
          'home-routine-step-icon flex h-10 w-10 items-center justify-center rounded-full xl:h-11 xl:w-11',
          isCurrent && 'home-routine-step-icon--current',
          isCompleted && 'home-routine-step-icon--completed',
          status === 'upcoming' && 'home-routine-step-icon--upcoming',
        )}
      >
        {isCurrent && <IslandIcon name="icon-miles" size={26} bounce />}
        {isCompleted && <CheckCircle2 className="h-5 w-5 text-[#20a464]" />}
      </div>
      <span
        className={cx(
          'text-[15px] xl:text-[17px]',
          isCurrent && 'font-bold text-[#2f261d]',
          isCompleted && 'font-bold text-[#2f261d]',
          status === 'upcoming' && 'font-medium text-[#2f261d]',
        )}
      >
        {label}
      </span>
    </div>
  );
}

interface RoutineDropdownOption<T extends string> {
  value: T;
  label: string;
}

function RoutineDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  footerAction,
  disabled = false,
  className = '',
}: {
  label: string;
  value: T;
  options: RoutineDropdownOption<T>[];
  onChange: (value: T) => void;
  footerAction?: {
    label: string;
    onSelect: () => void;
  };
  disabled?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null;

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  return (
    <div ref={rootRef} className={cx('relative min-w-0', className)}>
      <span className="sr-only">{label}</span>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cx(
          'group flex h-11 w-full items-center justify-between gap-2 rounded-[17px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,250,238,0.88))] px-4 text-left text-sm font-black text-[#5b4932] shadow-[0_10px_24px_rgba(90,70,42,0.10),inset_0_-2px_0_rgba(149,117,68,0.08)] outline-none transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_14px_30px_rgba(90,70,42,0.13),inset_0_-2px_0_rgba(149,117,68,0.08)] focus-visible:ring-4 focus-visible:ring-[#f1c45d]/25 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 sm:h-12',
          isOpen && 'border-[#e2c982] ring-4 ring-[#f1c45d]/18',
        )}
      >
        <span className="min-w-0 truncate">{selectedOption?.label ?? label}</span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f6edda] text-[#9b7a45] transition-transform group-hover:bg-[#f1e0bb]">
          <ChevronDown className={cx('h-4 w-4 transition-transform duration-200', isOpen && 'rotate-180')} />
        </span>
      </button>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.14 }}
          className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-30 overflow-hidden rounded-[18px] border border-white/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,250,239,0.96))] p-1.5 text-left shadow-[0_18px_40px_rgba(72,55,29,0.18)] backdrop-blur-xl"
        >
          <div role="listbox">
            {options.map((option) => {
              const isSelected = option.value === selectedOption?.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={cx(
                    'flex h-10 w-full items-center justify-between gap-3 rounded-[13px] px-3 text-sm font-black text-[#5b4932] transition-colors hover:bg-[#fff2cf] focus-visible:bg-[#fff2cf] focus-visible:outline-none',
                    isSelected && 'bg-[#fff0c2] text-[#2f261d]',
                  )}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {isSelected && <CheckCircle2 className="h-4 w-4 shrink-0 text-[#cf8922]" />}
                </button>
              );
            })}
          </div>
          {footerAction && (
            <div className="mt-1 border-t border-[#eadcc2]/70 pt-1">
              <button
                type="button"
                onClick={() => {
                  footerAction.onSelect();
                  setIsOpen(false);
                }}
                className="flex h-10 w-full items-center justify-between gap-3 rounded-[13px] px-3 text-sm font-black text-[#5b4932] transition-colors hover:bg-[#fff2cf] focus-visible:bg-[#fff2cf] focus-visible:outline-none"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <BookOpen className="h-4 w-4 shrink-0 text-[#9b7a45]" />
                  <span className="min-w-0 truncate">{footerAction.label}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#9b7a45]" />
              </button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

// --- Main View ---

export const HomeView = ({
  stats,
  onSelectOrbitDate,
  onStart,
  onOpenOfficialLibrary,
  isLoading = false,
}: HomeViewProps) => {
  const routineCard = stats.routineCard;
  const officialOptions = routineCard.officialLibraryOptions ?? [];
  const shouldShowOfficialControls = officialOptions.length > 0 || routineCard.ctaMode === 'start_learning';
  const defaultLibraryId = routineCard.selectedOfficialLibraryId ?? officialOptions[0]?.libraryId ?? '';
  const libraryDropdownOptions = useMemo(
    () =>
      officialOptions.map((option) => ({
        value: option.libraryId,
        label: option.title,
      })),
    [officialOptions],
  );
  const modeDropdownOptions = useMemo<RoutineDropdownOption<OfficialStudyMode>[]>(
    () => [
      { value: 'sequential', label: '顺序' },
      { value: 'shuffle', label: '乱序' },
    ],
    [],
  );
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>(defaultLibraryId);
  const selectedOfficialOption = useMemo(
    () => officialOptions.find((option) => option.libraryId === selectedLibraryId) ?? officialOptions[0] ?? null,
    [officialOptions, selectedLibraryId],
  );
  const [selectedMode, setSelectedMode] = useState<OfficialStudyMode>(routineCard.lastUsedOfficialMode ?? 'sequential');
  const hasUserSelectedModeRef = useRef(false);
  const isModeSelectionLocked = Boolean(selectedOfficialOption?.activeGroupId);
  const displayedMode = isModeSelectionLocked ? (selectedOfficialOption?.mode ?? selectedMode) : selectedMode;

  useEffect(() => {
    if (officialOptions.length === 0) {
      setSelectedLibraryId('');
      return;
    }

    if (!officialOptions.some((option) => option.libraryId === selectedLibraryId)) {
      setSelectedLibraryId(defaultLibraryId);
    }
  }, [defaultLibraryId, officialOptions, selectedLibraryId]);

  useEffect(() => {
    if (!hasUserSelectedModeRef.current && routineCard.lastUsedOfficialMode) {
      setSelectedMode(routineCard.lastUsedOfficialMode);
    }
  }, [routineCard.lastUsedOfficialMode]);

  const handleModeChange = (mode: OfficialStudyMode) => {
    hasUserSelectedModeRef.current = true;
    setSelectedMode(mode);
  };

  const handleStart = () => {
    onStart(
      selectedOfficialOption
        ? {
            libraryId: selectedOfficialOption.libraryId,
            mode: selectedMode,
          }
        : undefined,
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="home-dashboard relative mx-auto w-full max-w-[1320px] overflow-x-hidden"
    >
      <div className="home-island-decor pointer-events-none absolute inset-0 z-0 hidden lg:block" aria-hidden="true">
        <span className="home-island-decor-piece home-island-decor-piece--leaf">
          <span className="home-leaf-shape" />
        </span>
        <span className="home-island-decor-piece home-island-decor-piece--map">
          <IslandIcon name="icon-map" size={48} />
        </span>
        <span className="home-island-decor-piece home-island-decor-piece--chat">
          <IslandIcon name="icon-chat" size={54} />
        </span>
      </div>

      <header className="home-header relative z-10 mb-4 sm:mb-6 xl:mb-10">
        <LuminaLogo
          size={48}
          className="gap-4 sm:gap-5"
          markClassName="drop-shadow-none"
          wordmarkClassName="h-8 sm:h-10 md:h-11"
        />
      </header>

      <main className="home-dashboard-grid relative z-10 grid items-start gap-8 xl:gap-12 lg:grid-cols-2">
        {/* Left Side: Domain Overview */}
        <motion.section
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="home-panel flex min-w-0 flex-col px-1 pb-3 pt-5 sm:px-3 sm:pb-5 sm:pt-7 xl:px-4 xl:pt-9"
        >
          <div className="home-metrics flex flex-row gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:pb-0 xl:gap-5">
            <OrbitMetric
              value={String(stats.streak)}
              label="连续学习天数"
              icon={Zap}
              accent="warm"
              islandIconName="icon-miles"
            />
            <OrbitMetric
              value={String(stats.perfectCheckinDays)}
              label="完成计划天数"
              icon={Sparkles}
              accent="gold"
              islandIconName="icon-critterpedia"
            />
            <OrbitMetric
              value={String(stats.stableRecallCount)}
              label="已掌握单词数"
              icon={BookOpen}
              accent="blue"
              islandIconName="icon-map"
            />
          </div>

          <div className="home-orbit-heading mt-7 sm:mt-9 xl:mt-12">
            <h2 className="inline-flex items-center gap-2 text-[16px] sm:text-[20px] font-bold tracking-widest text-[#2f261d] uppercase opacity-40">
              <span className="home-leaf-shape home-leaf-shape--heading" aria-hidden="true" />
              学习记录
            </h2>
          </div>

          <div className="home-orbit-map relative mt-4 sm:mt-5 xl:mt-7">
            <span className="home-orbit-dotted-trail" aria-hidden="true" />
            <div className="home-orbit-grid relative z-10 grid grid-cols-7 gap-2 sm:gap-3 xl:gap-5">
              {stats.orbitDays.map((node, index) => (
                <OrbitBadge
                  key={node.date}
                  node={node}
                  active={node.date === stats.selectedDate}
                  index={index}
                  onSelect={() => onSelectOrbitDate(node.date)}
                />
              ))}
            </div>
          </div>

          <div className="home-summary mt-7 sm:mt-9 xl:mt-10">
            <div className="home-summary-card home-summary-ticket rounded-[22px] sm:rounded-[28px] border border-black/[0.03] bg-black/[0.03] p-4 sm:p-6 xl:rounded-[32px] xl:p-8">
              <span className="home-summary-pin home-summary-pin--left" aria-hidden="true" />
              <span className="home-summary-pin home-summary-pin--right" aria-hidden="true" />
              <div className="grid grid-cols-2 divide-x divide-black/[0.06]">
                <SummaryMetric
                  value={stats.selectedDayReviewWordCount}
                  label="复习单词数"
                  iconName="icon-variant"
                  tone="review"
                />
                <SummaryMetric
                  value={stats.selectedDayLearnedWordCount}
                  label="新学习单词数"
                  iconName="icon-diy"
                  tone="new"
                />
              </div>
            </div>
          </div>
        </motion.section>

        {/* Right Side: Daily Routine */}
        <motion.section
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="home-panel home-routine flex min-w-0 flex-col items-center px-1 pb-3 pt-4 text-center sm:px-3 sm:pb-5 sm:pt-6 xl:px-4 xl:pt-8"
        >
          <div className="home-routine-content flex w-full flex-col items-center pb-4 pt-1 sm:pt-2 xl:pb-5 xl:pt-3">
            <div className="home-routine-visual relative flex h-40 w-full items-center justify-center sm:h-52 xl:h-60">
              <div className="absolute bottom-5 h-14 w-52 rounded-[50%] bg-[#d6c6a8]/45 sm:h-20 sm:w-72 xl:w-80" />
              <IslandIcon
                name="icon-helicopter"
                size={64}
                className="home-routine-float home-routine-float--helicopter"
                bounce
              />
              <IslandIcon
                name="icon-shopping"
                size={46}
                className="home-routine-float home-routine-float--bag"
                bounce
              />
              <motion.img
                src="/daily routine logo.webp"
                alt="Lumina Learning Hero"
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                className="home-routine-image relative z-10 w-full max-w-[200px] sm:max-w-[300px] object-contain drop-shadow-[0_30px_60px_rgba(110,78,32,0.25)] xl:max-w-[360px]"
              />
            </div>

            <div className="home-routine-copy mt-3 sm:mt-4 xl:mt-5">
              <h2 className="home-routine-title text-[28px] font-black leading-[1.1] tracking-tight text-[#2f261d] prose-serif sm:text-[34px] md:text-[38px] xl:text-[40px]">
                {routineCard.title}
              </h2>
              {shouldShowOfficialControls ? (
                <div className="mt-3 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row xl:mt-4">
                  {officialOptions.length > 0 ? (
                    <RoutineDropdown
                      label="选择已学习官方词库"
                      value={(selectedOfficialOption?.libraryId ?? '') as OfficialLibraryId}
                      options={libraryDropdownOptions}
                      onChange={setSelectedLibraryId}
                      footerAction={{
                        label: '去官方词库挑选并加入',
                        onSelect: onOpenOfficialLibrary,
                      }}
                      className="flex-1 sm:min-w-[15rem]"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={onOpenOfficialLibrary}
                      className="relative flex h-11 min-w-0 flex-1 items-center rounded-[17px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,250,238,0.88))] px-4 pr-10 text-left text-sm font-black text-[#5b4932] shadow-[0_10px_24px_rgba(90,70,42,0.10),inset_0_-2px_0_rgba(149,117,68,0.08)] outline-none transition-all hover:-translate-y-0.5 hover:bg-white focus-visible:ring-4 focus-visible:ring-[#f1c45d]/25 sm:h-12 sm:min-w-[15rem]"
                      aria-haspopup="listbox"
                    >
                      <span className="min-w-0 truncate">去官方词库挑选并加入</span>
                      <span className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[#f6edda] text-[#9b7a45]">
                        <ChevronDown className="h-4 w-4" />
                      </span>
                    </button>
                  )}
                  <RoutineDropdown
                    label="选择发放顺序"
                    value={displayedMode}
                    options={modeDropdownOptions}
                    onChange={handleModeChange}
                    disabled={officialOptions.length === 0 || isModeSelectionLocked}
                    className="sm:w-[9.5rem]"
                  />
                </div>
              ) : (
                <div className="home-routine-subtitle mt-2 text-[12px] font-bold text-[#cf8922] sm:mt-3 xl:mt-4 xl:text-[14px]">
                  {routineCard.subtitle}
                </div>
              )}
            </div>
          </div>

          <div className="home-routine-steps mt-2 w-full space-y-3 rounded-[22px] border border-black/[0.02] bg-black/[0.04] p-4 text-left sm:mt-3 sm:rounded-[28px] sm:p-5 xl:mt-4 xl:space-y-5 xl:rounded-[32px] xl:p-7">
            {routineCard.visibleSteps.map((step) => (
              <RoutineStepRow key={`${step.key}-${step.status}`} label={step.label} status={step.status} />
            ))}
          </div>

          <button
            onClick={handleStart}
            disabled={isLoading}
            className="home-cta relative mt-5 flex w-full items-center justify-center overflow-hidden rounded-[26px] border-2 border-[#ffcc00] bg-[#ffcc00] py-3.5 text-[16px] font-black text-[#3d2f1c] shadow-[0_6px_0_0_#e0b800] transition-all hover:brightness-105 active:translate-y-1 active:shadow-[0_2px_0_0_#e0b800] disabled:opacity-50 sm:py-4 sm:text-[18px] xl:mt-10 xl:rounded-[30px] xl:py-6 xl:text-[22px]"
          >
            {isLoading ? '准备中...' : routineCard.ctaLabel}
          </button>
        </motion.section>
      </main>
    </motion.div>
  );
};
