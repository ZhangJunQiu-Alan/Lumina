import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Clock3,
  Compass,
  MoonStar,
  RotateCcw,
  Shield,
  Sparkles,
  X,
} from 'lucide-react';

type DayState = 'surge' | 'steady' | 'shielded' | 'return' | 'gap' | 'today';
type RouteKind = 'review' | 'resume' | 'explore';
type RouteStatus = 'done' | 'active' | 'queued';

interface DayNode {
  day: number;
  date: string;
  weekday: string;
  state: DayState;
  title: string;
  note: string;
  micro: string;
}

interface RouteBlock {
  id: RouteKind;
  order: string;
  title: string;
  summary: string;
  duration: string;
  reason: string;
  outcome: string;
  status: RouteStatus;
}

interface RailPoint {
  x: number;
  y: number;
}

const DAYS: DayNode[] = [
  {
    day: 10,
    date: '04.08',
    weekday: '周二',
    state: 'steady',
    title: '忙的一天，但没有掉线',
    note: '那晚只做了一个复习块。轨迹没有大亮，但它明确地往前挪了一格。',
    micro: '8 分钟 · 1 个有效 block',
  },
  {
    day: 11,
    date: '04.09',
    weekday: '周三',
    state: 'surge',
    title: '完整推进的一次深亮日',
    note: '复习、继续、新内容都做完了。那种“今天收得很干净”的感觉会留在轨迹上。',
    micro: '26 分钟 · 3 个 block',
  },
  {
    day: 12,
    date: '04.10',
    weekday: '周四',
    state: 'steady',
    title: '节奏被压缩，但没有消失',
    note: '加班把计划切碎了，系统只保留最必要的一步，让这一天仍然被记录成前进。',
    micro: '11 分钟 · 复习优先',
  },
  {
    day: 13,
    date: '04.11',
    weekday: '周五',
    state: 'surge',
    title: '状态回来之后，亮度会很明显',
    note: '这一天推进了两块核心内容，光轨会直接告诉你“你不是在原地转”。',
    micro: '22 分钟 · 2 个主 block',
  },
  {
    day: 14,
    date: '04.12',
    weekday: '周六',
    state: 'gap',
    title: '留白，不被伪装成失败',
    note: '那天没有学习，也没有补写借口。轨迹只是诚实地空了一格。',
    micro: '空白日',
  },
  {
    day: 15,
    date: '04.13',
    weekday: '周日',
    state: 'return',
    title: '重新接上，而不是追昨天的债',
    note: '第二天先做复习，系统把这个节点记成一次回归，而不是一次补课。',
    micro: '回归日 · 先做复习',
  },
  {
    day: 16,
    date: '04.14',
    weekday: '周一',
    state: 'surge',
    title: '节奏重建成功',
    note: '回归后很快就接回了熟悉的强度，这种“重新稳定”应该被看见。',
    micro: '24 分钟 · 轨迹重新增亮',
  },
  {
    day: 17,
    date: '04.15',
    weekday: '周二',
    state: 'shielded',
    title: '被静静守住的一天',
    note: '出差当晚没打开应用，连续感由系统自动保护，没有要求你做任何额外动作。',
    micro: '自动保护 · 1 次额度',
  },
  {
    day: 18,
    date: '04.16',
    weekday: '周三',
    state: 'steady',
    title: '短一些，也算前进',
    note: '只收了一个快复习块。不是每一天都要闪耀，但每一天都可以有一个入口。',
    micro: '9 分钟 · 轻推进',
  },
  {
    day: 19,
    date: '04.17',
    weekday: '周四',
    state: 'surge',
    title: '新内容被顺利接进来了',
    note: '系统把前面的旧内容收完之后，才打开新一组，这让路线看起来非常顺。',
    micro: '27 分钟 · 新学习开启',
  },
  {
    day: 20,
    date: '04.18',
    weekday: '周五',
    state: 'steady',
    title: '稳定，不需要被包装成狂热',
    note: '这一天没有满格，但它依然给轨迹贡献了可靠的亮度。',
    micro: '12 分钟 · 维持手感',
  },
  {
    day: 21,
    date: '04.19',
    weekday: '周六',
    state: 'surge',
    title: '一口气推进了三段路线',
    note: '周末的连续时间让路线一次性收得很干净，节点会比平常更亮。',
    micro: '31 分钟 · 3 个 block',
  },
  {
    day: 22,
    date: '04.20',
    weekday: '周日',
    state: 'surge',
    title: '昨天把今天变简单了',
    note: '完整结束一天，意味着今天打开首页时，系统能直接给你更明确的下一步。',
    micro: '28 分钟 · 高完成度',
  },
  {
    day: 23,
    date: '04.21',
    weekday: '周二',
    state: 'today',
    title: '今天的入口已经对齐',
    note: '首页先告诉你：你已经走到了第 23 天。然后再把“继续昨天的会话”放到最前面。',
    micro: '下一步 · 继续块',
  },
];

const TRAIL_POINTS: RailPoint[] = [
  { x: 52, y: 126 },
  { x: 128, y: 90 },
  { x: 206, y: 112 },
  { x: 284, y: 72 },
  { x: 364, y: 138 },
  { x: 444, y: 118 },
  { x: 520, y: 82 },
  { x: 600, y: 108 },
  { x: 680, y: 96 },
  { x: 760, y: 66 },
  { x: 840, y: 102 },
  { x: 920, y: 74 },
  { x: 998, y: 92 },
  { x: 1078, y: 70 },
];

const ROUTE_BLOCKS: RouteBlock[] = [
  {
    id: 'review',
    order: '01',
    title: '先回收今天到期的复习',
    summary: '把已经开始松动的记忆先捞起来，避免后面的路线带着噪音往前走。',
    duration: '约 9 分钟',
    reason: '今天有 3 组到期复习',
    outcome: '完成后，今天的轨迹会先亮起第一格。',
    status: 'done',
  },
  {
    id: 'resume',
    order: '02',
    title: '接回昨天停在一半的会话',
    summary: '不是重新开始，而是把昨晚已经进入状态的那段直接接上。',
    duration: '约 6 分钟',
    reason: '昨晚停在 C 组 Round 3',
    outcome: '这是现在最短、最顺手的入口。',
    status: 'active',
  },
  {
    id: 'explore',
    order: '03',
    title: '只有前两项清空后，才打开新内容',
    summary: '新学习被放在最后，不让首页把用户推向一种“永远开新坑”的节奏。',
    duration: '约 18 分钟',
    reason: '前两项完成后再解锁',
    outcome: '今天还有余力时，再把轨迹继续推远一点。',
    status: 'queued',
  },
];

const DAY_STATE_META: Record<
  DayState,
  {
    label: string;
    chipClass: string;
    dotClass: string;
    glowClass?: string;
  }
> = {
  surge: {
    label: '深亮日',
    chipClass: 'border-[#d7b16c]/30 bg-[#d7b16c]/10 text-[#f5d7a4]',
    dotClass:
      'h-4 w-4 bg-[#f5d7a4] shadow-[0_0_20px_rgba(243,201,123,0.4)] ring-1 ring-[#f7e4bc]/60',
    glowClass:
      'bg-[radial-gradient(circle,rgba(243,201,123,0.3)_0%,rgba(243,201,123,0.1)_48%,transparent_74%)]',
  },
  steady: {
    label: '稳步日',
    chipClass: 'border-[#cabfb2]/20 bg-white/[0.05] text-[#e9e0d3]',
    dotClass:
      'h-3.5 w-3.5 bg-[#e9e0d3] shadow-[0_0_12px_rgba(236,227,213,0.25)] ring-1 ring-white/40',
  },
  shielded: {
    label: '保护日',
    chipClass: 'border-[#8f98ab]/20 bg-[#8f98ab]/10 text-[#bcc4d4]',
    dotClass:
      'h-3.5 w-3.5 bg-[#95a0b4] shadow-[0_0_12px_rgba(124,136,160,0.2)] ring-1 ring-[#d7deeb]/20',
  },
  return: {
    label: '回归日',
    chipClass: 'border-[#b8c1cf]/20 bg-[#b8c1cf]/10 text-[#dbe1eb]',
    dotClass:
      'h-3.5 w-3.5 bg-[#d9e0eb] shadow-[0_0_12px_rgba(209,219,232,0.2)] ring-1 ring-white/25',
  },
  gap: {
    label: '留白日',
    chipClass: 'border-white/10 bg-white/[0.03] text-white/62',
    dotClass: 'h-4 w-4 border border-dashed border-white/16 bg-transparent',
  },
  today: {
    label: '今天',
    chipClass: 'border-[#f0dfbf]/25 bg-[#f0dfbf]/10 text-[#fff3de]',
    dotClass:
      'h-4 w-4 bg-[#fff4df] shadow-[0_0_22px_rgba(245,221,176,0.5)] ring-1 ring-[#fff7eb]/65',
    glowClass:
      'bg-[radial-gradient(circle,rgba(255,236,201,0.36)_0%,rgba(255,236,201,0.1)_50%,transparent_74%)]',
  },
};

const ROUTE_META: Record<
  RouteKind,
  {
    icon: typeof RotateCcw;
    eyebrow: string;
    iconClass: string;
  }
> = {
  review: {
    icon: RotateCcw,
    eyebrow: 'REVIEW',
    iconClass:
      'border-[#d9ba80]/25 bg-[#d9ba80]/10 text-[#f0d3a0] shadow-[0_16px_36px_-18px_rgba(217,186,128,0.45)]',
  },
  resume: {
    icon: BookOpen,
    eyebrow: 'RESUME',
    iconClass:
      'border-[#dfe7f4]/18 bg-white/[0.06] text-[#f4ede2] shadow-[0_18px_34px_-20px_rgba(255,255,255,0.3)]',
  },
  explore: {
    icon: Sparkles,
    eyebrow: 'EXPLORE',
    iconClass:
      'border-[#9ea8bc]/18 bg-[#9ea8bc]/10 text-[#dbe4f5] shadow-[0_16px_30px_-18px_rgba(158,168,188,0.35)]',
  },
};

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function TriggerChip({
  icon: Icon,
  label,
}: {
  icon: typeof Compass;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium tracking-[0.12em] text-white/68 uppercase backdrop-blur-xl">
      <Icon className="h-3.5 w-3.5 text-[#f2d29c]" strokeWidth={1.8} />
      <span>{label}</span>
    </div>
  );
}

function TrailNode({
  node,
  point,
  index,
  selected,
  onSelect,
}: {
  node: DayNode;
  point: RailPoint;
  index: number;
  selected: boolean;
  onSelect: (day: number) => void;
}) {
  const meta = DAY_STATE_META[node.state];
  const isGap = node.state === 'gap';
  const isToday = node.state === 'today';

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12 + index * 0.04, duration: 0.45, ease: 'easeOut' }}
      className="absolute"
      style={{ left: point.x, top: point.y }}
    >
      {isToday && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="absolute -top-11 left-1/2 -translate-x-1/2 rounded-full border border-[#f0dfbf]/20 bg-[#f0dfbf]/10 px-3 py-1 text-[10px] font-semibold tracking-[0.18em] text-[#fff0d2] uppercase"
        >
          Today
        </motion.div>
      )}

      <motion.button
        type="button"
        onClick={() => onSelect(node.day)}
        aria-pressed={selected}
        whileHover={{ y: -2, scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={cx(
          'group relative -translate-x-1/2 -translate-y-1/2 rounded-[24px] border px-3 py-3 transition-all duration-300',
          selected
            ? 'border-white/18 bg-white/[0.07] shadow-[0_22px_60px_-28px_rgba(0,0,0,0.85)]'
            : 'border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.035]',
        )}
      >
        <div className="relative flex h-14 w-14 items-center justify-center">
          {meta.glowClass && (
            <motion.div
              className={cx('absolute inset-0 rounded-full blur-sm', meta.glowClass)}
              animate={{ opacity: isToday ? [0.65, 1, 0.65] : [0.45, 0.82, 0.45] }}
              transition={{ duration: isToday ? 2.6 : 3.4, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}

          {isToday && (
            <motion.div
              className="absolute inset-[6px] rounded-full border border-[#fff0d0]/32"
              animate={{ scale: [1, 1.16, 1], opacity: [0.8, 0.25, 0.8] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
            />
          )}

          <div
            className={cx(
              'relative rounded-full transition-all duration-300',
              meta.dotClass,
              !isGap && 'group-hover:scale-110',
            )}
          />
        </div>
      </motion.button>

      <div className="pointer-events-none absolute left-1/2 top-12 flex w-18 -translate-x-1/2 flex-col items-center gap-1 text-center">
        <span className="text-[10px] font-medium tracking-[0.16em] text-white/48 uppercase">
          {node.weekday}
        </span>
        <span
          className={cx(
            'text-[12px] tabular-nums',
            selected || isToday ? 'text-[#f6efe2]' : 'text-white/62',
          )}
        >
          {node.date}
        </span>
      </div>
    </motion.div>
  );
}

function RouteCard({
  block,
  selected,
  onSelect,
}: {
  block: RouteBlock;
  selected: boolean;
  onSelect: (id: RouteKind) => void;
}) {
  const meta = ROUTE_META[block.id];
  const Icon = meta.icon;
  const statusLabel =
    block.status === 'done' ? '已完成' : block.status === 'active' ? '当前入口' : '排队中';

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(block.id)}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      className={cx(
        'w-full rounded-[28px] border p-5 text-left transition-all duration-300',
        selected
          ? 'border-[#f0d9ab]/22 bg-[#151821] shadow-[0_32px_70px_-46px_rgba(0,0,0,0.9)]'
          : 'border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.045]',
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cx(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border',
            meta.iconClass,
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={1.9} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold tracking-[0.16em] text-white/44 uppercase">
            <span>{meta.eyebrow}</span>
            <span className="h-1 w-1 rounded-full bg-white/18" />
            <span>{block.order}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[9px] text-white/62">
              {statusLabel}
            </span>
          </div>

          <div className="mt-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-[20px] font-semibold leading-tight text-[#f7efe0]">
                {block.title}
              </h3>
              <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/62">
                {block.summary}
              </p>
            </div>
            <ChevronRight
              className={cx(
                'mt-1 h-5 w-5 shrink-0 transition-transform duration-300',
                selected ? 'translate-x-1 text-[#f2d19a]' : 'text-white/28',
              )}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-white/66">
              {block.duration}
            </span>
            <span className="rounded-full border border-[#f0d9ab]/12 bg-[#f0d9ab]/8 px-3 py-1 text-[11px] text-[#ebd7b5]">
              {block.reason}
            </span>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

function PauseGrantModal({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#020305]/72 px-5 backdrop-blur-md"
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-[520px] overflow-hidden rounded-[32px] border border-white/10 bg-[#0f1219] p-7 text-[#f8f1e6] shadow-[0_42px_120px_-40px_rgba(0,0,0,0.92)]"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              'radial-gradient(circle at 20% 20%, rgba(242,210,156,0.16) 0%, transparent 38%), radial-gradient(circle at 100% 0%, rgba(180,192,217,0.14) 0%, transparent 34%)',
          }}
        />

        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-5 top-5 rounded-full border border-white/8 bg-white/[0.04] p-2 text-white/52 transition-colors hover:text-white/82"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative">
          <div className="flex h-14 w-14 items-center justify-center rounded-[20px] border border-[#f0d9ab]/18 bg-[#f0d9ab]/10 text-[#f1d098] shadow-[0_24px_48px_-24px_rgba(240,217,171,0.42)]">
            <MoonStar className="h-6 w-6" strokeWidth={1.8} />
          </div>

          <p className="mt-6 text-[11px] font-semibold tracking-[0.18em] text-white/44 uppercase">
            Quiet Permission
          </p>
          <h2
            className="mt-3 text-[32px] leading-[1.08] text-[#fcf5e8]"
            style={{
              fontFamily:
                '"Iowan Old Style", "Baskerville", "Songti SC", "Noto Serif CJK SC", serif',
            }}
          >
            今晚可以慢一点。
          </h2>

          <p className="mt-4 text-[15px] leading-relaxed text-white/68">
            你已经连续推进了 5 天。Lumina 不想把这种节奏再包装成压力，所以这次我们先把一张静默保护放到你手里。
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-white/56">
            如果今晚想停在这里，也没关系。轨迹不会因为休息而把你从路上抹掉。
          </p>

          <div className="mt-7 flex flex-col gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-[#f0d9ab] px-5 py-3 text-[14px] font-semibold text-[#161719] transition-transform hover:scale-[1.01] active:scale-[0.99]"
            >
              收下这次保护
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-[14px] text-white/74 transition-colors hover:text-white"
            >
              我还想再推进一块
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ReturnToast({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.96 }}
      className="fixed bottom-6 right-6 z-40 w-[min(420px,calc(100vw-1.5rem))] rounded-[28px] border border-white/10 bg-[#11141d]/96 p-5 text-[#f7efe0] shadow-[0_40px_100px_-42px_rgba(0,0,0,1)] backdrop-blur-xl"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-[#cbd4e2]/14 bg-[#cbd4e2]/10 text-[#dde6f2]">
          <Shield className="h-5 w-5" strokeWidth={1.8} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-white/42 uppercase">
            Return Logged
          </p>
          <h3 className="mt-2 text-[18px] font-semibold text-[#f7efe0]">你回来了。</h3>
          <p className="mt-2 text-[13.5px] leading-relaxed text-white/64">
            那个空缺不会被改写成胜利，但它会被记成一次重新接上。Lumina 记的是回归，不是欠账。
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-white/40 transition-colors hover:text-white/78"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
}

export function LightRailDemo() {
  const [selectedDay, setSelectedDay] = useState(DAYS[DAYS.length - 1].day);
  const [selectedRoute, setSelectedRoute] = useState<RouteKind>('resume');
  const [showPause, setShowPause] = useState(false);
  const [showReturn, setShowReturn] = useState(false);

  const currentDay = DAYS.find((day) => day.day === selectedDay) ?? DAYS[DAYS.length - 1];
  const currentRoute =
    ROUTE_BLOCKS.find((block) => block.id === selectedRoute) ?? ROUTE_BLOCKS[1];
  const currentDayMeta = DAY_STATE_META[currentDay.state];
  const currentRouteMeta = ROUTE_META[currentRoute.id];
  const railPoints = TRAIL_POINTS.map((point, index) => ({ point, node: DAYS[index] }));
  const trailPolyline = TRAIL_POINTS.map(({ x, y }) => `${x},${y}`).join(' ');
  const lastPoint = TRAIL_POINTS[TRAIL_POINTS.length - 1];
  const futureTrailPath = `M ${lastPoint.x} ${lastPoint.y} Q ${lastPoint.x + 72} ${
    lastPoint.y - 36
  } ${lastPoint.x + 152} ${lastPoint.y - 12}`;
  const focusStates = DAYS.filter((day) => day.state === 'surge').length;
  const steadyStates = DAYS.filter((day) => day.state === 'steady').length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#04050a] text-[#f8f0e4]">
      <div className="absolute inset-0 bg-[#04050a]" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 12% 14%, rgba(242,210,156,0.14) 0%, transparent 28%), radial-gradient(circle at 82% 10%, rgba(140,160,196,0.14) 0%, transparent 26%), radial-gradient(circle at 50% 100%, rgba(80,94,128,0.18) 0%, transparent 34%), linear-gradient(180deg, #0a0d14 0%, #06080d 46%, #030407 100%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.45) 1px, transparent 1px)',
          backgroundSize: '96px 96px',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.9) 0 1px, transparent 1.4px), radial-gradient(circle at 80% 18%, rgba(255,255,255,0.6) 0 1px, transparent 1.4px), radial-gradient(circle at 66% 72%, rgba(255,255,255,0.7) 0 1px, transparent 1.6px)',
        }}
      />

      <div className="relative mx-auto max-w-[1240px] px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-[#f0d9ab]/18 bg-[#f0d9ab]/10 shadow-[0_20px_40px_-24px_rgba(240,217,171,0.45)]">
              <Sparkles className="h-5 w-5 text-[#f1d19b]" strokeWidth={1.9} />
            </div>
            <div>
              <div className="text-[14px] font-semibold tracking-[0.18em] text-white/88 uppercase">
                Lumina
              </div>
              <div className="mt-1 text-[12px] text-white/46">Lightrail home demo</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TriggerChip icon={Compass} label="Orbit-first home" />
            <TriggerChip icon={Shield} label="1 guard left" />
          </div>
        </motion.header>

        <main className="mt-10 flex flex-col gap-6 lg:gap-8">
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_360px]">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08, duration: 0.55 }}
              className="rounded-[36px] border border-white/10 bg-white/[0.03] p-6 shadow-[0_44px_120px_-56px_rgba(0,0,0,1)] backdrop-blur-2xl sm:p-8"
            >
              <p className="text-[11px] font-semibold tracking-[0.2em] text-white/42 uppercase">
                2026.04.21 / Tue / Home Orientation
              </p>

              <h1
                className="mt-5 max-w-4xl text-[48px] leading-[0.96] tracking-[-0.03em] text-[#fcf5e8] sm:text-[64px] lg:text-[78px]"
                style={{
                  fontFamily:
                    '"Iowan Old Style", "Baskerville", "Songti SC", "Noto Serif CJK SC", serif',
                }}
              >
                第 23 天，
                <br />
                轨迹还亮着。
              </h1>

              <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-white/64 sm:text-[17px]">
                这个首页不先问候，也不先摆任务数。它先告诉用户：你已经走到了这里。然后才把今晚最值得开始的那一步，推到眼前。
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[13px] text-white/74">
                  14 天视窗里已有 <span className="text-[#fff0d0]">12 次推进</span>
                </div>
                <div className="rounded-full border border-[#f0d9ab]/15 bg-[#f0d9ab]/8 px-4 py-2 text-[13px] text-[#ebd7b5]">
                  首页第一优先级是轨迹，不是待办数量
                </div>
              </div>
            </motion.div>

            <motion.aside
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16, duration: 0.55 }}
              className="overflow-hidden rounded-[36px] border border-white/10 bg-[#0f1218]/88 p-6 shadow-[0_44px_120px_-60px_rgba(0,0,0,1)] backdrop-blur-2xl"
            >
              <div
                className="pointer-events-none absolute"
                style={{ inset: 0, background: 'radial-gradient(circle at top right, rgba(242,210,156,0.12) 0%, transparent 32%)' }}
              />
              <div className="relative">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.04] text-[#f2d19a]">
                    <ArrowRight className="h-4.5 w-4.5" strokeWidth={1.8} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.18em] text-white/44 uppercase">
                      Next Best Step
                    </p>
                    <p className="mt-1 text-[14px] text-white/72">今晚最自然的入口</p>
                  </div>
                </div>

                <div className="mt-6 rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
                  <p className="text-[13px] text-white/48">系统当前推荐</p>
                  <h2 className="mt-2 text-[28px] font-semibold leading-tight text-[#fbf3e6]">
                    接回昨天的会话
                  </h2>
                  <p className="mt-3 text-[14px] leading-relaxed text-white/62">
                    第一块复习已经做完，所以首页现在不让用户继续判断，而是把最顺手的第二步直接顶到前面。
                  </p>

                  <div className="mt-5 space-y-3">
                    {ROUTE_BLOCKS.map((block) => (
                      <button
                        key={block.id}
                        type="button"
                        onClick={() => setSelectedRoute(block.id)}
                        className={cx(
                          'flex w-full items-center justify-between rounded-[18px] border px-4 py-3 text-left transition-all',
                          selectedRoute === block.id
                            ? 'border-[#f0d9ab]/18 bg-[#f0d9ab]/10'
                            : 'border-white/8 bg-white/[0.02] hover:border-white/12',
                        )}
                      >
                        <div>
                          <p className="text-[10px] font-semibold tracking-[0.16em] text-white/42 uppercase">
                            {block.order}
                          </p>
                          <p className="mt-1 text-[14px] text-white/78">{block.title}</p>
                        </div>
                        <span className="text-[12px] text-white/48">{block.duration}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.aside>
          </section>

          <motion.section
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22, duration: 0.58 }}
            className="rounded-[36px] border border-white/10 bg-[#0b0e14]/84 p-6 shadow-[0_44px_130px_-60px_rgba(0,0,0,1)] backdrop-blur-2xl sm:p-8"
          >
            <div className="flex flex-col gap-8 xl:flex-row">
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.18em] text-white/42 uppercase">
                      Light Trail
                    </p>
                    <h2 className="mt-2 text-[30px] font-semibold text-[#fbf3e6]">
                      把“你已经走了多远”摆在最前面
                    </h2>
                    <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/62">
                      这里不是打卡贴纸墙。亮度有层级，留白是真空，保护和回归都被记住，但不会喧宾夺主。
                    </p>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[12px] text-white/54">
                    横向滑动回看更早星图
                  </div>
                </div>

                <div className="mt-8 overflow-x-auto pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="relative h-[260px] min-w-[1240px] pr-16">
                    <svg
                      className="absolute inset-x-0 top-0 h-[200px] w-full"
                      viewBox="0 0 1240 200"
                      fill="none"
                      aria-hidden="true"
                    >
                      <defs>
                        <linearGradient id="trailLine" x1="0" y1="0" x2="1240" y2="0">
                          <stop offset="0%" stopColor="rgba(255,255,255,0.12)" />
                          <stop offset="38%" stopColor="rgba(246,226,189,0.3)" />
                          <stop offset="100%" stopColor="rgba(255,255,255,0.1)" />
                        </linearGradient>
                      </defs>

                      <polyline
                        points={trailPolyline}
                        stroke="rgba(244,226,198,0.12)"
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        filter="blur(14px)"
                      />
                      <polyline
                        points={trailPolyline}
                        stroke="url(#trailLine)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d={futureTrailPath}
                        stroke="rgba(245,226,196,0.22)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray="7 11"
                      />
                    </svg>

                    {railPoints.map(({ point, node }, index) => (
                      <TrailNode
                        key={node.day}
                        node={node}
                        point={point}
                        index={index}
                        selected={node.day === selectedDay}
                        onSelect={setSelectedDay}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <aside className="xl:w-[320px] xl:shrink-0">
                <div className="space-y-4">
                  <div className="rounded-[30px] border border-white/10 bg-white/[0.035] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-semibold tracking-[0.18em] text-white/44 uppercase">
                        Selected Node
                      </p>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/58">
                        Day {currentDay.day}
                      </span>
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <span
                        className={cx(
                          'rounded-full border px-3 py-1 text-[11px] font-medium',
                          currentDayMeta.chipClass,
                        )}
                      >
                        {currentDayMeta.label}
                      </span>
                      <span className="text-[12px] text-white/46">{currentDay.weekday}</span>
                    </div>

                    <h3 className="mt-4 text-[24px] font-semibold leading-tight text-[#fbf3e6]">
                      {currentDay.title}
                    </h3>
                    <p className="mt-3 text-[14px] leading-relaxed text-white/62">
                      {currentDay.note}
                    </p>

                    <div className="mt-5 rounded-[22px] border border-white/8 bg-[#0d1118] px-4 py-3 text-[12px] text-white/58">
                      {currentDay.micro}
                    </div>
                  </div>

                  <div className="rounded-[30px] border border-white/10 bg-white/[0.03] p-5">
                    <p className="text-[11px] font-semibold tracking-[0.18em] text-white/44 uppercase">
                      14-Day Read
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-[22px] border border-white/8 bg-[#0d1118] p-4">
                        <div className="text-[11px] text-white/42">深亮</div>
                        <div className="mt-2 text-[26px] font-semibold text-[#fff0d1]">
                          {focusStates}
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-white/8 bg-[#0d1118] p-4">
                        <div className="text-[11px] text-white/42">稳步</div>
                        <div className="mt-2 text-[26px] font-semibold text-[#f6efe4]">
                          {steadyStates}
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-white/8 bg-[#0d1118] p-4">
                        <div className="text-[11px] text-white/42">保护</div>
                        <div className="mt-2 text-[26px] font-semibold text-[#dce5f2]">1</div>
                      </div>
                      <div className="rounded-[22px] border border-white/8 bg-[#0d1118] p-4">
                        <div className="text-[11px] text-white/42">留白</div>
                        <div className="mt-2 text-[26px] font-semibold text-white/64">1</div>
                      </div>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </motion.section>

          <section className="grid gap-6 lg:grid-cols-[minmax(0,1.18fr)_360px]">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.58 }}
              className="rounded-[36px] border border-white/10 bg-[#0b0e14]/84 p-6 shadow-[0_44px_130px_-60px_rgba(0,0,0,1)] backdrop-blur-2xl sm:p-8"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-white/42 uppercase">
                    Today&apos;s Route
                  </p>
                  <h2 className="mt-2 text-[30px] font-semibold text-[#fbf3e6]">
                    让首页只留下一个清晰起点
                  </h2>
                  <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/62">
                    顺序由系统生成，不把“先做什么”留给用户消耗意志。每完成一块，轨迹就继续发亮。
                  </p>
                </div>
                <div className="rounded-full border border-[#f0d9ab]/16 bg-[#f0d9ab]/8 px-4 py-2 text-[12px] text-[#ebd7b5]">
                  当前进度：1 / 3 已完成
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-4">
                {ROUTE_BLOCKS.map((block) => (
                  <RouteCard
                    key={block.id}
                    block={block}
                    selected={block.id === selectedRoute}
                    onSelect={setSelectedRoute}
                  />
                ))}
              </div>
            </motion.div>

            <motion.aside
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.34, duration: 0.58 }}
              className="flex flex-col gap-6"
            >
              <div className="rounded-[36px] border border-white/10 bg-[#0f1218]/88 p-6 shadow-[0_44px_120px_-60px_rgba(0,0,0,1)] backdrop-blur-2xl">
                <div className="flex items-center gap-3">
                  <div
                    className={cx(
                      'flex h-11 w-11 items-center justify-center rounded-[18px] border',
                      currentRouteMeta.iconClass,
                    )}
                  >
                    <currentRouteMeta.icon className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.18em] text-white/42 uppercase">
                      Route Detail
                    </p>
                    <p className="mt-1 text-[14px] text-white/72">{currentRoute.order}</p>
                  </div>
                </div>

                <h3 className="mt-5 text-[28px] font-semibold leading-tight text-[#fbf3e6]">
                  {currentRoute.title}
                </h3>
                <p className="mt-3 text-[14px] leading-relaxed text-white/62">
                  {currentRoute.summary}
                </p>

                <div className="mt-5 space-y-3">
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[11px] text-white/44">为什么是现在</div>
                    <div className="mt-2 text-[14px] leading-relaxed text-white/72">
                      {currentRoute.reason}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[11px] text-white/44">完成之后</div>
                    <div className="mt-2 text-[14px] leading-relaxed text-white/72">
                      {currentRoute.outcome}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className={cx(
                    'mt-6 flex w-full items-center justify-between rounded-full px-5 py-3 text-[14px] font-semibold transition-transform',
                    currentRoute.status === 'done'
                      ? 'bg-white/[0.06] text-white/52'
                      : 'bg-[#f0d9ab] text-[#161719] hover:scale-[1.01] active:scale-[0.99]',
                  )}
                >
                  <span>
                    {currentRoute.status === 'done'
                      ? '这一块已经完成'
                      : currentRoute.status === 'active'
                        ? '从这一块开始'
                        : '排在前两项之后'}
                  </span>
                  <Clock3 className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>

              <div className="rounded-[36px] border border-white/10 bg-[#0f1218]/88 p-6 shadow-[0_44px_120px_-60px_rgba(0,0,0,1)] backdrop-blur-2xl">
                <p className="text-[11px] font-semibold tracking-[0.18em] text-white/42 uppercase">
                  Product Posture
                </p>
                <h3 className="mt-3 text-[26px] font-semibold leading-tight text-[#fbf3e6]">
                  不催命，也不纵容欠账。
                </h3>

                <div className="mt-5 space-y-3 text-[14px] leading-relaxed text-white/62">
                  <p>连续推进到高强度时，系统应该先提醒休息，而不是继续索取更多打开率。</p>
                  <p>断掉之后也不做“补昨天”的债务设计，只承认你今天重新接回来了。</p>
                </div>

                <div className="mt-6 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => setShowPause(true)}
                    className="rounded-full border border-[#f0d9ab]/16 bg-[#f0d9ab]/10 px-5 py-3 text-[14px] font-semibold text-[#f0d9ab] transition-colors hover:bg-[#f0d9ab]/14"
                  >
                    预览“允许休息”提示
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowReturn(true);
                      setTimeout(() => setShowReturn(false), 4200);
                    }}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-[14px] text-white/74 transition-colors hover:text-white"
                  >
                    预览“回来了”提示
                  </button>
                </div>
              </div>
            </motion.aside>
          </section>
        </main>
      </div>

      <AnimatePresence>
        {showPause && <PauseGrantModal onClose={() => setShowPause(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showReturn && <ReturnToast onClose={() => setShowReturn(false)} />}
      </AnimatePresence>
    </div>
  );
}

export default LightRailDemo;
