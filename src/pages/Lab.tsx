import { CheckCircle2, FlaskConical, Play, RotateCcw, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardHeader, Modal, PageHeader } from '@/components/ui';
import { SCENARIOS, runScenarioChecks, type ScenarioCheck, type ScenarioDef, type ScenarioId } from '@/engine';
import { useStore } from '@/store';

/**
 * Robustness lab — the six Phase-2 surprise scenarios, reproducible in one click. Each one loads
 * a synthetic learner played through the real engine (clearly labelled demo data), then sends
 * you to the screen where the behaviour shows. The self-check runs the same assertions as the
 * regression tests, live in the browser.
 */
export default function LabPage() {
  const navigate = useNavigate();
  const sessions = useStore((s) => s.sessions);
  const demo = useStore((s) => s.demo);
  const current = useStore((s) => s.scenario ?? null);
  const loadScenario = useStore((s) => s.loadScenario);
  const [confirm, setConfirm] = useState<ScenarioDef | null>(null);
  const [checks, setChecks] = useState<ScenarioCheck[] | null>(null);
  const [running, setRunning] = useState(false);

  const go = (sc: ScenarioDef) => {
    loadScenario(sc.id);
    const st = useStore.getState();
    if (sc.id === 'masher') {
      const last = st.sessions.at(-1);
      navigate(last ? `/session/${last.taskId}?review=${last.id}` : sc.route);
      return;
    }
    navigate(sc.prompt ? `/coach?ask=${encodeURIComponent(sc.prompt)}` : sc.route);
  };
  const start = (sc: ScenarioDef) => {
    // Loading replaces the history: ask first when it holds the user's own (non-demo) sessions.
    if (sessions.length && !demo) setConfirm(sc);
    else go(sc);
  };
  const runChecks = () => {
    setRunning(true);
    // Let the button repaint before the (synchronous) simulations run.
    window.setTimeout(() => {
      setChecks(runScenarioChecks(Date.now()));
      setRunning(false);
    }, 30);
  };
  const result = (id: ScenarioId) => checks?.find((c) => c.id === id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Robustness lab"
        subtitle="The six surprise scenarios, reproducible in one click. Each loads a synthetic learner played through the real engine and planner (demo data, clearly labelled), then opens the screen where the behaviour shows."
        right={
          <Button variant="primary" onClick={runChecks} disabled={running}>
            <FlaskConical size={15} /> {running ? 'Running…' : checks ? 'Run self-check again' : 'Run self-check'}
          </Button>
        }
      />
      {checks && (
        <Card>
          <CardHeader
            title={`Self-check: ${checks.filter((c) => c.ok).length} of ${checks.length} scenarios pass`}
            subtitle="Same assertions as src/engine/__tests__/jury-scenarios.test.ts (33 tests in CI), run live on fresh simulations."
          />
          <ul className="space-y-1.5 text-[13px]">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                {c.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good-text" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-serious" />}
                <span>
                  <span className="font-medium">{SCENARIOS.find((s) => s.id === c.id)!.title}</span> <span className="text-ink-2">— {c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {SCENARIOS.map((sc, i) => {
          const r = result(sc.id);
          return (
            <Card key={sc.id} className={current === sc.id ? 'border-brand' : ''}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-ink-2">{i + 1}</span>
                <h2 className="text-[15px] font-semibold">{sc.title}</h2>
                <Badge>{sc.tests}</Badge>
                {current === sc.id && <Badge tone="brand">loaded</Badge>}
                {r && <Badge tone={r.ok ? 'good' : 'critical'}>{r.ok ? 'self-check ✓' : 'self-check ✗'}</Badge>}
              </div>
              <p className="text-[13px] italic text-ink-2">{sc.challenge}</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px]">
                {sc.response.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {sc.prompt && (
                <p className="mt-2 rounded-xl bg-card-2/60 px-3 py-2 text-[12.5px]">
                  Ask the coach: <span className="font-medium">“{sc.prompt}”</span>
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => start(sc)}>
                  <Play size={13} /> {sc.id === 'masher' ? 'Load & review a flagged check-in' : `Load & ${sc.routeLabel.charAt(0).toLowerCase()}${sc.routeLabel.slice(1)}`}
                </Button>
                {sc.id === 'masher' && (
                  <Button size="sm" onClick={() => navigate('/session/target-hunt?mode=assessment')}>
                    Try it live: mash a Target Hunt check-in
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader title="How to reset" icon={<RotateCcw size={16} />} />
        <p className="text-[13px] text-ink-2">
          Scenarios replace the current history with synthetic data. Go to Privacy &amp; settings to load the standard demo twin, import your own export, or delete everything.
        </p>
      </Card>

      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title="Replace your history?">
          <p className="text-sm text-ink-2">
            Loading “{confirm.title}” replaces your {sessions.length} sessions with synthetic scenario data. Export your data first (Privacy &amp; settings) if you want to keep it.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const sc = confirm;
                setConfirm(null);
                go(sc);
              }}
            >
              Replace and load
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
