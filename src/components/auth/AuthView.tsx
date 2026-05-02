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
  UserRound,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isGoogleAuthEnabled } from '../../lib/authFeatures';
import { formatAuthErrorFeedback } from '../../lib/authErrors';

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
    return 'Google 入口这次没接上。你可以先改用邮箱进入；如果这个问题一直出现，再联系支持处理。';
  }
  if (normalized.includes('provider is not enabled')) {
    return 'Google 入口暂时还没恢复，你可以先用邮箱进入。';
  }
  if (normalized.includes('access_denied')) {
    return '这次没有完成 Google 授权。你可以重试一次，或先改用邮箱进入。';
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
      kicker: '接上进度',
      heading: '登录一下，把上次那一段接回来。',
      body: '账号一接上，词库、复习安排和学习进度都会跟着回来，不用重新找感觉。',
      cta: '用邮箱接上',
    }
    : {
      kicker: '建立轨迹',
      heading: '先建一个账号，让这条词汇轨迹留下来。',
      body: '从这次开始，系统会记住你学过什么、卡在哪，以及下次该从哪里继续。',
      cta: '创建并进入系统',
    };

  const handleGoogle = async () => {
    setFeedback(null);
    setIsGoogleSubmitting(true);
    try {
      await signInWithGoogle(nextPath);
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Google 入口这次没接上。你可以再试一次，或者先用邮箱进入。',
      });
      setIsGoogleSubmitting(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    if (!form.email.trim() || !form.password.trim()) {
      setFeedback({ type: 'error', text: '邮箱和密码都还没填。' });
      return;
    }

    if (mode === 'register') {
      if (!form.fullName.trim()) {
        setFeedback({ type: 'error', text: '先留一个你想显示的名字。' });
        return;
      }
      if (form.password.length < 8) {
        setFeedback({ type: 'error', text: '密码至少需要 8 位。' });
        return;
      }
      if (form.password !== form.confirmPassword) {
        setFeedback({ type: 'error', text: '两次输入的密码没对上。' });
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
            text: '账号已经建好。如果邮箱里有确认信，先点一下，再回来接上进度。',
          });
        }
      }
    } catch (error) {
      setFeedback({
        type: 'error',
        text: formatAuthErrorFeedback(error),
      });
    } finally {
      setIsFormSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen px-6 py-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-3xl items-start">
        <motion.section
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass w-full rounded-[36px] p-6 md:p-8 jelly-shadow"
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
                  {isGoogleSubmitting ? '正在跳到 Google…' : '用 Google 接上'}
                </button>
              ) : (
                <div className="mt-8 rounded-[28px] border border-[#D6B36A]/30 bg-[#FFF6DF] px-5 py-4 text-sm font-medium leading-7 text-[#8A5A14]">
                  当前先开放邮箱进入。Google 入口恢复后，会自动回到这里。
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                {mode === 'register' && (
                  <AuthField
                    icon={UserRound}
                    label="显示名字"
                    type="text"
                    value={form.fullName}
                    onChange={(value) => updateField('fullName', value)}
                    placeholder="例如：Alex Chen"
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
                  placeholder="输入一个至少 8 位的密码"
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
                  {isFormSubmitting ? '正在接入…' : title.cta}
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1.5" />
                </button>
              </form>

              <button
                type="button"
                onClick={() => navigate('/')}
                className="mt-6 w-full rounded-[24px] border border-white/65 bg-white/70 px-5 py-4 text-sm font-black text-text-secondary transition-colors hover:bg-white"
              >
                先回首页看看
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
