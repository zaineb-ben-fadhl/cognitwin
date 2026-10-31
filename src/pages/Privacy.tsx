import { Database, Download, Shield, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calibration } from '@/components/Calibration';
import { Button, Card, CardHeader, Modal, PageHeader, Segmented, Toggle } from '@/components/ui';
import { DIMENSIONS } from '@/engine';
import { downloadJson, fmtDateTime } from '@/lib/format';
import { canListen, canSpeak, speak } from '@/lib/voice';
import { useStore } from '@/store';
import { storageMode } from '@/store/storage';
import { MAX_IMPORT_BYTES } from '@/store/schema';
import { AI_CONSENT_TEXT, VOICE_OUTPUT_TEXT } from '@/lib/privacyCopy';

const DAY = 86_400_000;

export default function PrivacyPage() {
  const navigate = useNavigate();
  const s = useStore();
  const [confirm, setConfirm] = useState<null | 'all' | 'history' | 'chat' | 'camera'>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const last = [...s.events].reverse().find((e) => e.type === 'privacy_reviewed');
    if (s.onboarded && (!last || Date.now() - last.at > 7 * DAY)) s.logEvent('privacy_reviewed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trials = s.sessions.reduce((n, x) => n + x.trials.length, 0);
  const withCamera = s.sessions.filter((x) => x.camera || x.affect.sources.includes('camera')).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Privacy & settings" subtitle="You own your data. It lives on this device; you decide what is optional, how long raw data is kept, and you can take it with you or erase it." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Consent" icon={<Shield size={16} />} subtitle="Optional features are off by default; every change is logged below." />
          <Toggle checked={s.consent.llm} onChange={(v) => s.setConsent({ llm: v })} label="AI narrative coach" description={AI_CONSENT_TEXT} />
          <Toggle checked={s.consent.voiceOut} onChange={(v) => s.setConsent({ voiceOut: v })} label="Voice coaching (speech output)" description={canSpeak() ? VOICE_OUTPUT_TEXT : 'Not supported by this browser.'} disabled={!canSpeak()} />
          <Toggle
            checked={s.consent.voiceIn}
            onChange={(v) => s.setConsent({ voiceIn: v })}
            label="Voice input"
            description={canListen() ? 'Browser speech recognition — may be processed by the browser vendor. Not recorded by CogniTwin.' : 'Not supported by this browser.'}
            disabled={!canListen()}
          />
          <Toggle checked={s.consent.camera} onChange={(v) => s.setConsent({ camera: v })} label="Camera cues (biometric)" description="On-device; four averages per session; never decides alone. Off = non-biometric mode (full functionality)." />
          <details className="mt-2 text-[12.5px] text-ink-2">
            <summary className="cursor-pointer font-medium text-ink">Consent log ({s.consent.log.length})</summary>
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
              {[...s.consent.log].reverse().map((l, i) => (
                <li key={i}>
                  {fmtDateTime(l.at)} — {l.change}
                </li>
              ))}
            </ul>
          </details>
        </Card>

        <Card>
          <CardHeader title="Your data" icon={<Database size={16} />} subtitle={`Stored in ${storageMode() === 'idb' ? 'IndexedDB' : storageMode() === 'local' ? 'localStorage' : 'memory only (this browser blocks storage)'} on this device.`} />
          <dl className="grid grid-cols-3 gap-3 text-[13px]">
            <div>
              <dt className="text-ink-2">Sessions</dt>
              <dd className="text-lg font-semibold">{s.sessions.length}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Raw trials</dt>
              <dd className="text-lg font-semibold">{trials}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Interactions</dt>
              <dd className="text-lg font-semibold">{s.events.length}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <div className="text-[13px]">
              <div className="font-medium">Keep raw responses for</div>
              <div className="text-ink-2">Summaries stay until you delete them.</div>
            </div>
            <Segmented
              ariaLabel="Retention"
              value={s.settings.retentionDays ?? 0}
              onChange={(v) => {
                s.updateSettings({ retentionDays: v === 0 ? null : v });
                const n = useStore.getState().purgeExpired();
                setMessage(n ? `Retention applied: raw data of ${n} older session${n > 1 ? 's' : ''} deleted.` : 'Retention updated.');
              }}
              options={[
                { value: 30, label: '30 d' },
                { value: 90, label: '90 d' },
                { value: 365, label: '1 yr' },
                { value: 0, label: 'Until deleted' },
              ]}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
            <Button size="sm" onClick={() => downloadJson(`cognitwin-export-${new Date().toISOString().slice(0, 10)}.json`, s.exportData())}>
              <Download size={14} /> Export all (JSON)
            </Button>
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Import
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  if (f.size > MAX_IMPORT_BYTES) throw new Error('File exceeds the 25 MB limit.');
                  const res = s.importData(JSON.parse(await f.text()));
                  setMessage(res.ok ? `Imported ${res.sessions} sessions; the Brain Twin was rebuilt from them.` : `Import rejected: ${res.error}`);
                } catch (error) {
                  setMessage(f.size > MAX_IMPORT_BYTES ? 'Import rejected: file exceeds the 25 MB limit.' : 'Import rejected: the file is not valid JSON.');
                }
                e.target.value = '';
              }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={() => setConfirm('chat')}>
              Delete conversations
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirm('camera')} disabled={!withCamera}>
              Delete camera cues ({withCamera})
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirm('history')}>
              Delete training history
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirm('all')}>
              <Trash2 size={14} /> Delete everything
            </Button>
          </div>
          {message && <p className="mt-3 rounded-xl bg-card-2 px-3 py-2 text-[12.5px]">{message}</p>}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Accessibility & display" />
          <div className="flex flex-wrap items-center justify-between gap-3 py-2">
            <span className="text-sm font-medium">Theme</span>
            <Segmented
              ariaLabel="Theme"
              value={s.settings.theme}
              onChange={(v) => s.updateSettings({ theme: v })}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 py-2">
            <span className="text-sm font-medium">Text size</span>
            <Segmented
              ariaLabel="Text size"
              value={s.settings.textScale}
              onChange={(v) => s.updateSettings({ textScale: v })}
              options={[
                { value: 1, label: 'A' },
                { value: 1.15, label: 'A+' },
                { value: 1.3, label: 'A++' },
              ]}
            />
          </div>
          <Toggle
            checked={s.settings.colourIndependent}
            onChange={(v) => s.updateSettings({ colourIndependent: v })}
            label="Colour-independent exercises"
            description="Replaces colours in exercises with fill patterns (solid / outline / striped)."
          />
          <Toggle checked={s.settings.reducedMotion} onChange={(v) => s.updateSettings({ reducedMotion: v })} label="Reduce motion" />
          <div className="mt-2 border-t border-line pt-3 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Response-window calibration</div>
                <div className="text-ink-2">
                  {s.calibration ? `Factor ×${s.calibration.factor} (reaction ${s.calibration.srtMs} ms, ${s.calibration.input})` : 'Not calibrated — using a generous default.'}
                </div>
              </div>
              <Button size="sm" onClick={() => setCalibrating(true)}>
                Recalibrate
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Training & coaching" />
          <Toggle checked={s.settings.speakCoach} onChange={(v) => s.updateSettings({ speakCoach: v })} label="Read coach messages aloud automatically" description="Requires voice coaching consent." disabled={!s.consent.voiceOut} />
          {s.consent.voiceOut && canSpeak() && (
            <Button size="sm" variant="ghost" onClick={() => speak('Hello! I am your CogniTwin coach. Small, regular sessions are what move the needle.')}>
              Test voice
            </Button>
          )}
          <Toggle checked={s.settings.askSelfPrediction} onChange={(v) => s.updateSettings({ askSelfPrediction: v })} label="Ask me to predict my result" description="Builds self-awareness; feeds the autonomy component of the collaboration score." />
          <Toggle checked={s.settings.askCheckIn} onChange={(v) => s.updateSettings({ askCheckIn: v })} label="Mood & energy check-in" description="Self-report helps the coach separate state from skill." />
          <div className="border-t border-line pt-3">
            <div className="mb-2 text-sm font-medium">Areas I want to focus on</div>
            <div className="flex flex-wrap gap-1.5">
              {DIMENSIONS.map((d) => {
                const on = s.settings.focus.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      s.updateSettings({ focus: on ? s.settings.focus.filter((f) => f !== d.id) : [...s.settings.focus, d.id] });
                      s.ensureTodayPlan(true);
                    }}
                    className={`rounded-full border px-3 py-1 text-[12.5px] ${on ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink-2'}`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            <Button size="sm" onClick={() => {
              if (s.sessions.length || s.goals.length || s.chat.length || s.missions.length) setConfirmDemo(true);
              else { s.loadDemo(); navigate('/'); }
            }}>
              Load demo twin
            </Button>
            {s.demo && (
              <Button size="sm" variant="ghost" onClick={() => s.clearData('demo')}>
                Clear demo data
              </Button>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="How your data is handled" />
        <div className="grid gap-4 text-[13px] text-ink-2 md:grid-cols-3">
          <p>
            <strong className="text-ink">Local-first.</strong> No account or server database. If you enable the AI coach, the server forwards aggregates and filtered conversation text to Anthropic. It does not persist request bodies.
          </p>
          <p>
            <strong className="text-ink">No sensitive decisions on face or voice.</strong> Camera cues can only soften the coach’s tone or suggest a break, and only when behaviour or
            your own check-in agrees. Scores never use them.
          </p>
          <p>
            <strong className="text-ink">Your rights.</strong> Access and portability (export), rectification (delete sessions), erasure (delete everything), withdrawal of consent
            (toggles above). These controls support data protection; they do not certify legal compliance of a deployment.
          </p>
        </div>
      </Card>

      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title="Please confirm">
          <p className="text-sm text-ink-2">
            {confirm === 'all'
              ? 'This permanently erases everything CogniTwin stored on this device — sessions, twin, goals, conversations, settings and consent. You will start again from the welcome screen.'
              : confirm === 'history'
                ? 'This erases all sessions, the Brain Twin history, goals, plans, missions and conversations. Consent and settings are kept.'
                : confirm === 'chat'
                  ? 'This erases all coach conversations.'
                  : 'This erases camera measurements and derived camera evidence, removes related coach messages, and recomputes session states without camera input.'}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                s.clearData(confirm);
                setConfirm(null);
                setMessage('Deleted.');
                if (confirm === 'all') navigate('/welcome');
              }}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}
      {calibrating && (
        <Modal open onClose={() => setCalibrating(false)} title="Recalibrate response windows">
          <p className="mb-4 text-[13px] text-ink-2">Tap as soon as the circle turns green — 10 taps. This only scales time windows; it is never a score.</p>
          <Calibration
            onDone={(c) => {
              s.setCalibration(c);
              setCalibrating(false);
              setMessage(`Calibrated: factor ×${c.factor}.`);
            }}
          />
        </Modal>
      )}
      {confirmDemo && (
        <Modal open onClose={() => setConfirmDemo(false)} title="Replace history with demo data?">
          <p className="text-sm text-ink-2">The demo replaces your sessions, goals and conversations with a synthetic history. Export your current data first if you want to keep it.</p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button onClick={() => downloadJson(`cognitwin-backup-${new Date().toISOString().slice(0, 10)}.json`, s.exportData())}>Export current data</Button>
            <Button variant="ghost" onClick={() => setConfirmDemo(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { s.loadDemo(); setConfirmDemo(false); navigate('/'); }}>Replace with demo</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
