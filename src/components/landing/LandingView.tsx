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
    title: '按记忆状态安排复习',
    text: '查看到期单词，按计划复习',
  },
  {
    icon: BookOpenCheck,
    title: '在线 IELTS 练习',
    text: '限时答题、评分与答案回看',
  },
  {
    icon: Layers,
    title: '个人词库',
    text: '收藏生词，自选数量开始学习',
  },
];

const mapNodes = [
  {
    step: '01',
    title: '词汇',
    subtitle: '学习与复习',
    text: '按记忆状态安排复习',
    className: 'landing-map-card--vocab',
  },
  {
    step: '02',
    title: '考试',
    subtitle: 'IELTS 练习',
    text: '学术阅读真题训练',
    className: 'landing-map-card--ielts',
  },
  {
    step: '03',
    title: '题库',
    subtitle: '题库中心',
    text: '已开放阅读；更多题型规划中',
    className: 'landing-map-card--bank',
  },
];

const memoryStats = [
  { value: '—', label: '新学单词' },
  { value: '—', label: '待复习' },
  { value: '—', label: '已掌握' },
];

const ieltsRows = [
  { icon: FileText, title: '阅读训练', text: '剑桥真题分册练习' },
  { icon: BarChart3, title: '答题复盘', text: '得分、用时与错题回看' },
];

const ieltsStats = [
  { value: '—', label: '模考次数' },
  { value: '—', label: '平均分' },
  { value: '—', label: '目标分' },
];

const questionTags = [
  '语法词汇 · 规划中',
  '阅读理解 · 已开放',
  '完形填空 · 规划中',
  '写作训练 · 规划中',
  '口语话题 · 规划中',
  '材料导入 · 规划中',
];

const proofItems: IconCopy[] = [
  { icon: Compass, title: '间隔复习', text: '按记忆状态生成复习清单' },
  { icon: BarChart3, title: '学习记录', text: '查看新学、复习和练习结果' },
  { icon: Route, title: '自选单词', text: '个人词库支持任意数量学习' },
  { icon: ShieldCheck, title: '账号同步', text: '登录后读取已保存的进度' },
];

const workflowSteps: IconCopy[] = [
  {
    icon: Layers,
    title: '导入学习内容',
    text: '选择官方词库，或将导入和阅读中收藏的单词保存到个人词库。',
  },
  {
    icon: BrainCircuit,
    title: '完成首次记忆',
    text: '查看释义和例句，通过拼写确认完成第一轮学习。',
  },
  {
    icon: CalendarClock,
    title: '自动安排复习',
    text: '根据单词的记忆状态设置复习间隔，首页显示到期单词。',
  },
  {
    icon: Target,
    title: '收藏阅读生词',
    text: '在阅读练习中查词并收藏，随后到个人词库勾选学习。',
  },
];

const memoryEngineItems: IconCopy[] = [
  {
    icon: CalendarClock,
    title: '查看到期复习',
    text: '首页显示待复习词数；复习清单按到期时间和记忆状态排序。',
  },
  {
    icon: BookOpenCheck,
    title: '结合例句学习',
    text: '词条提供释义、发音、例句和构词信息，供学习时查阅。',
  },
  {
    icon: Target,
    title: '查看记忆状态',
    text: '词条显示当前记忆状态与下次复习时间；已掌握的词不再安排到期复习。',
  },
];

const ieltsDetailItems: IconCopy[] = [
  {
    icon: Target,
    title: '限时训练',
    text: '阅读限时 60 分钟，提交后查看用时、得分和错题。',
  },
  {
    icon: FileText,
    title: '阅读训练',
    text: '支持原文高亮、笔记和练习模式查词；交卷后可对照答案回看。',
  },
  {
    icon: BarChart3,
    title: '模考记录',
    text: '记录已完成练习的得分、正确率和用时，并按题型汇总表现。',
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
    title: '考试复盘',
    items: ['错题回看', '时间分配', '生词归档'],
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
    title: '学习入口',
    text: '从导航进入词汇学习、雅思练习和生词复习。',
  },
  {
    icon: BarChart3,
    title: '查看学习记录',
    text: '账号页显示每日学习记录；雅思页显示练习记录和目标分。',
  },
  {
    icon: Route,
    title: '继续上次学习',
    text: '首页提供未完成学习和到期复习的入口。',
  },
  {
    icon: ShieldCheck,
    title: '学习设置',
    text: '可调整发音、朗读速度、回忆和听写等学习选项。',
  },
];

const faqItems = [
  {
    question: 'Lumina 是什么？',
    answer: ['Lumina 是面向中文用户的英语词汇学习与雅思练习工具，提供词汇记忆、主动回忆、听写、间隔复习和答题回看。'],
  },
  {
    question: 'Lumina 免费吗？',
    answer: ['目前开放的功能免费使用。未来如增加收费功能，将在使用前说明价格与使用范围。'],
  },
  {
    question: 'Lumina 支持哪些平台？',
    answer: ['可通过电脑或手机浏览器访问。登录同一账号后，可读取已同步的学习进度。'],
  },
  {
    question: '可以学习自己的单词吗？',
    answer: [
      '可以导入单词，也可以在阅读练习中查词并收藏。进入个人词库后，手动勾选要学习的词，选 1 个或多个均可开始；点击词名可播放发音。',
    ],
  },
  {
    question: '词汇学习有哪些步骤？',
    answer: [
      '先查看词义、例句并完成拼写，再进行主动回忆与听写。回忆和听写可在学习设置中开关；完成学习后，未掌握的词会进入复习安排。',
    ],
  },
];

const reviewTimeline = [
  { label: '首次学习', value: '学习词义与用法' },
  { label: '确认拼写', value: '记录学习进度' },
  { label: '回忆与听写', value: '按设置完成练习' },
  { label: '安排复习', value: '按记忆状态排期' },
  { label: '到期复习', value: '查看当日复习清单' },
  { label: '查看记录', value: '状态与下次复习时间' },
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
      {['首次学习', '到期复习', '检查回忆', '更新状态', '再次复习', '持续记录'].map((label, index) => (
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
          复习示意
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
  const primaryLabel = isAuthenticated ? '进入学习系统' : '注册并开始学习';

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
                {isAuthenticated ? '回到学习' : '注册'}
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
                <span>词汇学习与雅思练习</span>
                <span>集中管理</span>
              </h1>
              <p className="landing-hero-lede">
                选择词汇进行记忆、回忆和听写，按计划复习；完成雅思练习后，查看答案与练习记录。
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
                  <h2>词汇学习与复习</h2>
                  <p>学习、回忆、听写与间隔复习</p>
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
                  <BookOpenCheck className="h-8 w-8" />
                </span>
                <div>
                  <h2>IELTS 在线练习</h2>
                  <p>学术阅读练习与限时作答</p>
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
                  <p>阅读练习已开放，其他题型仍在规划中</p>
                </div>
              </div>
              <div className="landing-bank-tags">
                {questionTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <p className="landing-bank-note">其他题型暂无开放时间。</p>
              <button type="button" className="landing-bank-button" onClick={() => navigate(primaryTarget)}>
                查看题型规划
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
          <span>功能说明</span>
          <h2>
            词汇学习、复习
            <br />
            与雅思练习。
          </h2>
          <p>Lumina 提供词汇记忆、到期复习和雅思练习，并保存每次学习进度。</p>
        </div>

        <section className="landing-route-section" aria-labelledby="landing-route-title">
          <div className="landing-section-copy">
            <p>系统如何工作</p>
            <h2 id="landing-route-title">从选词开始，完成学习并安排复习。</h2>
            <span>词汇学习记录与雅思练习结果分别保存。阅读中收藏的生词，可在个人词库中选择学习。</span>
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
            <p>词汇学习与复习</p>
            <h2 id="landing-memory-title">按记忆状态设置复习间隔。</h2>
            <span>未掌握的词按当前状态安排 1、3 或 7 天后的复习。以下为流程示意，具体时间以词条记录为准。</span>
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
            <h2 id="landing-practice-title">查看阅读练习、得分与答题记录。</h2>
            <span>选择套题开始练习，提交后查看答案、正确率和用时。雅思首页汇总已完成练习与题型表现。</span>
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
            <h2 id="landing-bank-title">题型开放情况与规划。</h2>
            <span>阅读练习和答题回看已开放。词汇语法、写作口语、校内练习及材料上传仍在规划中，暂无开放时间。</span>
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
            <p>记录与设置</p>
            <h2 id="landing-continuity-title">用账号保存学习进度。</h2>
            <span>登录后可查看已保存的词库、学习进度、练习结果和学习设置。</span>
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
            <h2 id="landing-faq-title">使用前须知</h2>
            <span>了解产品功能、费用与使用方式。</span>
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
            <span>词条、题目或账号遇到问题，可通过以下方式反馈。</span>
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
            <div className="landing-qr-placeholder" aria-label="微信联系方式">
              <QrCode className="h-12 w-12" />
              <span>请通过微信号添加</span>
            </div>
          </div>
        </section>

        <section className="landing-final-band">
          <div>
            <p>从今天开始</p>
            <h2>开始词汇学习或雅思练习。</h2>
            <span>注册后可保存个人词库、学习进度、复习记录和雅思练习结果。</span>
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
