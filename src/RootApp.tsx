import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import App from './App';
import { AuthView } from './components/auth/AuthView';
import { LandingView } from './components/landing/LandingView';
import { PrivacyView, TermsView } from './components/legal/LegalView';
import { useAuth } from './contexts/AuthContext';

function FullscreenLoader({ message }: { message: string }) {
  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass flex w-full max-w-xl flex-col items-center gap-5 rounded-apple-lg p-12 text-center jelly-shadow"
        >
          <Loader2 className="h-10 w-10 animate-spin text-apple-blue" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">Lumina IELTS</p>
            <p className="mt-3 text-2xl font-black text-text-primary">{message}</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isAuthLoading } = useAuth();
  const location = useLocation();

  if (isAuthLoading) {
    return <FullscreenLoader message="正在把你的进度接回来" />;
  }

  if (!isAuthenticated) {
    const nextPath = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth?next=${encodeURIComponent(nextPath)}`} replace />;
  }

  return <>{children}</>;
}

function PublicOnlyAuthRoute() {
  const { isAuthenticated, isAuthLoading } = useAuth();
  const location = useLocation();

  if (isAuthLoading) {
    return <FullscreenLoader message="正在确认登录状态" />;
  }

  if (isAuthenticated) {
    const params = new URLSearchParams(location.search);
    const nextPath = params.get('next');
    const target = nextPath?.startsWith('/app/') ? nextPath : '/app/home';
    return <Navigate to={target} replace />;
  }

  return <AuthView />;
}

import { GlobalErrorBoundary } from './components/shared/GlobalErrorBoundary';

// ... existing code ...

export default function RootApp() {
  return (
    <GlobalErrorBoundary>
      <Routes>
        <Route path="/" element={<LandingView />} />
        <Route path="/auth" element={<PublicOnlyAuthRoute />} />
        <Route path="/privacy" element={<PrivacyView />} />
        <Route path="/terms" element={<TermsView />} />
        <Route
          path="/app/*"
          element={(
            <ProtectedRoute>
              <App />
            </ProtectedRoute>
          )}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </GlobalErrorBoundary>
  );
}
