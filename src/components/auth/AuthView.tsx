import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  BookOpen,
  Chrome,
  Eye,
  EyeOff,
  History,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isGoogleAuthEnabled } from '../../lib/authFeatures';
import { formatAuthErrorFeedback } from '../../lib/authErrors';
import { LuminaLogo } from '../brand/LuminaLogo';
import { IslandBadge, IslandButton, IslandIconButton, IslandPanel } from '../shared/AnimalPrimitives';

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
    kicker: '回到进度',
    heading: '登录后，继续上次停下的词。',
    body: '词库、复习安排、学习偏好和未完成内容都会保存在账号里。',
    cta: '用邮箱登录',
  },
  register: {
    kicker: '保存学习状态',
    heading: '创建账号，保存从第一组词开始的进度。',
    body: '之后的复习时间、错误记录和偏好设置都会跟着这个账号。',
    cta: '创建账号',
  },
  forgot: {
    kicker: '找回入口',
    heading: '输入邮箱，我们把重置链接发给你。',
    body: '如果这个邮箱已经注册，重置邮件会在几分钟内送达。',
    cta: '发送重置邮件',
  },
  reset: {
    kicker: '重设密码',
    heading: '设置一个新的登录密码。',
    body: '保存后这个重置链接会失效，你可以继续今天的学习。',
    cta: '更新密码并继续',
  },
};

const storyCopy: Record<AuthMode, { title: string; body: string; items: string[] }> = {
  login: {
    title: '你的学习进度还在。',
    body: '登录后，今日到期复习、未完成学习和偏好设置都会重新排好。',
    items: ['继续未完成学习', '同步今日复习队列', '保留发音与播放偏好'],
  },
  register: {
    title: '先保存进度，再开始学习。',
    body: '账号用来保存见过的词、复习时间和设备偏好。',
    items: ['保存第一组学习记录', '建立个人复习节奏', '跨设备继续学习'],
  },
  forgot: {
    title: '不用重新开始。',
    body: '重置密码只会更新登录方式，你的词库、状态和复习安排仍然保留。',
    items: ['发送安全重置链接', '保留原有学习数据', '完成后回到登录入口'],
  },
  reset: {
    title: '换个新密码，进度不变。',
    body: '新密码保存后，你可以继续使用原来的学习进度。',
    items: ['确认两次新密码', '保存后链接失效', '继续原有学习进度'],
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
      label: '等待输入',
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
    return 'Google 登录这次没有成功。你可以先用邮箱登录；如果这个问题一直出现，再联系支持处理。';
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
  icon: LucideIcon;
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
      <span className="text-[11px] font-black uppercase tracking-[0.22em] text-text-secondary">{label}</span>
      <div className="auth-field-shell">
        <div className="auth-field-icon">
          <Icon className="h-4 w-4" />
        </div>
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-base font-bold text-text-primary outline-none placeholder:font-semibold placeholder:text-text-secondary"
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
  const title = authModeCopy[mode];
  const story = storyCopy[mode];

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

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setFeedback(null);
    setPendingConfirmationEmail(null);
  };

  const handleGoogle = async () => {
    setFeedback(null);
    setIsGoogleSubmitting(true);
    try {
      await signInWithGoogle(nextPath);
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Google 登录这次没有成功。你可以再试一次，或者先用邮箱登录。',
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
          text: '账号已创建。请到邮箱确认后再回来继续。',
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
    <main className="auth-page min-h-screen px-3 py-5 sm:px-4 md:px-8 md:py-8">
      <div className="mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-6xl items-start gap-5 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
        <motion.aside
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45 }}
          className="auth-pass-panel w-full min-w-0"
        >
          <LuminaLogo size={42} />
          <IslandBadge tone="yellow" className="mt-6 md:mt-8">账号入口</IslandBadge>
          <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight text-text-primary sm:text-4xl md:mt-5 md:text-5xl">
            {story.title}
          </h1>
          <p className="mt-4 text-base font-bold leading-7 text-text-secondary md:mt-5 md:leading-8">
            {story.body}
          </p>

          <div className="auth-route-card mt-6 md:mt-9">
            <div className="auth-route-card__line" />
            {story.items.map((item, index) => (
              <div key={item} className="auth-route-stop">
                <span className="auth-route-stop__pin">{index + 1}</span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3 md:mt-8 lg:grid-cols-1 xl:grid-cols-3">
            {[
              { icon: BookOpen, label: '词库' },
              { icon: History, label: '复习' },
              { icon: Sparkles, label: '偏好' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="auth-mini-token">
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        </motion.aside>

        <motion.section
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.04 }}
          className="w-full min-w-0"
        >
          <IslandPanel as="div" variant="elevated" className="auth-form-panel w-full max-w-full p-5 md:p-8">
            <div className="auth-tab-switcher">
              {([
                { id: 'login', label: '登录' },
                { id: 'register', label: '注册' },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => switchMode(tab.id)}
                  className={`auth-tab-button ${mode === tab.id ? 'auth-tab-button--active' : ''}`}
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
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-apple-blue">{title.kicker}</p>
                )}
                <h2 className={`${title.kicker ? 'mt-3' : ''} text-3xl font-black leading-tight tracking-tight text-text-primary md:text-4xl`}>
                  {title.heading}
                </h2>
                {title.body && <p className="mt-4 text-sm font-semibold leading-7 text-text-secondary">{title.body}</p>}

                {(mode === 'login' || mode === 'register') && (isGoogleAuthEnabled ? (
                  <>
                    <button
                      type="button"
                      disabled={isAuthLoading || isGoogleSubmitting}
                      aria-busy={isGoogleSubmitting}
                      onClick={() => { void handleGoogle(); }}
                      className="mt-7 flex w-full items-center justify-center gap-2.5 rounded-[22px] bg-[#2c1c0e] px-6 py-[14px] text-sm font-black tracking-wide text-[#fff8e8] shadow-[0_3px_0_0_#180e06,0_12px_24px_rgba(44,28,14,0.18)] transition-all hover:-translate-y-0.5 active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <Chrome className="h-[18px] w-[18px] opacity-90" />
                      {isGoogleSubmitting ? '正在跳到 Google...' : '用 Google 登录'}
                    </button>
                    <div className="auth-divider">或用邮箱</div>
                  </>
                ) : (
                  <div className="mt-8 rounded-[20px] border border-[#ead99d] bg-[#fff9e8] px-5 py-4 text-sm font-bold leading-7 text-[#8a5a14]">
                    当前只能使用邮箱登录。Google 入口恢复后会显示在这里。
                  </div>
                ))}

                <form onSubmit={handleSubmit} className="mt-7 space-y-4">
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
                          <IslandIconButton
                            type="button"
                            onClick={() => setShowPassword((prev) => !prev)}
                            className="h-10 w-10 border-0 bg-transparent shadow-none hover:shadow-none"
                            aria-label={showPassword ? '隐藏密码' : '显示密码'}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </IslandIconButton>
                        )}
                      />

                      {showPasswordStrength && (
                        <div className="rounded-[18px] border border-[#e0d4bc]/80 bg-[#faf8f2] px-4 py-3.5">
                          <div className="flex items-center justify-between gap-3">
                            <p className={`text-[11px] font-black uppercase tracking-[0.12em] ${passwordStrength.textClass}`}>
                              {passwordStrength.label}
                            </p>
                            <p className="text-[11px] font-bold text-text-secondary/60">{Math.min(passwordStrength.score, 5)} / 5</p>
                          </div>
                          <div className="mt-2.5 grid grid-cols-5 gap-1">
                            {Array.from({ length: 5 }, (_, index) => (
                              <div
                                key={index}
                                className={`h-1 rounded-full transition-colors duration-300 ${
                                  index < passwordStrength.score ? passwordStrength.colorClass : 'bg-black/8'
                                }`}
                              />
                            ))}
                          </div>
                          <p className="mt-2.5 text-[11px] font-semibold leading-5 text-text-secondary">{passwordStrength.detail}</p>
                        </div>
                      )}

                      {mode === 'login' && (
                        <button
                          type="button"
                          onClick={() => switchMode('forgot')}
                          className="-mt-1 text-xs font-black text-[#19c8b9] transition-colors hover:text-[#0fada0]"
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
                        <IslandIconButton
                          type="button"
                          onClick={() => setShowConfirmPassword((prev) => !prev)}
                          className="h-10 w-10 border-0 bg-transparent shadow-none hover:shadow-none"
                          aria-label={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
                        >
                          {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </IslandIconButton>
                      )}
                    />
                  )}

                  {feedback && (
                    <div
                      className={`rounded-[18px] border px-4 py-3.5 text-sm font-bold leading-6 ${
                        feedback.type === 'success'
                          ? 'border-apple-green/20 bg-apple-green/8 text-apple-green'
                          : 'border-apple-red/18 bg-apple-red/8 text-apple-red'
                      }`}
                    >
                      {feedback.text}
                    </div>
                  )}

                  {pendingConfirmationEmail && mode === 'register' && (
                    <div className="rounded-[26px] border-2 border-apple-green/18 bg-apple-green/8 px-4 py-4 text-sm leading-7 text-text-secondary">
                      <p className="font-black text-text-primary">没收到确认邮件？</p>
                      <p className="mt-1 font-semibold">我们会重新发到 {pendingConfirmationEmail}，短时间内频繁发送可能会被限制。</p>
                      <button
                        type="button"
                        onClick={() => { void handleResendConfirmation(); }}
                        disabled={isResendingConfirmation}
                        className="mt-3 rounded-2xl bg-white/80 px-4 py-2 text-xs font-black text-apple-green shadow-sm transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isResendingConfirmation ? '正在重发...' : '重发确认邮件'}
                      </button>
                    </div>
                  )}

                  <IslandButton
                    htmlType="submit"
                    disabled={isFormSubmitting}
                    block
                    tone="mint"
                    size="large"
                    icon={<ArrowRight className="h-5 w-5" />}
                  >
                    {isFormSubmitting ? '正在接入...' : title.cta}
                  </IslandButton>
                </form>

                <IslandButton
                  htmlType="button"
                  onClick={() => {
                    if (mode === 'forgot' || mode === 'reset') {
                      switchMode('login');
                      return;
                    }
                    navigate('/');
                  }}
                  tone="neutral"
                  block
                  className="mt-6"
                >
                  {mode === 'forgot' || mode === 'reset' ? '回到登录' : '返回首页'}
                </IslandButton>

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
          </IslandPanel>
        </motion.section>
      </div>
    </main>
  );
};
