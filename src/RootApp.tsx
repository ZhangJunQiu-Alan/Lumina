import { MotionConfig, motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { LuminaLogo } from './components/brand/LuminaLogo';
import { IslandPanel } from './components/shared/AnimalPrimitives';
import { useAuth } from './contexts/AuthContext';
import { SyncStatus } from './components/shared/SyncStatus';
import { GlobalErrorBoundary } from './components/shared/GlobalErrorBoundary';

const App = lazy(() => import('./App'));
const LandingView = lazy(() => import('./components/landing/LandingView').then((m) => ({ default: m.LandingView })));
const AuthView = lazy(() => import('./components/auth/AuthView').then((m) => ({ default: m.AuthView })));
const PrivacyView = lazy(() => import('./components/legal/LegalView').then((m) => ({ default: m.PrivacyView })));
const TermsView = lazy(() => import('./components/legal/LegalView').then((m) => ({ default: m.TermsView })));

function FullscreenLoader({ message }: { message: string }) {
  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-xl">
          <IslandPanel
            as="div"
            variant="elevated"
            className="flex flex-col items-center gap-5 p-12 text-center jelly-shadow"
          >
            <Loader2 className="h-10 w-10 animate-spin text-apple-blue" />
            <div>
              <LuminaLogo size={22} className="justify-center" markClassName="h-6 w-6" wordmarkClassName="h-4.5" />
              <p className="mt-3 text-2xl font-black text-text-primary">{message}</p>
            </div>
          </IslandPanel>
        </motion.div>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isAuthLoading } = useAuth();
  const location = useLocation();

  if (isAuthLoading) {
    return <FullscreenLoader message="正在确认登录状态" />;
  }

  if (!isAuthenticated) {
    const nextPath = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth?next=${encodeURIComponent(nextPath)}`} replace />;
  }

  return <>{children}</>;
}

function PublicOnlyAuthRoute() {
  const { isAuthenticated, isAuthLoading, isPasswordRecovery } = useAuth();
  const location = useLocation();

  if (isAuthLoading) {
    return <FullscreenLoader message="正在确认登录状态" />;
  }

  if (isAuthenticated && !isPasswordRecovery) {
    const params = new URLSearchParams(location.search);
    const nextPath = params.get('next');
    const target = nextPath?.startsWith('/app/') ? nextPath : '/app/home';
    return <Navigate to={target} replace />;
  }

  return <AuthView />;
}

export default function RootApp() {
  return (
    <MotionConfig reducedMotion="user">
      <GlobalErrorBoundary>
        <SyncStatus />
        <Suspense fallback={<FullscreenLoader message="正在加载" />}>
          <Routes>
            <Route path="/" element={<LandingView />} />
            <Route path="/auth" element={<PublicOnlyAuthRoute />} />
            <Route path="/privacy" element={<PrivacyView />} />
            <Route path="/terms" element={<TermsView />} />
            <Route
              path="/app/*"
              element={
                <ProtectedRoute>
                  <App />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </GlobalErrorBoundary>
    </MotionConfig>
  );
}
