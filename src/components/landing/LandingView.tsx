import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  BrainCircuit,
  CalendarClock,
  ChevronRight,
  Compass,
  FileQuestion,
  FileText,
  Headphones,
  Layers,
  Mail,
  MessageCircle,
  QrCode,
  Route,
  ShieldCheck,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { LuminaLogo } from '../brand/LuminaLogo';
import { useAuth } from '../../contexts/AuthContext';
import { IslandButton } from '../shared/AnimalPrimitives';

interface IconCopy {
  icon: LucideIcon;
  title: string;
  text: string;
}

const navItems = [
  { label: '学习系统', href: '#learning-system' },
  { label: '备考专区', href: '#exam-zone' },
  { label: '题库中心', href: '#question-bank' },
  { label: '关于我们', href: '#about' },
];

const heroBullets: IconCopy[] = [
  {
    icon: BrainCircuit,
    title: '基于艾宾浩斯记忆曲线',
    text: '自动安排复习，记忆更牢固',
  },
  {
    icon: Headphones,
    title: '在线 IELTS 练习',
    text: '听力与阅读专项训练，实战模考',
  },
  {
    icon: Layers,
    title: '未来可扩展的题库系统',
    text: '持续更新，覆盖更多场景与题型',
  },
];

const mapNodes = [
  {
    step: '01',
    title: '词汇',
    subtitle: '记忆引擎',
    text: '基于艾宾浩斯记忆曲线',
    className: 'landing-map-card--vocab',
  },
  {
    step: '02',
    title: '考试',
    subtitle: 'IELTS 练习',
    text: '听力 & 阅读专项训练',
    className: 'landing-map-card--ielts',
  },
  {
    step: '03',
    title: '题库',
    subtitle: '题库中心',
    text: '海量题库，持续扩展中',
    className: 'landing-map-card--bank',
  },
];

const memoryStats = [
  { value: '32', label: '新学单词' },
  { value: '48', label: '待复习' },
  { value: '1286', label: '已掌握' },
];

const ieltsRows = [
  { icon: Headphones, title: '听力训练', text: '剑桥真题精选' },
  { icon: FileText, title: '阅读训练', text: '多题型专项实践' },
];

const ieltsStats = [
  { value: '12', label: '模考次数' },
  { value: '6.5', label: '平均分' },
  { value: '7.0', label: '目标分' },
];

const questionTags = ['语法词汇', '阅读理解', '完形填空', '写作训练', '口语话题', '听力理解'];

const proofItems: IconCopy[] = [
  { icon: Compass, title: '科学学习', text: '基于认知科学与记忆理论' },
  { icon: BarChart3, title: '数据驱动', text: '学习效果可视化' },
  { icon: Route, title: '灵活自由', text: '随时随地，自主掌控' },
  { icon: ShieldCheck, title: '安全可靠', text: '数据隐私保护' },
];

const workflowSteps: IconCopy[] = [
  {
    icon: Layers,
    title: '导入学习内容',
    text: '从官方词库、自定义材料或题目中收集新词，先放进同一个学习档案。',
  },
  {
    icon: BrainCircuit,
    title: '完成首次记忆',
    text: '用词义、例句和语境完成第一轮学习，记录哪些词真正记住了。',
  },
  {
    icon: CalendarClock,
    title: '自动安排复习',
    text: '基于艾宾浩斯遗忘曲线生成每日复习清单，到期的词会优先出现。',
  },
  {
    icon: Target,
    title: '练习结果回流',
    text: '阅读、听力和题库中的错误会回到复习节奏里，下一轮更有针对性。',
  },
];

const memoryEngineItems: IconCopy[] = [
  {
    icon: CalendarClock,
    title: '每天先排好复习顺序',
    text: '新学、待复习、已掌握分开记录，打开后先看到今天最该看的词。',
  },
  {
    icon: BookOpenCheck,
    title: '把单词放回语境',
    text: '词义、例句、来源材料和复习状态放在一起，不只停留在单词表。',
  },
  {
    icon: Target,
    title: '长期掌握再减少打扰',
    text: '稳定回忆的词逐步拉长间隔，把精力留给更容易忘的内容。',
  },
];

const ieltsDetailItems: IconCopy[] = [
  {
    icon: Headphones,
    title: '听力专项',
    text: '按题型和材料拆解训练，记录错因与完成进度。',
  },
  {
    icon: FileText,
    title: '阅读训练',
    text: '保留文章、题目、答案和生词，复盘时能回到原文语境。',
  },
  {
    icon: BarChart3,
    title: '模考记录',
    text: '用静态示例展示目标分、练习次数和阶段表现，后续可接入真实记录。',
  },
];

const questionBankGroups = [
  {
    title: '词汇语法',
    items: ['语法词汇', '词形辨析', '短语搭配'],
  },
  {
    title: '阅读理解',
    items: ['主旨题', '细节题', '判断题'],
  },
  {
    title: '听力理解',
    items: ['填空题', '选择题', '地图题'],
  },
  {
    title: '写作口语',
    items: ['观点表达', '话题素材', '范文积累'],
  },
  {
    title: '校内练习',
    items: ['同步词库', '单元复习', '阶段测验'],
  },
  {
    title: '自定义材料',
    items: ['上传文本', '手动整理', '个人错题'],
  },
];

const continuityItems: IconCopy[] = [
  {
    icon: Compass,
    title: '统一学习入口',
    text: '词库、雅思和题库不分散到不同工具里，学习路径更连续。',
  },
  {
    icon: BarChart3,
    title: '统一记录口径',
    text: '新词、复习、练习和目标分用同一个账号保存，方便回看变化。',
  },
  {
    icon: Route,
    title: '统一下一步',
    text: '下一次打开 Lumina，先接上今天该学、该复习、该练的部分。',
  },
  {
    icon: ShieldCheck,
    title: '可控的数据边界',
    text: '展示内容以产品能力和静态示例为主，不虚构真实用户成绩承诺。',
  },
];

const faqItems = [
  {
    question: 'Lumina 是什么？',
    answer: [
      'Lumina 是一款面向中文英语学习者的单词记忆与雅思训练工具。',
      '“Lumina” 源自拉丁语，有“光芒”“光辉”的意思。这个名字也代表了我做这个项目的初衷：希望它能成为一个真正对别人有帮助的产品。往小了说，是我自己在学习和做事中践行“知行合一”；往大了说，也希望它能通过技术帮助更多人更高效地学习英语。',
    ],
  },
  {
    question: 'Lumina 免费吗？',
    answer: [
      '目前 Lumina 是免费的，而且我会尽量长期保持免费。',
      '因为我现在还在新加坡留学，个人经济压力不算大，所以这个项目一开始并不是为了赚钱。我更希望它先成为一个真正好用、能帮助学习者的工具。',
      '不过也想提前说明一下：Lumina 后续会陆续加入一些 AI 功能，例如 AI 口语练习、个性化学习辅助等。这类功能可能会产生较高的服务成本。因此，如果未来某些功能的成本非常高，不排除会对部分高级 AI 功能进行收费，用来覆盖服务器和 AI 调用成本。',
    ],
  },
  {
    question: 'Lumina 支持哪些平台？',
    answer: [
      '目前 Lumina 主要支持网页端，后续会逐步考虑支持更多平台，包括 App、Windows 和 MacOS。Lumina 的学习进度会跟随账号自动同步。',
    ],
  },
  {
    question: '可以背自己的单词吗？',
    answer: [
      '当然可以。',
      '这也是我最初开发 Lumina 的重要原因之一：我希望能有一个工具，不只是背固定词库，也能把自己平时在生活中、视频里、文章里、考试材料中遇到的单词保存下来，变成自己的长期词库。',
      '你可以在个人词库中导入自己的单词。导入后，系统会自动整理词条信息，例如释义、音标、例句、构词、近义词、反义词和记忆提示等。之后，这些单词也可以进入 Lumina 的学习流程和复习系统。',
    ],
  },
  {
    question: 'Lumina 和其他背单词 App 有什么区别？',
    answer: [
      '很多背单词软件会更强调“词库很大”“单词很多”，但真正到考试、阅读或听力中需要回忆时，效果不一定理想。',
      'Lumina 更关注的是：你是否真的能记住、能回忆、能在真实语境中使用。',
      '所以 Lumina 把“听写”和“主动回忆”放在默认学习路径中。相比只是看一遍单词，听写和回忆会迫使你真正调动记忆，从而提高单词掌握程度。',
      '同时，Lumina 也把词汇学习和考试训练连接起来。目前主要支持雅思阅读和听力训练。你在做题时遇到的生词，可以快速加入个人词库，并进入后续学习和复习流程。',
    ],
  },
];

const reviewTimeline = [
  { label: '新学', value: '首次记忆' },
  { label: '1 天后', value: '快速回看' },
  { label: '2 天后', value: '语境复习' },
  { label: '4 天后', value: '错词优先' },
  { label: '7 天后', value: '稳定检查' },
  { label: '15 天后', value: '长期巩固' },
];

function HeroMapCard({ node }: { node: (typeof mapNodes)[number] }) {
  return (
    <div className={`landing-map-card ${node.className}`}>
      <div className="landing-map-card__header">
        <span>{node.step}</span>
        <h3>{node.title}</h3>
      </div>
      <p className="landing-map-card__subtitle">{node.subtitle}</p>
      <p className="landing-map-card__text">{node.text}</p>
      <span className="landing-map-pin" aria-hidden="true">
        <span />
      </span>
    </div>
  );
}

function MemoryCurveChart() {
  return (
    <svg className="landing-memory-chart" viewBox="0 0 560 238" role="img" aria-label="艾宾浩斯遗忘曲线示意图">
      <rect x="0" y="0" width="560" height="238" rx="18" fill="rgba(255,253,243,0.9)" />
      <text x="280" y="34" textAnchor="middle" className="landing-chart-title">
        艾宾浩斯遗忘曲线
      </text>
      {[64, 96, 128, 160, 192].map((y) => (
        <line key={y} x1="64" x2="520" y1={y} y2={y} className="landing-chart-grid" />
      ))}
      {[70, 150, 230, 330, 430, 510].map((x) => (
        <line key={x} x1={x} x2={x} y1="56" y2="196" className="landing-chart-guide" />
      ))}
      <path
        d="M72 70 C112 102 128 154 152 178 C184 206 270 202 340 198 C412 194 470 188 520 184"
        className="landing-chart-curve landing-chart-curve--base"
      />
      <path
        d="M72 70 C116 92 128 126 152 146 C184 170 260 168 340 164 C412 160 470 152 520 144"
        className="landing-chart-curve landing-chart-curve--review"
      />
      {[72, 152, 240, 340, 440, 520].map((x, index) => (
        <circle key={x} cx={x} cy={[70, 92, 98, 106, 112, 132][index]} r="7" className="landing-chart-dot" />
      ))}
      {['新学', '1天后', '2天后', '4天后', '7天后', '15天后'].map((label, index) => (
        <text
          key={label}
          x={[72, 152, 240, 340, 440, 520][index]}
          y="222"
          textAnchor="middle"
          className="landing-chart-axis"
        >
          {label}
        </text>
      ))}
      {['100%', '75%', '50%', '25%', '0%'].map((label, index) => (
        <text key={label} x="35" y={[68, 100, 132, 164, 196][index]} textAnchor="middle" className="landing-chart-axis">
          {label}
        </text>
      ))}
      <g className="landing-chart-badge">
        <rect x="420" y="66" width="88" height="28" rx="14" />
        <text x="464" y="85" textAnchor="middle">
          智能复习点
        </text>
      </g>
    </svg>
  );
}

export const LandingView = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isAuthLoading } = useAuth();
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  const primaryTarget = isAuthenticated ? '/app/home' : '/auth?mode=register';
  const ieltsTarget = isAuthenticated ? '/app/ielts' : `/auth?mode=login&next=${encodeURIComponent('/app/ielts')}`;
  const primaryLabel = isAuthenticated ? '进入学习系统' : '开始学习之旅';

  return (
    <main className="landing-page">
      <section id="learning-system" className="landing-reference-stage" aria-label="Lumina landing hero">
        <div className="landing-showcase-shell">
          <header className="landing-topbar">
            <div className="landing-brand-lockup">
              <LuminaLogo size={42} wordmarkClassName="landing-wordmark" />
              <span>让英语学习· 更高效</span>
            </div>

            <nav className="landing-nav" aria-label="Landing page navigation">
              {navItems.map((item) => (
                <a key={item.href} href={item.href}>
                  {item.label}
                </a>
              ))}
            </nav>

            <div className="landing-header-actions">
              {!isAuthenticated && (
                <Link to="/auth?mode=login" className="landing-login-link">
                  登录
                </Link>
              )}
              <IslandButton
                onClick={() => navigate(primaryTarget)}
                disabled={isAuthLoading}
                tone="primary"
                size="middle"
                className="landing-register-button"
              >
                {isAuthenticated ? '回到学习' : '注册体验'}
              </IslandButton>
            </div>
          </header>

          <div className="landing-hero-canvas">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.46 }}
              className="landing-hero-copy"
            >
              <h1>
                <span>在 Lumina,</span>
                <span>英语学习像探索一样</span>
                <span>自然</span>
              </h1>
              <p className="landing-hero-lede">
                记得牢、练得多、用得上。从词汇记忆到应试训练，Lumina 帮你把学习变成一条清晰可见的成长路线。
              </p>

              <div className="landing-hero-bullets">
                {heroBullets.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="landing-hero-bullet">
                      <span>
                        <Icon className="h-6 w-6" />
                      </span>
                      <div>
                        <h2>{item.title}</h2>
                        <p>{item.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <IslandButton
                onClick={() => navigate(primaryTarget)}
                disabled={isAuthLoading}
                tone="primary"
                size="large"
                icon={<ArrowRight className="h-5 w-5" />}
                className="landing-primary-cta"
              >
                {primaryLabel}
              </IslandButton>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.58, delay: 0.08 }}
              className="landing-hero-visual"
              aria-label="Lumina learning island map"
            >
              <img src="/lumina-landing-island-map.webp" alt="Lumina 学习岛屿地图" />
              {mapNodes.map((node) => (
                <HeroMapCard key={node.step} node={node} />
              ))}
            </motion.div>
          </div>

          <div className="landing-feature-panels">
            <article className="landing-feature-panel landing-feature-panel--memory">
              <div className="landing-panel-heading">
                <span className="landing-panel-icon landing-panel-icon--green">
                  <BrainCircuit className="h-8 w-8" />
                </span>
                <div>
                  <h2>词汇记忆引擎</h2>
                  <p>智能安排复习，长期记忆更高效</p>
                </div>
              </div>
              <MemoryCurveChart />
              <div className="landing-memory-stats">
                {memoryStats.map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </article>

            <article id="exam-zone" className="landing-feature-panel landing-feature-panel--ielts">
              <div className="landing-panel-heading">
                <span className="landing-panel-icon landing-panel-icon--blue">
                  <Headphones className="h-8 w-8" />
                </span>
                <div>
                  <h2>IELTS 在线练习</h2>
                  <p>听力 & 阅读专项训练，真题模考</p>
                </div>
              </div>
              <div className="landing-ielts-list">
                {ieltsRows.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button key={item.title} type="button" onClick={() => navigate(ieltsTarget)}>
                      <span>
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.text}</p>
                      </div>
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  );
                })}
              </div>
              <div className="landing-ielts-stats">
                {ieltsStats.map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </article>

            <article id="question-bank" className="landing-feature-panel landing-feature-panel--bank">
              <div className="landing-panel-heading">
                <span className="landing-panel-icon landing-panel-icon--orange">
                  <Layers className="h-8 w-8" />
                </span>
                <div>
                  <h2>题库中心</h2>
                  <p>持续扩展的题库系统，覆盖更多学习场景</p>
                </div>
              </div>
              <div className="landing-bank-tags">
                {questionTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <p className="landing-bank-note">更多题型与场景持续上线中...</p>
              <button type="button" className="landing-bank-button" onClick={() => navigate(primaryTarget)}>
                查看题库预览
                <ChevronRight className="h-4 w-4" />
              </button>
            </article>
          </div>

          <div className="landing-proof-strip">
            {proofItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title}>
                  <Icon className="h-7 w-7" />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.text}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="landing-longform" aria-label="Lumina system details">
        <div className="landing-detail-kicker">
          <span>学习路线说明书</span>
          <h2>
            把词汇、备考和题库
            <br />
            串成一条进度线。
          </h2>
          <p>
            Lumina
            不只提供一个背单词入口。它会围绕“今天该学什么、该复习什么、该练什么”组织内容，让英语学习从零散任务变成连续系统。
          </p>
        </div>

        <section className="landing-route-section" aria-labelledby="landing-route-title">
          <div className="landing-section-copy">
            <p>系统如何工作</p>
            <h2 id="landing-route-title">从新词到长期掌握，每一步都有记录。</h2>
            <span>
              学习内容进入 Lumina
              后，会先形成个人词库和练习轨迹。之后每一次复习、错题和模考结果，都会继续影响下一轮安排。
            </span>
          </div>

          <div className="landing-route-steps">
            {workflowSteps.map((item, index) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="landing-route-step">
                  <span className="landing-route-step__index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="landing-route-step__icon">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="landing-memory-detail" aria-labelledby="landing-memory-title">
          <div className="landing-section-copy">
            <p>词汇记忆引擎</p>
            <h2 id="landing-memory-title">基于艾宾浩斯遗忘曲线，自动安排复习。</h2>
            <span>
              系统用复习间隔管理单词，而不是让你每天重新翻列表。新学、快忘、稳定掌握的词会进入不同节奏，复习清单更清楚。
            </span>
          </div>

          <div className="landing-memory-detail__board">
            <div className="landing-review-timeline">
              {reviewTimeline.map((item) => (
                <div key={item.label}>
                  <strong>{item.label}</strong>
                  <span>{item.value}</span>
                </div>
              ))}
            </div>

            <div className="landing-memory-detail__list">
              {memoryEngineItems.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title}>
                    <Icon className="h-6 w-6" />
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.text}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-practice-section" aria-labelledby="landing-practice-title">
          <div className="landing-section-copy">
            <p>IELTS 备考专区</p>
            <h2 id="landing-practice-title">听力、阅读和模考记录，放在同一个备考面板里。</h2>
            <span>
              IELTS 不只是刷题入口。练习材料、完成情况、错题和目标分会一起保存，复盘时能看见自己在哪类题上反复失分。
            </span>
          </div>

          <div className="landing-practice-grid">
            {ieltsDetailItems.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="landing-practice-card">
                  <span>
                    <Icon className="h-6 w-6" />
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              );
            })}
          </div>

          <button type="button" className="landing-inline-cta" onClick={() => navigate(ieltsTarget)}>
            进入 IELTS 练习
            <ChevronRight className="h-4 w-4" />
          </button>
        </section>

        <section className="landing-bank-detail" aria-labelledby="landing-bank-title">
          <div className="landing-section-copy">
            <p>题库中心</p>
            <h2 id="landing-bank-title">未来扩展更多题型，也沿用同一套学习底座。</h2>
            <span>
              题库中心会逐步覆盖词汇语法、阅读理解、听力理解、写作口语、校内练习和自定义材料。新模块增加练习场景，不打断已有复习节奏。
            </span>
          </div>

          <div className="landing-bank-detail__grid">
            {questionBankGroups.map((group) => (
              <article key={group.title}>
                <FileQuestion className="h-5 w-5" />
                <h3>{group.title}</h3>
                <div>
                  {group.items.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-continuity-section" aria-labelledby="landing-continuity-title">
          <div className="landing-section-copy">
            <p>为什么是一个系统</p>
            <h2 id="landing-continuity-title">账号里保存的不只是分数，还有学习连续性。</h2>
            <span>
              单词、复习、练习结果和偏好放在一起，才知道下一步该继续哪里。Lumina
              的目标是让学习路径越来越清楚，而不是让入口越来越多。
            </span>
          </div>

          <div className="landing-continuity-list">
            {continuityItems.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title}>
                  <Icon className="h-5 w-5" />
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section id="faq" className="landing-faq-section" aria-labelledby="landing-faq-title">
          <div className="landing-section-copy landing-faq-copy">
            <p>常见问题</p>
            <h2 id="landing-faq-title">开始使用前，先把关键问题说清楚。</h2>
            <span>
              这里回答 Lumina 的定位、费用、平台和个人词库能力。每次只展开一个答案，阅读时不会被其他内容打断。
            </span>
          </div>

          <div className="landing-faq-list">
            {faqItems.map((item, index) => {
              const isOpen = openFaqIndex === index;
              const contentId = `landing-faq-answer-${index}`;

              return (
                <article key={item.question} className={`landing-faq-item${isOpen ? ' landing-faq-item--open' : ''}`}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={contentId}
                    onClick={() => setOpenFaqIndex((current) => (current === index ? null : index))}
                    className="landing-faq-question"
                  >
                    <span>{item.question}</span>
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        id={contentId}
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: 'easeOut' }}
                        className="landing-faq-answer"
                      >
                        <div>
                          {item.answer.map((paragraph) => (
                            <p key={paragraph}>{paragraph}</p>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </article>
              );
            })}
          </div>
        </section>

        <section id="about" className="landing-contact-section">
          <div className="landing-contact-copy">
            <p>关于 Lumina</p>
            <h2>关于我们</h2>
            <span>Lumina 还在持续打磨。这里会放真实联系方式，方便反馈词库、题库、雅思训练和账号问题。</span>
            <div className="landing-contact-links">
              <Link to="/privacy">隐私政策</Link>
              <Link to="/terms">服务条款</Link>
            </div>
          </div>

          <div className="landing-contact-card">
            <div className="landing-contact-row">
              <Mail className="h-5 w-5" />
              <div>
                <span>邮箱</span>
                <strong>
                  <a href="mailto:alanmuskccoder@gmail.com">alanmuskccoder@gmail.com</a>
                </strong>
              </div>
              <em>可联系</em>
            </div>
            <div className="landing-contact-row">
              <MessageCircle className="h-5 w-5" />
              <div>
                <span>微信</span>
                <strong>fan791667283</strong>
              </div>
              <em>微信号</em>
            </div>
            <div className="landing-qr-placeholder" aria-label="微信二维码待替换">
              <QrCode className="h-12 w-12" />
              <span>二维码待替换</span>
            </div>
          </div>
        </section>

        <section className="landing-final-band">
          <div>
            <p>从今天开始</p>
            <h2>先从今天该学什么开始。</h2>
            <span>注册后保存词库、复习安排、IELTS 训练记录和学习偏好。下次打开 Lumina，就从当前进度继续。</span>
          </div>
          <IslandButton
            onClick={() => navigate(primaryTarget)}
            disabled={isAuthLoading}
            tone="primary"
            size="large"
            icon={<ArrowRight className="h-5 w-5" />}
          >
            {primaryLabel}
          </IslandButton>
        </section>
      </section>
    </main>
  );
};
