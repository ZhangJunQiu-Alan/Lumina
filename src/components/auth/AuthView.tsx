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
import { IslandButton, IslandIconButton, IslandPanel } from '../shared/AnimalPrimitives';

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
    kicker: '继续学习',
    heading: '让今天的学习接上昨天。',
    body: '登录后，Lumina 会同步你的词库、到期复习、未完成学习和设备偏好。',
    cta: '用邮箱登录',
  },
  register: {
    kicker: '保存进度',
    heading: '创建账号，把第一组词变成长期进度。',
    body: '从第一次学习开始记录复习间隔、错词来源和播放偏好，换设备也能继续。',
    cta: '创建账号',
  },
  forgot: {
    kicker: '找回账号',
    heading: '先找回密码，不用重新开始。',
    body: '输入注册邮箱。若账号存在，我们会发送一封安全重置邮件。',
    cta: '发送重置邮件',
  },
  reset: {
    kicker: '重设密码',
    heading: '换一个新密码，进度保持不变。',
    body: '保存后重置链接会失效，你可以继续回到原来的词库和复习安排。',
    cta: '更新密码并继续',
  },
};

const storyCopy: Record<AuthMode, { title: string; body: string; items: string[]; focus: string }> = {
  login: {
    title: '让今天的学习接上昨天。',
    body: 'Lumina 会把你上次停下的词、今日到期复习和学习偏好放回同一个入口。',
    items: ['读取未完成学习', '同步今日复习队列', '保留发音与播放偏好'],
    focus: '继续上次停下的词',
  },
  register: {
    title: '先保存进度，再开始第一组词。',
    body: '账号会记录见过的词、复习间隔、错题来源和设备偏好，让学习不再从零开始。',
    items: ['保存第一组学习记录', '建立个人复习节奏', '跨设备继续学习'],
    focus: '从第一组词开始记录',
  },
  forgot: {
    title: '不用重新开始。',
    body: '重置密码只会更新登录方式，你的词库、状态和复习安排仍然保留。',
    items: ['发送安全重置链接', '保留原有学习数据', '完成后回到登录入口'],
    focus: '找回账号入口',
  },
  reset: {
    title: '换个新密码，进度不变。',
    body: '新密码保存后，你可以继续使用原来的学习进度。',
    items: ['确认两次新密码', '保存后链接失效', '继续原有学习进度'],
    focus: '更新登录方式',
  },
};

const authProgressStats = [
  { label: '今日复习', value: '48', note: '到期词' },
  { label: '继续学习', value: '12', note: '未完成' },
  { label: '长期掌握', value: '1,286', note: '已稳定' },
];

const authBenefitTiles: Array<{ icon: LucideIcon; title: string; text: string; tone: 'mint' | 'yellow' | 'blue' }> = [
  {
    icon: BookOpen,
    title: '词库不丢',
    text: '官方词库、自定义词和保存词统一跟随账号。',
    tone: 'mint',
  },
  {
    icon: History,
    title: '复习不断',
    text: '每天先看到最该复习的内容，减少临时翻找。',
    tone: 'yellow',
  },
  {
    icon: Sparkles,
    title: '偏好保留',
    text: '播放速度、发音和练习设置会自动恢复。',
    tone: 'blue',
  },
];

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
  const rawMessage =
    searchParams.get('error_description') ??
    searchParams.get('error') ??
    hashParams.get('error_description') ??
    hashParams.get('error');

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
    <main className="auth-page min-h-svh overflow-x-hidden px-4 py-5 sm:px-6 md:py-7 lg:px-8">
      <div className="auth-shell mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(430px,0.88fr)] lg:items-stretch">
        <motion.aside
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45 }}
          className="auth-story-panel"
        >
          <div className="auth-story-header">
            <LuminaLogo size={42} wordmarkClassName="auth-wordmark" />
            <span>账号入口</span>
          </div>

          <div className="auth-story-copy">
            <h1>{story.title}</h1>
            <p>{story.body}</p>
          </div>

          <section className="auth-status-card" aria-label="学习状态预览">
            <div className="auth-status-card__header">
              <div>
                <span>今日学习状态</span>
                <strong>{story.focus}</strong>
              </div>
              <span className="auth-status-pill">已保存</span>
            </div>

            <div className="auth-stat-grid">
              {authProgressStats.map((item) => (
                <div key={item.label} className="auth-stat-item">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <em>{item.note}</em>
                </div>
              ))}
            </div>

            <div className="auth-next-step">
              <span>下一步</span>
              <p>先处理到期复习，再回到上次未完成的学习内容。</p>
            </div>
          </section>

          <section className="auth-route-card" aria-label="账号同步内容">
            <div className="auth-route-card__header">
              <span>进度同步</span>
              <strong>{mode === 'register' ? '从第一组词开始记录' : '从上次位置继续'}</strong>
            </div>
            <div className="auth-route-card__line" />
            {story.items.map((item, index) => (
              <div key={item} className="auth-route-stop">
                <span className="auth-route-stop__pin">{index + 1}</span>
                <span>{item}</span>
              </div>
            ))}
          </section>

          <div className="auth-benefit-grid">
            {authBenefitTiles.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className={`auth-benefit-card auth-benefit-card--${item.tone}`}>
                  <span className="auth-benefit-card__icon">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <h2>{item.title}</h2>
                    <p>{item.text}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </motion.aside>

        <motion.section
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.04 }}
          className="auth-form-stage"
        >
          <IslandPanel as="div" variant="elevated" className="auth-form-panel">
            <div className="auth-tab-switcher" role="tablist" aria-label="账号操作">
              {(
                [
                  { id: 'login', label: '登录' },
                  { id: 'register', label: '注册' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === tab.id}
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
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.22 }}
                className="auth-form-content"
              >
                {title.kicker && <p className="auth-form-kicker">{title.kicker}</p>}
                <h2 className="auth-form-title">{title.heading}</h2>
                {title.body && <p className="auth-form-body">{title.body}</p>}

                {(mode === 'login' || mode === 'register') &&
                  (isGoogleAuthEnabled ? (
                    <>
                      <button
                        type="button"
                        disabled={isAuthLoading || isGoogleSubmitting}
                        aria-busy={isGoogleSubmitting}
                        onClick={() => {
                          void handleGoogle();
                        }}
                        className="auth-google-button"
                      >
                        <Chrome className="h-[18px] w-[18px] opacity-90" />
                        {isGoogleSubmitting ? '正在跳到 Google...' : '用 Google 登录'}
                      </button>
                      <div className="auth-divider">或用邮箱</div>
                    </>
                  ) : (
                    <div className="auth-google-disabled">当前只能使用邮箱登录。Google 入口恢复后会显示在这里。</div>
                  ))}

                <form onSubmit={handleSubmit} className="auth-form-fields">
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
                        trailing={
                          <IslandIconButton
                            type="button"
                            onClick={() => setShowPassword((prev) => !prev)}
                            className="h-10 w-10 border-0 bg-transparent shadow-none hover:shadow-none"
                            aria-label={showPassword ? '隐藏密码' : '显示密码'}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </IslandIconButton>
                        }
                      />

                      {showPasswordStrength && (
                        <div className="auth-password-meter">
                          <div className="auth-password-meter__header">
                            <p className={passwordStrength.textClass}>{passwordStrength.label}</p>
                            <p>{Math.min(passwordStrength.score, 5)} / 5</p>
                          </div>
                          <div className="auth-password-meter__bars">
                            {Array.from({ length: 5 }, (_, index) => (
                              <div
                                key={index}
                                className={`${
                                  index < passwordStrength.score
                                    ? passwordStrength.colorClass
                                    : 'auth-password-meter__bar-empty'
                                }`}
                              />
                            ))}
                          </div>
                          <p className="auth-password-meter__detail">{passwordStrength.detail}</p>
                        </div>
                      )}

                      {mode === 'login' && (
                        <button type="button" onClick={() => switchMode('forgot')} className="auth-forgot-button">
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
                      trailing={
                        <IslandIconButton
                          type="button"
                          onClick={() => setShowConfirmPassword((prev) => !prev)}
                          className="h-10 w-10 border-0 bg-transparent shadow-none hover:shadow-none"
                          aria-label={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
                        >
                          {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </IslandIconButton>
                      }
                    />
                  )}

                  {feedback && <div className={`auth-feedback auth-feedback--${feedback.type}`}>{feedback.text}</div>}

                  {pendingConfirmationEmail && mode === 'register' && (
                    <div className="auth-confirmation-card">
                      <p>没收到确认邮件？</p>
                      <span>我们会重新发到 {pendingConfirmationEmail}，短时间内频繁发送可能会被限制。</span>
                      <button
                        type="button"
                        onClick={() => {
                          void handleResendConfirmation();
                        }}
                        disabled={isResendingConfirmation}
                        className="auth-resend-button"
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
                  className="auth-secondary-button"
                >
                  {mode === 'forgot' || mode === 'reset' ? '回到登录' : '返回首页'}
                </IslandButton>

                <p className="auth-legal-copy">
                  继续使用即表示你同意 <Link to="/terms">服务条款</Link> 和 <Link to="/privacy">隐私政策</Link>。
                </p>
              </motion.div>
            </AnimatePresence>
          </IslandPanel>
        </motion.section>
      </div>
    </main>
  );
};
