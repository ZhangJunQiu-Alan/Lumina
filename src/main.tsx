import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import RootApp from './RootApp.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { LearningPreferencesProvider } from './contexts/LearningPreferencesContext.tsx';
import 'animal-island-ui/style';
import './index.css';
import { readLocal } from './lib/durableStorage';

if (import.meta.env.VITE_NATIVE_APP === 'true') {
  if (window.location.pathname === '/') {
    const account = readLocal<{ user?: { id?: string } }>('lumina.localAuth.session')?.user?.id;
    const savedRoute = account ? readLocal<string>(`lumina.last-route.v1.${account}`) : null;
    window.history.replaceState({}, '', savedRoute?.startsWith('/app/') ? savedRoute : '/app/home');
  }
  void import('./lib/nativeApp').then(({ initializeNativeApp }) => initializeNativeApp());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <LearningPreferencesProvider>
          <RootApp />
        </LearningPreferencesProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
