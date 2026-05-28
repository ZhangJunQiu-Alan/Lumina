import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import RootApp from './RootApp.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { LearningPreferencesProvider } from './contexts/LearningPreferencesContext.tsx';
import 'animal-island-ui/style';
import './index.css';

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
