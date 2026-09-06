import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AuthGate from './components/auth/AuthGate';
import './styles.css';

// The board itself sets this once it mounts, from Settings — but the auth
// screens render before that, and shouldn't flash light before dark takes
// over on a first paint.
try {
  const stored = JSON.parse(localStorage.getItem('tcard-planner.settings.v1') ?? '{}') as { theme?: string };
  const preferDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = stored.theme ?? (preferDark ? 'dark' : 'light');
} catch {
  // Fine to leave unset; the stylesheet's own light-mode default applies.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
);
