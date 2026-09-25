import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { isGoogleAuthEnabled } from '../lib/authFeatures';
import { setObservabilityUser } from '../lib/observability/sentry';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  isPasswordRecovery: boolean;
  signInWithGoogle: (nextPath?: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (input: {
    fullName: string;
    email: string;
    password: string;
  }) => Promise<{ requiresEmailConfirmation: boolean }>;
  requestPasswordReset: (email: string, nextPath?: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  resendSignupConfirmation: (email: string, nextPath?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildAuthRedirect(nextPath?: string) {
  const redirectUrl = new URL('/auth', window.location.origin);
  if (nextPath?.startsWith('/')) {
    redirectUrl.searchParams.set('next', nextPath);
  }
  return redirectUrl.toString();
}

function hasPasswordRecoveryMarker() {
  if (typeof window === 'undefined') return false;

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(
    window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash,
  );
  return searchParams.get('type') === 'recovery' || hashParams.get('type') === 'recovery';
}

function canReuseUser(current: User | null, next: User | null) {
  if (!current || !next) return current === next;

  return (
    current.id === next.id &&
    current.email === next.email &&
    current.user_metadata?.full_name === next.user_metadata?.full_name
  );
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => hasPasswordRecoveryMarker());

  useEffect(() => {
    let active = true;

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      setSession(nextSession);
      const nextUser = nextSession?.user ?? null;
      setObservabilityUser(nextUser ? { id: nextUser.id, email: nextUser.email } : null);
      setUser((current) => (canReuseUser(current, nextUser) ? current : nextUser));
      setIsAuthLoading(false);

      if (event === 'PASSWORD_RECOVERY' || hasPasswordRecoveryMarker()) {
        setIsPasswordRecovery(true);
      } else if (event === 'SIGNED_OUT') {
        setIsPasswordRecovery(false);
        setObservabilityUser(null);
      }
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('Failed to restore auth session:', error.message);
      }
      if (!active) return;

      setSession(data.session ?? null);
      const nextUser = data.session?.user ?? null;
      setObservabilityUser(nextUser ? { id: nextUser.id, email: nextUser.email } : null);
      setUser((current) => (canReuseUser(current, nextUser) ? current : nextUser));
      setIsAuthLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      isAuthenticated: Boolean(session?.user),
      isAuthLoading,
      isPasswordRecovery,
      async signInWithGoogle(nextPath) {
        if (!isGoogleAuthEnabled) {
          throw new Error('Google 登录暂未配置，请先使用邮箱登录。');
        }

        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: buildAuthRedirect(nextPath),
            scopes: 'openid email profile https://www.googleapis.com/auth/userinfo.email',
          },
        });

        if (error) throw error;
      },
      async signInWithPassword(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signUpWithPassword({ fullName, email, password }) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: buildAuthRedirect('/app/home'),
            data: {
              full_name: fullName,
            },
          },
        });

        if (error) throw error;
        return { requiresEmailConfirmation: !data.session };
      },
      async requestPasswordReset(email, nextPath) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: buildAuthRedirect(nextPath),
        });
        if (error) throw error;
      },
      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setIsPasswordRecovery(false);
      },
      async resendSignupConfirmation(email, nextPath) {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email,
          options: {
            emailRedirectTo: buildAuthRedirect(nextPath ?? '/app/home'),
          },
        });
        if (error) throw error;
      },
      async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    }),
    [isAuthLoading, isPasswordRecovery, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
