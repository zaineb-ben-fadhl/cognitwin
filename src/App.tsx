import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useStore } from './store';
import TodayPage from './pages/Today';

const WelcomePage = lazy(() => import('./pages/Welcome'));
const AssessPage = lazy(() => import('./pages/Assess'));
const TrainPage = lazy(() => import('./pages/Train'));
const SessionPage = lazy(() => import('./pages/Session'));
const TwinPage = lazy(() => import('./pages/Twin'));
const CoachPage = lazy(() => import('./pages/Coach'));
const GoalsPage = lazy(() => import('./pages/Goals'));
const CollabPage = lazy(() => import('./pages/Collab'));
const MethodsPage = lazy(() => import('./pages/Methods'));
const PrivacyPage = lazy(() => import('./pages/Privacy'));
const LabPage = lazy(() => import('./pages/Lab'));

const DAY = 86_400_000;

/** Remount the session page whenever the activity or its parameters change (e.g. baseline "Next"). */
function SessionRoute() {
  const location = useLocation();
  return <SessionPage key={location.pathname + location.search} />;
}

function useAppearance() {
  const { theme, textScale, reducedMotion } = useStore((s) => s.settings);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === 'system') localStorage.removeItem('cognitwin-theme');
      else localStorage.setItem('cognitwin-theme', theme);
    } catch {
      /* storage unavailable: theme still applies for this visit */
    }
    root.style.setProperty('--text-scale', String(textScale));
    root.dataset.reducedMotion = String(reducedMotion);
  }, [theme, textScale, reducedMotion]);
}

function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-ink-2" role="status">
      Loading…
    </div>
  );
}

export default function App() {
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.onboarded);
  const location = useLocation();
  useAppearance();

  // Retention policy runs at most once a day, on start.
  useEffect(() => {
    if (!hydrated) return;
    const s = useStore.getState();
    if (Date.now() - s.lastPurgeAt > DAY) s.purgeExpired();
    s.ensureTodayPlan();
  }, [hydrated]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (!hydrated) return <Loading />;

  const open = ['/welcome', '/methods', '/privacy', '/lab'];
  if (!onboarded && !open.includes(location.pathname)) return <Navigate to="/welcome" replace />;

  if (location.pathname === '/welcome') {
    return (
      <Suspense fallback={<Loading />}>
        <WelcomePage />
      </Suspense>
    );
  }

  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/assess" element={<AssessPage />} />
          <Route path="/train" element={<TrainPage />} />
          <Route path="/session/:taskId" element={<SessionRoute />} />
          <Route path="/twin" element={<TwinPage />} />
          <Route path="/coach" element={<CoachPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/collab" element={<CollabPage />} />
          <Route path="/methods" element={<MethodsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/lab" element={<LabPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
