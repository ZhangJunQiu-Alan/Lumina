import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  Chrome,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isGoogleAuthEnabled } from '../../lib/authFeatures';

type AuthMode = 'login' | 'register';

interface FormState {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const defaultFormState: FormState = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
};

function safeNextPath(searchParams: URLSearchParams) {
  const next = searchParams.get('next');
  if (!next || !next.startsWith('/app/')) return '/app/home';
  return next;
}

function normalizeOAuthError(message: string) {
  const normalized = message.trim();

  if (!normalized) return null;
  if (normalized.includes('redirect_uri_mismatch')) {
    return 'Google 回调地址不匹配。请检查 Google Cloud OAuth Client 的 Authorized redirect URIs，并确认其中包含 Supabase 提供的 callback URL。';
  }
  if (normalized.includes('provider is not enabled')) {
    return 'Supabase 的 Google provider 还没有启用。请先在 Authentication > Providers > Google 中填好 Client ID / Secret 并打开开关。';
  }
  if (normalized.includes('access_denied')) {
    return 'Google 授权被拒绝，或当前账号暂时没有权限使用这个应用。';
  }

  return normalized;
}

function readOAuthError(search: string, hash: string) {
  const searchParams = new URLSearchParams(search);
  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const rawMessage = searchParams.get('error_description')
    ?? searchParams.get('error')
    ?? hashParams.get('error_description')
    ?? hashParams.get('error');

  return rawMessage ? normalizeOAuthError(rawMessage) : null;
}

function AuthField({
  icon: Icon,
  label,
  type,
  value,
  onChange,
  placeholder,
  trailing,
}: {
  icon: typeof Mail;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  trailing?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">{label}</span>
      <div className="mt-3 flex items-center gap-3 rounded-[26px] border border-white/60 bg-white/72 px-4 py-4 shadow-[0_12px_35px_rgba(0,0,0,0.04)] backdrop-blur-xl transition-colors focus-within:border-apple-blue/40">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
          <Icon className="h-4 w-4" />
        </div>
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-base font-semibold text-text-primary outline-none placeholder:font-medium placeholder:text-text-secondary"
          autoComplete="off"
        />
        {trailing}
      </div>
    </label>
  );
}

export const AuthView = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isAuthenticated,
    isAuthLoading,
    signInWithGoogle,
    signInWithPassword,
    signUpWithPassword,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('login');
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const nextPath = useMemo(() => safeNextPath(searchParams), [searchParams]);
  const oauthError = useMemo(() => readOAuthError(location.search, location.hash), [location.hash, location.search]);
  const insightCards = useMemo(() => [
    {
      title: '先登录，再继续。',
      body: '这样你下次回来，词库和进度才能接得上。',
    },
    {
      title: isGoogleAuthEnabled ? 'Google 会更省事。' : '邮箱登录已经可用。',
      body: isGoogleAuthEnabled
        ? '想快一点进来，通常点一下就够了。'
        : '当前线上先开放邮箱密码，先把学习系统稳定跑起来。',
    },
    {
      title: isGoogleAuthEnabled ? '邮箱密码也能用。' : 'Google 稍后再开。',
      body: isGoogleAuthEnabled
        ? '如果你更习惯老办法，这边也留着，不着急。'
        : '等 Supabase 的 Google provider 配好之后，再把它放回主入口。',
    },
  ], []);

  useEffect(() => {
    const nextMode = searchParams.get('mode');
    if (nextMode === 'login' || nextMode === 'register') {
      setMode(nextMode);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!oauthError) return;

    setFeedback((current) => {
      if (current?.type === 'error' && current.text === oauthError) {
        return current;
      }
      return { type: 'error', text: oauthError };
    });
  }, [oauthError]);

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      navigate(nextPath, { replace: true });
    }
  }, [isAuthenticated, isAuthLoading, navigate, nextPath]);

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const title = mode === 'login'
    ? {
      kicker: '欢迎回来',
      heading: '登录一下，继续刚才那一段。',
      body: '账号一接上，词库、复习安排和学习进度都会跟着回来。',
      cta: '用邮箱登录',
    }
    : {
      kicker: '第一次来',
      heading: '先把账号建好，后面就能一直接着学。',
      body: '先把入口留住，之后每次回来都能接上原来的进度。',
      cta: '创建账户',
    };

  const handleGoogle = async () => {
    setFeedback(null);
    setIsGoogleSubmitting(true);
    try {
      await signInWithGoogle(nextPath);
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Google 登录没跳起来，再试一次看看。',
      });
      setIsGoogleSubmitting(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    if (!form.email.trim() || !form.password.trim()) {
      setFeedback({ type: 'error', text: '邮箱和密码都不能为空。' });
      return;
    }

    if (mode === 'register') {
      if (!form.fullName.trim()) {
        setFeedback({ type: 'error', text: '注册时需要填写你的名字。' });
        return;
      }
      if (form.password.length < 8) {
        setFeedback({ type: 'error', text: '密码至少需要 8 位。' });
        return;
      }
      if (form.password !== form.confirmPassword) {
        setFeedback({ type: 'error', text: '两次输入的密码不一致。' });
        return;
      }
    }

    setIsFormSubmitting(true);
    try {
      if (mode === 'login') {
        await signInWithPassword(form.email.trim(), form.password);
      } else {
        const result = await signUpWithPassword({
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          password: form.password,
        });

        if (result.requiresEmailConfirmation) {
          setFeedback({
            type: 'success',
            text: '已经提交好了。如果邮箱里有确认信，先点一下，再回来登录。',
          });
        }
      }
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : '这次没登进去，再试一次看看。',
      });
    } finally {
      setIsFormSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen px-6 py-6">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-7xl gap-6 lg:grid-cols-[1.02fr_0.98fr]">
        <motion.section
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass relative overflow-hidden rounded-[36px] p-8 md:p-10 jelly-shadow"
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-8 top-12 h-40 w-40 rounded-full bg-apple-blue/15 blur-3xl" />
            <div className="absolute right-8 top-24 h-52 w-52 rounded-full bg-apple-teal/12 blur-3xl" />
            <div className="absolute bottom-0 left-1/3 h-44 w-44 rounded-full bg-apple-green/14 blur-3xl" />
          </div>

          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.28em] text-apple-blue">
              <Sparkles className="h-3.5 w-3.5" />
              登录入口
            </div>

            <h1 className="mt-6 max-w-3xl text-5xl font-black leading-[0.98] tracking-tight text-text-primary md:text-6xl">
              先登录，回来时才接得上。
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-text-secondary">
              词库、复习安排和学习进度都跟着账号走。先把你认出来，后面就不会乱。
            </p>

            <div className="mt-10 grid gap-4">
              {insightCards.map((card, index) => (
                <motion.div
                  key={card.title}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 + index * 0.07 }}
                  className="rounded-[30px] border border-white/65 bg-white/68 p-6 shadow-[0_18px_40px_rgba(0,0,0,0.05)] backdrop-blur-2xl"
                >
                  <h2 className="text-xl font-black text-text-primary">{card.title}</h2>
                  <p className="mt-3 text-sm leading-7 text-text-secondary">{card.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass rounded-[36px] p-6 md:p-8 jelly-shadow"
        >
          <div className="flex items-center justify-between gap-3 rounded-[28px] border border-white/60 bg-white/55 p-2 shadow-[0_16px_30px_rgba(0,0,0,0.04)] backdrop-blur-xl">
            {([
              { id: 'login', label: '登录' },
              { id: 'register', label: '注册' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMode(tab.id)}
                className={`flex-1 rounded-[22px] px-4 py-3 text-sm font-black transition-all ${
                  mode === tab.id
                    ? 'bg-apple-blue text-white shadow-[0_16px_30px_rgba(0,122,255,0.24)]'
                    : 'text-text-secondary hover:bg-white/70'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.22 }}
              className="mt-8"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-apple-blue">{title.kicker}</p>
              <h2 className="mt-3 text-4xl font-black leading-tight tracking-tight text-text-primary">
                {title.heading}
              </h2>
              <p className="mt-4 text-sm leading-7 text-text-secondary">{title.body}</p>

              {isGoogleAuthEnabled ? (
                <button
                  type="button"
                  disabled={isAuthLoading || isGoogleSubmitting}
                  onClick={() => { void handleGoogle(); }}
                  className="mt-8 flex w-full items-center justify-center gap-3 rounded-[30px] bg-[#111827] px-6 py-5 text-base font-black text-white shadow-[0_22px_40px_rgba(17,24,39,0.24)] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <Chrome className="h-5 w-5" />
                  {isGoogleSubmitting ? '正在跳转到 Google…' : '使用 Google 继续'}
                </button>
              ) : (
                <div className="mt-8 rounded-[28px] border border-[#D6B36A]/30 bg-[#FFF6DF] px-5 py-4 text-sm font-medium leading-7 text-[#8A5A14]">
                  当前线上先开放邮箱密码登录，Google 登录会在 provider 配好之后再打开。
                </div>
              )}

              <div className="mt-8 rounded-[28px] border border-white/60 bg-white/56 p-5 backdrop-blur-xl">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">备用方式</p>
                <p className="mt-2 text-sm leading-7 text-text-secondary">
                  如果你更习惯邮箱密码，也可以用这个。不赶时间的话，慢一点也没关系。
                </p>
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                {mode === 'register' && (
                  <AuthField
                    icon={UserRound}
                    label="名字"
                    type="text"
                    value={form.fullName}
                    onChange={(value) => updateField('fullName', value)}
                    placeholder="例如：Alex"
                  />
                )}

                <AuthField
                  icon={Mail}
                  label="邮箱"
                  type="email"
                  value={form.email}
                  onChange={(value) => updateField('email', value)}
                  placeholder="you@example.com"
                />

                <AuthField
                  icon={Lock}
                  label="密码"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(value) => updateField('password', value)}
                  placeholder="输入你的密码"
                  trailing={(
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="flex h-10 w-10 items-center justify-center rounded-2xl text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                />

                {mode === 'register' && (
                  <AuthField
                    icon={ShieldCheck}
                    label="确认密码"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={form.confirmPassword}
                    onChange={(value) => updateField('confirmPassword', value)}
                    placeholder="再输入一次密码"
                    trailing={(
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        className="flex h-10 w-10 items-center justify-center rounded-2xl text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  />
                )}

                {feedback && (
                  <div
                    className={`rounded-[26px] px-4 py-4 text-sm font-medium ${
                      feedback.type === 'success'
                        ? 'bg-apple-green/10 text-apple-green'
                        : 'bg-apple-red/10 text-apple-red'
                    }`}
                  >
                    {feedback.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isFormSubmitting}
                  className="group flex w-full items-center justify-center gap-3 rounded-[30px] bg-apple-blue px-6 py-5 text-base font-black text-white shadow-[0_22px_40px_rgba(0,122,255,0.28)] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                  {isFormSubmitting ? '稍等一下…' : title.cta}
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1.5" />
                </button>
              </form>

              <button
                type="button"
                onClick={() => navigate('/')}
                className="mt-6 w-full rounded-[24px] border border-white/65 bg-white/70 px-5 py-4 text-sm font-black text-text-secondary transition-colors hover:bg-white"
              >
                回到首页
              </button>

              <p className="mt-5 text-center text-xs leading-6 text-text-secondary">
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
            </motion.div>
          </AnimatePresence>
        </motion.section>
      </div>
    </div>
  );
};
