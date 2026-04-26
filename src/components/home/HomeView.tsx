import { motion, useMotionValue, useSpring } from 'motion/react';
import {
  BookOpen,
  CheckCircle2,
  Sparkles,
  Zap,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import type { OrbitDay, OrbitDayStatus, UserStats } from '../../types';
import { LuminaLogo } from '../brand/LuminaLogo';

interface HomeViewProps {
  stats: UserStats;
  onSelectOrbitDate: (date: string) => void;
  onStart: () => void;
  isLoading?: boolean;
}

// --- Internal UI Components ---

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function MagneticButton({ 
  children, 
  onClick, 
  disabled, 
  className 
}: { 
  children: React.ReactNode; 
  onClick: () => void; 
  disabled?: boolean;
  className?: string;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 150, damping: 15 });
  const springY = useSpring(y, { stiffness: 150, damping: 15 });

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set((e.clientX - centerX) * 0.35);
    y.set((e.clientY - centerY) * 0.35);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ x: springX, y: springY }}
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </motion.button>
  );
}

function OrbitMetric({
  value,
  label,
  icon: Icon,
  accent,
}: {
  value: string;
  label: string;
  icon: any;
  accent: 'warm' | 'blue' | 'gold';
}) {
  const tones = {
    warm: {
      card: 'border-white/60 bg-white/40',
      icon: 'text-[#c69442]',
      shadow: 'shadow-[0_12px_24px_-12px_rgba(132,98,48,0.15)]',
    },
    blue: {
      card: 'border-white/60 bg-white/40',
      icon: 'text-[#7b8ea7]',
      shadow: 'shadow-[0_12px_24px_-12px_rgba(88,112,148,0.15)]',
    },
    gold: {
      card: 'border-white/60 bg-white/40',
      icon: 'text-[#c98628]',
      shadow: 'shadow-[0_12px_24px_-12px_rgba(216,158,55,0.15)]',
    },
  }[accent];

  return (
    <div className={cx('home-metric glass flex-1 min-w-[100px] sm:min-w-[110px] rounded-[22px] border p-3 sm:p-4 transition-all hover:bg-white/60 sm:rounded-[26px] xl:p-5', tones.card, tones.shadow)}>
      <div className="flex flex-col sm:flex-row items-start justify-between gap-2 sm:gap-3">
        <div className="order-2 sm:order-1">
          <div className="home-metric-value text-[24px] sm:text-[38px] lg:text-[42px] xl:text-[48px] leading-none font-bold tracking-tight text-[#2f261d] prose-serif">
            {value}
          </div>
          <div className="home-metric-label mt-1.5 text-[10px] leading-tight text-[#7a6c5a] font-medium sm:mt-2.5 sm:text-[12px] xl:mt-3 xl:text-[13px]">{label}</div>
        </div>
        <div className={cx('order-1 sm:order-2 shrink-0 sm:pt-1', tones.icon)}>
          <Icon className="home-metric-icon h-4.5 w-4.5 sm:h-6 sm:w-6 xl:h-7 xl:w-7 opacity-80" strokeWidth={2.2} />
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
      className="home-orbit-badge flex flex-col items-center gap-2 text-center sm:gap-2.5 xl:gap-3"
    >
      <div className="relative">
        <div className={cx(
          'home-orbit-ring relative flex h-[42px] w-[42px] sm:h-[58px] sm:w-[58px] items-center justify-center rounded-full border transition-all duration-500 xl:h-[68px] xl:w-[68px]',
          meta.ringClass,
          active
            ? 'ring-4 ring-[#efc16d]/30 scale-110 shadow-lg shadow-[#efc16d]/20'
            : 'hover:scale-105 hover:shadow-[0_12px_24px_-18px_rgba(76,57,24,0.35)]'
        )}>
          {Icon && <Icon className={cx('home-orbit-icon h-4 w-4 sm:h-5 sm:w-5 xl:h-6 xl:w-6', meta.iconClass)} strokeWidth={2.15} />}
        </div>
      </div>
      <div className="space-y-0.5">
        <div className="text-[9px] sm:text-[10px] font-bold text-[#948572] uppercase tracking-wider xl:text-[11px]">{node.weekdayLabel}</div>
        <div className="text-[9px] sm:text-[10px] tabular-nums text-[#8d7f6b] opacity-60 xl:text-[11px]">{node.shortDateLabel}</div>
      </div>
    </motion.button>
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
    <div
      className={cx(
        'home-routine-step flex items-center gap-4 xl:gap-6',
        status === 'upcoming' && 'opacity-30',
      )}
    >
      <div
        className={cx(
          'home-routine-step-icon flex h-10 w-10 items-center justify-center rounded-full xl:h-11 xl:w-11',
          isCurrent && 'bg-white shadow-sm',
          isCompleted && 'bg-[#eaf8f0] shadow-sm',
          status === 'upcoming' && 'bg-black/5',
        )}
      >
        {isCurrent && <Zap className="h-5 w-5 text-[#cf8922]" />}
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

// --- Main View ---

export const HomeView = ({ stats, onSelectOrbitDate, onStart, isLoading = false }: HomeViewProps) => {
  const routineCard = stats.routineCard;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="home-dashboard mx-auto w-full max-w-[1320px] overflow-x-hidden"
    >
      <header className="home-header mb-4 sm:mb-6 xl:mb-10">
        <LuminaLogo
          size={48}
          className="gap-4 sm:gap-5"
          markClassName="drop-shadow-none"
          wordmarkClassName="h-8 sm:h-10 md:h-11"
        />
      </header>

      <main className="home-dashboard-grid grid items-start gap-6 xl:gap-10 lg:grid-cols-2">
        {/* Left Side: Domain Overview */}
        <motion.section
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="home-panel glass-elevated flex h-full flex-col rounded-[32px] p-5 sm:p-8 xl:rounded-[40px] xl:p-10"
        >
          <div className="mb-6 sm:mb-8 xl:mb-10">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-[#2f261d] prose-serif">
              记忆疆域概览
            </h2>
          </div>

          <div className="home-metrics flex flex-row gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:pb-0 xl:gap-5">
            <OrbitMetric
              value={String(stats.streak)}
              label="连续学习天数"
              icon={Zap}
              accent="warm"
            />
            <OrbitMetric
              value={String(stats.perfectCheckinDays)}
              label="完美打卡天数"
              icon={Sparkles}
              accent="gold"
            />
            <OrbitMetric
              value={String(stats.stableRecallCount)}
              label="已掌握单词数"
              icon={BookOpen}
              accent="blue"
            />
          </div>

          <div className="home-orbit-heading mt-8 sm:mt-10 xl:mt-14">
            <h2 className="text-[16px] sm:text-[20px] font-bold tracking-widest text-[#2f261d] uppercase opacity-40">
              星轨轨迹
            </h2>
          </div>

          <div className="home-orbit-grid mt-4 sm:mt-6 grid grid-cols-7 gap-2 sm:gap-3 xl:mt-8 xl:gap-5">
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

          <div className="home-summary mt-8 sm:mt-10 xl:mt-12">
            <div className="home-summary-card rounded-[22px] sm:rounded-[28px] border border-black/[0.03] bg-black/[0.03] p-4 sm:p-6 xl:rounded-[32px] xl:p-8">
              <div className="grid grid-cols-2 divide-x divide-black/[0.06]">
                <div className="px-2 sm:px-4 text-center">
                  <div className="home-summary-value text-2xl sm:text-4xl font-black tracking-tighter text-[#2f261d] prose-serif xl:text-5xl">
                    {stats.selectedDayReviewWordCount}
                  </div>
                  <div className="mt-1.5 text-[11px] sm:text-[13px] text-[#847563] font-bold uppercase tracking-widest opacity-60">复习单词数</div>
                </div>
                <div className="px-2 sm:px-4 text-center">
                  <div className="home-summary-value text-2xl sm:text-4xl font-black tracking-tighter text-[#2f261d] prose-serif xl:text-5xl">
                    {stats.selectedDayLearnedWordCount}
                  </div>
                  <div className="mt-1.5 text-[11px] sm:text-[13px] text-[#847563] font-bold uppercase tracking-widest opacity-60">新学习单词数</div>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Right Side: Daily Routine */}
        <div className="flex flex-col h-full">
          <div className="relative h-full">
            {/* Stack layers */}
            <div className="absolute inset-0 -right-2 -bottom-2 translate-x-2 translate-y-2 rounded-[32px] border border-black/5 bg-white/20 backdrop-blur-sm xl:-right-3 xl:-bottom-3 xl:translate-x-3 xl:translate-y-3 xl:rounded-[40px]" />
            <div className="absolute inset-0 -right-1 -bottom-1 translate-x-1 translate-y-1 rounded-[32px] border border-black/5 bg-white/40 backdrop-blur-md xl:-right-1.5 xl:-bottom-1.5 xl:translate-x-1.5 xl:translate-y-1.5 xl:rounded-[40px]" />
            
            <motion.section
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              className="home-panel home-routine glass-elevated relative z-10 flex h-full flex-col items-center rounded-[32px] p-5 text-center sm:p-8 xl:rounded-[40px] xl:p-12"
            >
              <div className="w-full text-left">
                <h3 className="text-[11px] sm:text-[13px] font-black tracking-[0.2em] text-[#847562] uppercase opacity-50 xl:text-[14px]">
                  Daily Routine
                </h3>
              </div>

              <div className="home-routine-content flex w-full flex-1 flex-col items-center justify-center py-4 xl:py-8">
                <div className="home-routine-visual relative flex h-36 w-full items-center justify-center sm:h-48 xl:h-56">
                  <div className="absolute h-24 w-40 rounded-full bg-apple-orange/15 blur-[60px] sm:h-32 sm:w-56 xl:h-40 xl:w-64" />
                  <motion.img
                    src="/daily routine logo.webp"
                    alt="Lumina Learning Hero"
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 100, damping: 20 }}
                    className="home-routine-image relative z-10 w-full max-w-[200px] sm:max-w-[300px] object-contain drop-shadow-[0_30px_60px_rgba(110,78,32,0.25)] xl:max-w-[360px]"
                  />
                </div>
                
                <div className="home-routine-copy mt-4 sm:mt-6 xl:mt-8">
                  <h2 className="home-routine-title text-[28px] font-black leading-[1.1] tracking-tight text-[#2f261d] prose-serif sm:text-[34px] md:text-[38px] xl:text-[40px]">
                    {routineCard.title}
                  </h2>
                  <div className="home-routine-subtitle mt-2 text-[12px] font-bold text-[#cf8922] sm:mt-3 xl:mt-4 xl:text-[14px]">
                    {routineCard.subtitle}
                  </div>
                </div>
              </div>

              <div className="home-routine-steps mt-auto w-full space-y-3 rounded-[22px] sm:rounded-[28px] border border-black/[0.02] bg-black/[0.04] p-4 text-left sm:p-5 xl:space-y-5 xl:rounded-[32px] xl:p-7">
                {routineCard.visibleSteps.map((step) => (
                  <RoutineStepRow
                    key={`${step.key}-${step.status}`}
                    label={step.label}
                    status={step.status}
                  />
                ))}
              </div>

              <MagneticButton
                onClick={onStart}
                disabled={isLoading}
                className="home-cta mt-5 flex w-full items-center justify-center rounded-[22px] sm:rounded-[26px] bg-[linear-gradient(180deg,#ffd17f_0%,#ffbf5e_100%)] py-3.5 text-[16px] sm:py-4 sm:text-[18px] font-black text-[#3d2f1c] shadow-[0_20px_40px_-15px_rgba(214,155,49,0.5)] transition-all active:brightness-95 disabled:opacity-50 xl:mt-10 xl:rounded-[30px] xl:py-6 xl:text-[22px]"
              >
                {isLoading ? '准备中...' : routineCard.ctaLabel}
              </MagneticButton>
            </motion.section>
          </div>
        </div>
      </main>
    </motion.div>
  );
};
