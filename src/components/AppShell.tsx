import { clsx } from 'clsx';
import { BookOpen, Brain, Dumbbell, Flag, FlaskConical, Handshake, House, Menu, MessagesSquare, Moon, Shield, Sun, SunMoon, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useStore } from '@/store';
import { Button } from './ui';

const NAV = [
  { to: '/', label: 'Today', icon: House, main: true },
  { to: '/train', label: 'Train', icon: Dumbbell, main: true },
  { to: '/twin', label: 'Brain Twin', icon: Brain, main: true },
  { to: '/coach', label: 'Coach', icon: MessagesSquare, main: true },
  { to: '/goals', label: 'Goals', icon: Flag },
  { to: '/collab', label: 'AI Collaboration', icon: Handshake },
  { to: '/methods', label: 'Methods', icon: BookOpen },
  { to: '/lab', label: 'Robustness lab', icon: FlaskConical },
  { to: '/privacy', label: 'Privacy & settings', icon: Shield },
];

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg width={28} height={28} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="14" fill="var(--brand)" />
        <circle cx="24" cy="32" r="13" fill="none" stroke="var(--brand-ink)" strokeWidth="4" />
        <circle cx="40" cy="32" r="13" fill="none" stroke="var(--brand-ink)" strokeWidth="4" opacity="0.7" />
        <circle cx="32" cy="32" r="3.5" fill="var(--brand-ink)" />
      </svg>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">CogniTwin</div>
        <div className="text-[10.5px] text-ink-2">Cognitive growth agent</div>
      </div>
    </div>
  );
}

function ThemeButton() {
  const theme = useStore((s) => s.settings.theme);
  const update = useStore((s) => s.updateSettings);
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : SunMoon;
  return (
    <Button size="sm" variant="ghost" aria-label={`Theme: ${theme}. Switch to ${next}`} title={`Theme: ${theme}`} onClick={() => update({ theme: next })}>
      <Icon size={16} />
    </Button>
  );
}

function NavItem({ to, label, icon: Icon, onClick }: { to: string; label: string; icon: typeof House; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        clsx('flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors', isActive ? 'bg-brand-soft font-medium text-brand' : 'text-ink-2 hover:bg-card-2 hover:text-ink')
      }
    >
      <Icon size={17} />
      {label}
    </NavLink>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const demo = useStore((s) => s.demo);
  const clearData = useStore((s) => s.clearData);
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const inSession = location.pathname.startsWith('/session');

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-card px-3 py-4 lg:flex">
        <div className="mb-6 px-2">
          <Logo />
        </div>
        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
          {NAV.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
        </nav>
        <div className="flex items-center justify-between px-2 pt-3 text-[11px] text-muted">
          <span>Non-clinical · local-first</span>
          <ThemeButton />
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-card/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <Logo />
        <div className="flex items-center gap-1">
          <ThemeButton />
          <Button size="sm" variant="ghost" aria-label="Open menu" onClick={() => setMenu(true)}>
            <Menu size={18} />
          </Button>
        </div>
      </header>
      {menu && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMenu(false)}>
          <nav className="absolute right-0 top-0 h-full w-72 bg-card p-4" onClick={(e) => e.stopPropagation()} aria-label="Main">
            <div className="mb-4 flex justify-end">
              <Button size="sm" variant="ghost" aria-label="Close menu" onClick={() => setMenu(false)}>
                <X size={18} />
              </Button>
            </div>
            {NAV.map((n) => (
              <NavItem key={n.to} {...n} onClick={() => setMenu(false)} />
            ))}
          </nav>
        </div>
      )}

      <div className="lg:pl-60">
        {demo && (
          <div className="flex flex-wrap items-center justify-center gap-2 border-b border-line bg-brand-soft px-4 py-2 text-center text-[12.5px] text-ink">
            <span>
              <strong>Demo data:</strong> a simulated 6-week learner generated by the real engine. Nothing here is a real person.
            </span>
            <button type="button" className="font-medium text-brand underline-offset-2 hover:underline" onClick={() => clearData('demo')}>
              Clear demo &amp; start fresh
            </button>
          </div>
        )}
        <main id="main" className={clsx('mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12', inSession && 'max-w-3xl')}>
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      {!inSession && (
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Quick">
          {NAV.filter((n) => n.main).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-brand' : 'text-ink-2')}>
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
