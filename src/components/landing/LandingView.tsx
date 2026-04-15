import { motion } from 'motion/react';
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  History,
  Sparkles,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const featureCards = [
  {
    icon: BrainCircuit,
    eyebrow: '状态驱动',
    title: '不是只看对错，而是判断你究竟记到了哪一层。',
    body: '能答出来但明显迟疑，通常不算真正稳住。系统会把这种差别记下来，而不是一概当成“会了”。',
  },
  {
    icon: History,
    eyebrow: '跨次延续',
    title: '每次作答即时写库，中断之后还能从真实进度继续。',
    body: '复习不是一口气做完才算数。真正可靠的系统，应该允许你中途离开，再回来时仍然知道你停在了哪里。',
  },
  {
    icon: BookOpen,
    eyebrow: '词库追踪',
    title: '每个词都能看到状态、下次复习时间和最近一次判断。',
    body: '记忆不是黑箱。你应该看得见这个词为何被判成模糊、慢回忆，还是已经足够稳。',
  },
] as const;

const capabilityChips = ['状态驱动复习', '即时写库', '跨会话延续', '词库详情抽屉'] as const;

export const LandingView = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isAuthLoading } = useAuth();

  return (
    <div className="min-h-screen px-6 py-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-7xl flex-col justify-between rounded-[36px] border border-white/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.78),rgba(255,255,255,0.58))] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.08)] backdrop-blur-2xl md:p-8">
        <div className="flex flex-col gap-12">
          <header className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.28em] text-apple-blue">
                <Sparkles className="h-3.5 w-3.5" />
                Lumina IELTS
              </div>
              <h1 className="mt-6 max-w-4xl text-5xl font-black leading-[0.98] tracking-tight text-text-primary md:text-7xl">
                背不住单词，通常不是不够努力，而是判断得还不够细。
              </h1>
              <p className="mt-6 max-w-3xl text-base leading-8 text-text-secondary md:text-lg">
                这不是一张只会给你“对 / 错”结论的练习页。它会记录你是彻底想不起、
                还是能回忆但明显迟疑，再据此安排下一次真正有意义的复习。
              </p>
            </div>

            <div className="glass max-w-sm rounded-[32px] p-6 jelly-shadow">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">进入方式</p>
              <p className="mt-3 text-xl font-black text-text-primary">
                先进入入口页，再登录，最后进入你的学习系统。
              </p>
              <p className="mt-3 text-sm leading-7 text-text-secondary">
                产品区不再把登录当成内部导航项。先确认账户，再进入个人进度和复习空间，结构才是干净的。
              </p>
            </div>
          </header>

          <div className="flex flex-wrap gap-3">
            {capabilityChips.map((chip) => (
              <span
                key={chip}
                className="rounded-full bg-white/80 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-text-secondary"
              >
                {chip}
              </span>
            ))}
          </div>

          <section className="grid gap-5 lg:grid-cols-3">
            {featureCards.map((card, index) => (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + index * 0.07 }}
                className="glass rounded-apple-lg p-7 jelly-shadow"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
                  <card.icon className="h-6 w-6" />
                </div>
                <p className="mt-6 text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">
                  {card.eyebrow}
                </p>
                <h2 className="mt-3 text-2xl font-black leading-tight text-text-primary">
                  {card.title}
                </h2>
                <p className="mt-4 text-sm leading-7 text-text-secondary">
                  {card.body}
                </p>
              </motion.div>
            ))}
          </section>
        </div>

        <section className="mt-12 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[32px] bg-[#12192b] p-7 text-white shadow-[0_24px_60px_rgba(18,25,43,0.28)]">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-white/60">你会得到什么</p>
            <p className="mt-4 text-3xl font-black leading-tight">
              一套会逐渐形成判断力的复习系统，而不是只会堆练习次数的页面。
            </p>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/72">
              经验型学习的价值，不在于把规则讲得越来越多，而在于让系统越来越知道你究竟卡在哪一步。
            </p>
          </div>

          <div className="glass rounded-apple-lg p-7 jelly-shadow">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">开始使用</p>
            <h2 className="mt-3 text-3xl font-black leading-tight text-text-primary">
              先登录，再进入属于你的学习空间。
            </h2>
            <p className="mt-3 text-sm leading-7 text-text-secondary">
              {isAuthenticated
                ? '你已经处于登录状态，可以直接继续进入产品区。'
                : 'Google 登录是主入口；如果你更习惯邮箱密码，也可以在下一页作为备用方式使用。'}
            </p>

            <div className="mt-8 flex flex-col gap-3">
              <button
                type="button"
                disabled={isAuthLoading}
                onClick={() => navigate(isAuthenticated ? '/app/home' : '/auth')}
                className="group flex w-full items-center justify-center gap-3 rounded-[28px] bg-apple-blue px-6 py-5 text-lg font-black text-white shadow-[0_22px_40px_rgba(0,122,255,0.26)] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isAuthenticated ? '继续进入学习系统' : '使用 Google 继续'}
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1.5" />
              </button>

              {!isAuthenticated && (
                <button
                  type="button"
                  onClick={() => navigate('/auth?mode=login')}
                  className="flex w-full items-center justify-center gap-3 rounded-[28px] border border-white/70 bg-white/78 px-6 py-5 text-base font-black text-text-primary transition-all hover:bg-white"
                >
                  邮箱登录
                </button>
              )}
            </div>

            <div className="mt-8 rounded-[28px] border border-white/70 bg-white/72 p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-apple-green/10 text-apple-green">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-black text-text-primary">这次先把入口结构做对。</p>
                  <p className="mt-2 text-sm leading-7 text-text-secondary">
                    先有清晰的入口层，再谈账户、进度和退出逻辑，后面的产品判断才不会越来越乱。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
