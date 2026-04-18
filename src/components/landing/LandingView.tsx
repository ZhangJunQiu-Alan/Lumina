import { motion } from 'motion/react';
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  History,
  Sparkles,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isGoogleAuthEnabled } from '../../lib/authFeatures';

const featureCards = [
  {
    icon: BrainCircuit,
    eyebrow: '状态驱动',
    title: '不是只看对错，而是判断你究竟记到了哪一层。',
    body: '能答出来但明显迟疑，通常还不算真的稳住。这种差别，这边会替你记下来。',
  },
  {
    icon: History,
    eyebrow: '跨次延续',
    title: '每次作答即时写库，中断之后还能从真实进度继续。',
    body: '复习不一定非得一口气做完。中途离开也没关系，回来还能接着上次那一段。',
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
  const primaryTarget = isAuthenticated ? '/app/home' : isGoogleAuthEnabled ? '/auth' : '/auth?mode=login';
  const primaryLabel = isAuthenticated
    ? '继续进入学习系统'
    : isGoogleAuthEnabled
      ? '使用 Google 继续'
      : '邮箱登录开始学习';
  const secondaryLabel = isGoogleAuthEnabled ? '邮箱登录' : '邮箱注册';
  const secondaryTarget = isGoogleAuthEnabled ? '/auth?mode=login' : '/auth?mode=register';

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
                这边不只记你答对还是答错，还会记住你是一下想起来了，还是卡了一会儿才想起来。
                下次该什么时候再见到这个词，也会跟着这个判断一起走。
              </p>
            </div>

            <div className="glass max-w-sm rounded-[32px] p-6 jelly-shadow">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">怎么开始</p>
              <p className="mt-3 text-xl font-black text-text-primary">
                先登录，回来时才接得上。
              </p>
              <p className="mt-3 text-sm leading-7 text-text-secondary">
                词库、复习安排和学习进度都跟着账号走。先把你认出来，后面才不会乱。
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
              一套会慢慢摸清你卡在哪的复习系统，不只是做题次数越堆越多。
            </p>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/72">
              真正有用的地方，不是规则写得多漂亮，而是你下次回来时，它还知道该从哪接着走。
            </p>
          </div>

          <div className="glass rounded-apple-lg p-7 jelly-shadow">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">开始使用</p>
            <h2 className="mt-3 text-3xl font-black leading-tight text-text-primary">
              先登录，再继续学。
            </h2>
            <p className="mt-3 text-sm leading-7 text-text-secondary">
              {isAuthenticated
                ? '你已经登录了，直接进去就行。'
                : isGoogleAuthEnabled
                  ? 'Google 会更省事一点。如果你更习惯邮箱密码，下一页也留着。'
                  : '当前线上先开放邮箱密码登录，Google 登录会在 provider 配好之后再打开。'}
            </p>

            <div className="mt-8 flex flex-col gap-3">
              <button
                type="button"
                disabled={isAuthLoading}
                onClick={() => navigate(primaryTarget)}
                className="group flex w-full items-center justify-center gap-3 rounded-[28px] bg-apple-blue px-6 py-5 text-lg font-black text-white shadow-[0_22px_40px_rgba(0,122,255,0.26)] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {primaryLabel}
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1.5" />
              </button>

              {!isAuthenticated && (
                <button
                  type="button"
                  onClick={() => navigate(secondaryTarget)}
                  className="flex w-full items-center justify-center gap-3 rounded-[28px] border border-white/70 bg-white/78 px-6 py-5 text-base font-black text-text-primary transition-all hover:bg-white"
                >
                  {secondaryLabel}
                </button>
              )}
            </div>

            <div className="mt-8 rounded-[28px] border border-white/70 bg-white/72 p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-apple-green/10 text-apple-green">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-black text-text-primary">先把入口理顺，后面就省心很多。</p>
                  <p className="mt-2 text-sm leading-7 text-text-secondary">
                    以后你回来，词库和进度都能接得上，不用每次重新找感觉。
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-6 text-xs leading-6 text-text-secondary">
              继续使用即表示你同意
              {' '}
              <Link to="/terms" className="font-bold text-text-primary underline decoration-black/20 underline-offset-4">
                服务条款
              </Link>
              {' '}
              和
              {' '}
              <Link to="/privacy" className="font-bold text-text-primary underline decoration-black/20 underline-offset-4">
                隐私政策
              </Link>
              。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};
