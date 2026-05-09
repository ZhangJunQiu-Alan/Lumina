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

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

interface FormState {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface AuthModeCopy {
  kicker?: string;
  heading: string;
  body?: string;
  cta: string;
}

const defaultFormState: FormState = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
};

const authModeCopy: Record<AuthMode, AuthModeCopy> = {
  login: {
    kicker: '接上进度',
    heading: '登录一下，把上次那一段接回来。',
    body: '账号一接上，词库、复习安排和学习进度都会跟着回来，不用重新找感觉。',
    cta: '用邮箱接上',
  },
  register: {
    kicker: '建立轨迹',
    heading: '先建一个账号，让这条词汇轨迹留下来。',
    body: '从这次开始，系统会记住你学过什么、卡在哪，以及下次该从哪里继续。',
    cta: '创建并进入系统',
  },
  forgot: {
    heading: '输入已注册邮箱，重置你的密码。',
    cta: '发送重置邮件',
  },
  reset: {
    kicker: '重设密码',
    heading: '设置一个新的登录密码。',
    body: '新密码保存后，这个重置链接就会失效，你可以直接回到学习系统。',
    cta: '更新密码并进入系统',
  },
};

function getPasswordStrength(password: string) {
  const checks = [
    password.length >= 8,
    password.length >= 12,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;

  if (!password) {
    return {
      score: 0,
      label: '先输入一个新密码',
      detail: '建议至少 12 位，混合大小写、数字或符号。',
      colorClass: 'bg-black/10',
      textClass: 'text-text-secondary',
    };
  }
  if (score <= 2) {
    return {
      score,
      label: '偏弱',
      detail: '再加长一点，最好混合大小写、数字或符号。',
      colorClass: 'bg-apple-red',
      textClass: 'text-apple-red',
    };
  }
  if (score <= 4) {
    return {
      score,
      label: '可用',
      detail: '已经达到基本要求，继续加长会更稳。',
      colorClass: 'bg-apple-orange',
      textClass: 'text-apple-orange',
    };
  }

  return {
    score,
    label: '强',
    detail: '这个密码强度不错，适合长期使用。',
    colorClass: 'bg-apple-green',
    textClass: 'text-apple-green',
  };
}

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

function hasPasswordRecoveryMarker(search: string, hash: string) {
  const searchParams = new URLSearchParams(search);
  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return searchParams.get('type') === 'recovery' || hashParams.get('type') === 'recovery';
}

function AuthField({
  icon: Icon,
  label,
  type,
  value,
  onChange,
  placeholder,
  trailing,
  autoComplete,
}: {
  icon: typeof Mail;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  trailing?: ReactNode;
  autoComplete?: string;
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
          autoComplete={autoComplete}
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
    isPasswordRecovery,
    signInWithGoogle,
    signInWithPassword,
    signUpWithPassword,
    requestPasswordReset,
    updatePassword,
    resendSignupConfirmation,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('login');
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [isResendingConfirmation, setIsResendingConfirmation] = useState(false);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const nextPath = useMemo(() => safeNextPath(searchParams), [searchParams]);
  const oauthError = useMemo(() => readOAuthError(location.search, location.hash), [location.hash, location.search]);
  const isPasswordRecoveryUrl = useMemo(
    () => hasPasswordRecoveryMarker(location.search, location.hash),
    [location.hash, location.search],
  );
  const passwordStrength = useMemo(() => getPasswordStrength(form.password), [form.password]);
  const showPasswordStrength = mode === 'register' || mode === 'reset';
  useEffect(() => {
    const nextMode = searchParams.get('mode');
    if (nextMode === 'login' || nextMode === 'register' || nextMode === 'forgot' || nextMode === 'reset') {
      setMode(nextMode);
    }
  }, [searchParams]);

  useEffect(() => {
    if (isPasswordRecovery || isPasswordRecoveryUrl) {
      setMode('reset');
      setFeedback(null);
    }
  }, [isPasswordRecovery, isPasswordRecoveryUrl]);

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
    if (!isAuthLoading && isAuthenticated && !isPasswordRecovery && !isPasswordRecoveryUrl) {
      navigate(nextPath, { replace: true });
    }
  }, [isAuthenticated, isAuthLoading, isPasswordRecovery, isPasswordRecoveryUrl, navigate, nextPath]);

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const title = authModeCopy[mode];

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

  const handleResendConfirmation = async () => {
    const email = pendingConfirmationEmail ?? form.email.trim();
    if (!email) return;

    setFeedback(null);
    setIsResendingConfirmation(true);
    try {
      await resendSignupConfirmation(email, nextPath);
      setFeedback({
        type: 'success',
        text: '确认邮件已经重新发送。如果收件箱没有看到，可以看一下垃圾邮件或稍等一分钟。',
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        text: formatAuthErrorFeedback(error),
      });
    } finally {
      setIsResendingConfirmation(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    const email = form.email.trim();

    if (mode === 'forgot') {
      if (!email) {
        setFeedback({ type: 'error', text: '先填一下注册邮箱。' });
        return;
      }

      setIsFormSubmitting(true);
      try {
        await requestPasswordReset(email, nextPath);
        setFeedback({
          type: 'success',
          text: '如果这个邮箱在 Lumina 有账号，我们会发送一封密码重置邮件。',
        });
      } catch (error) {
        setFeedback({
          type: 'error',
          text: formatAuthErrorFeedback(error),
        });
      } finally {
        setIsFormSubmitting(false);
      }
      return;
    }

    if (mode === 'reset') {
      if (!form.password.trim() || !form.confirmPassword.trim()) {
        setFeedback({ type: 'error', text: '新密码和确认密码都还没填。' });
        return;
      }
      if (form.password.length < 8) {
        setFeedback({ type: 'error', text: '密码至少需要 8 位。' });
        return;
      }
      if (form.password !== form.confirmPassword) {
        setFeedback({ type: 'error', text: '两次输入的新密码没对上。' });
        return;
      }

      setIsFormSubmitting(true);
      try {
        await updatePassword(form.password);
        navigate(nextPath, { replace: true });
      } catch (error) {
        setFeedback({
          type: 'error',
          text: formatAuthErrorFeedback(error),
        });
      } finally {
        setIsFormSubmitting(false);
      }
      return;
    }

    if (!email || !form.password.trim()) {
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
        await signInWithPassword(email, form.password);
      } else {
        const result = await signUpWithPassword({
          fullName: form.fullName.trim(),
          email,
          password: form.password,
        });

        if (result.requiresEmailConfirmation) {
          setPendingConfirmationEmail(email);
          setFeedback({
            type: 'success',
            text: '账号已经建好。去邮箱点一下确认链接，再回来接上进度。',
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
                onClick={() => {
                  setMode(tab.id);
                  setFeedback(null);
                  setPendingConfirmationEmail(null);
                }}
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
              {title.kicker && (
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-apple-blue">{title.kicker}</p>
              )}
              <h2 className={`${title.kicker ? 'mt-3' : ''} text-4xl font-black leading-tight tracking-tight text-text-primary`}>
                {title.heading}
              </h2>
              {title.body && <p className="mt-4 text-sm leading-7 text-text-secondary">{title.body}</p>}

              {(mode === 'login' || mode === 'register') && (isGoogleAuthEnabled ? (
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
              ))}

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                {mode === 'register' && (
                  <AuthField
                    icon={UserRound}
                    label="显示名字"
                    type="text"
                    value={form.fullName}
                    onChange={(value) => updateField('fullName', value)}
                    placeholder="例如：Alex Chen"
                    autoComplete="name"
                  />
                )}

                {mode !== 'reset' && (
                  <AuthField
                    icon={Mail}
                    label="邮箱"
                    type="email"
                    value={form.email}
                    onChange={(value) => updateField('email', value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                )}

                {mode !== 'forgot' && (
                  <>
                    <AuthField
                      icon={Lock}
                      label={mode === 'reset' ? '新密码' : '密码'}
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(value) => updateField('password', value)}
                      placeholder="输入一个至少 8 位的密码"
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      trailing={(
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          className="flex h-10 w-10 items-center justify-center rounded-2xl text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
                          aria-label={showPassword ? '隐藏密码' : '显示密码'}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      )}
                    />

                    {showPasswordStrength && (
                      <div className="rounded-[24px] border border-white/60 bg-white/58 px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className={`text-xs font-black ${passwordStrength.textClass}`}>
                            密码强度：{passwordStrength.label}
                          </p>
                          <p className="text-[11px] font-bold text-text-secondary">{Math.min(passwordStrength.score, 5)}/5</p>
                        </div>
                        <div className="mt-3 grid grid-cols-5 gap-1.5">
                          {Array.from({ length: 5 }, (_, index) => (
                            <div
                              key={index}
                              className={`h-1.5 rounded-full ${
                                index < passwordStrength.score ? passwordStrength.colorClass : 'bg-black/10'
                              }`}
                            />
                          ))}
                        </div>
                        <p className="mt-3 text-xs font-medium leading-6 text-text-secondary">{passwordStrength.detail}</p>
                      </div>
                    )}

                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('forgot');
                          setFeedback(null);
                        }}
                        className="-mt-2 text-sm font-black text-apple-blue transition-colors hover:text-apple-indigo"
                      >
                        忘记密码？
                      </button>
                    )}
                  </>
                )}

                {(mode === 'register' || mode === 'reset') && (
                  <AuthField
                    icon={ShieldCheck}
                    label={mode === 'reset' ? '确认新密码' : '确认密码'}
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={form.confirmPassword}
                    onChange={(value) => updateField('confirmPassword', value)}
                    placeholder="再输入一次密码"
                    autoComplete="new-password"
                    trailing={(
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        className="flex h-10 w-10 items-center justify-center rounded-2xl text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
                        aria-label={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
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

                {pendingConfirmationEmail && mode === 'register' && (
                  <div className="rounded-[26px] border border-apple-green/18 bg-apple-green/8 px-4 py-4 text-sm leading-7 text-text-secondary">
                    <p className="font-bold text-text-primary">没收到确认邮件？</p>
                    <p className="mt-1">我们会重新发到 {pendingConfirmationEmail}，短时间内频繁发送可能会被限制。</p>
                    <button
                      type="button"
                      onClick={() => { void handleResendConfirmation(); }}
                      disabled={isResendingConfirmation}
                      className="mt-3 rounded-2xl bg-white/80 px-4 py-2 text-xs font-black text-apple-green shadow-sm transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isResendingConfirmation ? '正在重发…' : '重发确认邮件'}
                    </button>
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
                onClick={() => {
                  if (mode === 'forgot' || mode === 'reset') {
                    setMode('login');
                    setFeedback(null);
                    return;
                  }
                  navigate('/');
                }}
                className="mt-6 w-full rounded-[24px] border border-white/65 bg-white/70 px-5 py-4 text-sm font-black text-text-secondary transition-colors hover:bg-white"
              >
                {mode === 'forgot' || mode === 'reset' ? '回到登录' : '先回首页看看'}
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
