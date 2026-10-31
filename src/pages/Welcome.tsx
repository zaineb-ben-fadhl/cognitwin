import { ArrowRight, Brain, ChevronDown, LineChart, MessagesSquare, Sparkles, Target } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calibration } from '@/components/Calibration';
import { Button, Card, Segmented, Toggle } from '@/components/ui';
import { useStore } from '@/store';
import { AI_CONSENT_TEXT, VOICE_OUTPUT_TEXT } from '@/lib/privacyCopy';

const PILLARS = [
  { icon: Target, title: 'Assess', text: 'Six short, adaptive activities — attention, memory, speed, inhibition, flexibility, reasoning.' },
  { icon: LineChart, title: 'Understand', text: 'A percentage profile that always shows how sure it is, kept as a living Brain Twin.' },
  { icon: MessagesSquare, title: 'Coach', text: 'Personal feedback that shows its evidence — tap “Why?” on anything it says.' },
  { icon: Sparkles, title: 'Improve', text: 'Exercises that adapt every trial and a plan that evolves with you.' },
];

const RETENTION = [
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
  { value: 0, label: 'Until I delete' },
];

export default function WelcomePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [stored, setStored] = useState(false);
  const [age, setAge] = useState(false);
  const [details, setDetails] = useState(false);
  const [nickname, setNickname] = useState('');
  const consent = useStore((s) => s.consent);
  const settings = useStore((s) => s.settings);
  const setConsent = useStore((s) => s.setConsent);
  const updateSettings = useStore((s) => s.updateSettings);
  const setCalibration = useStore((s) => s.setCalibration);
  const completeOnboarding = useStore((s) => s.completeOnboarding);
  const logEvent = useStore((s) => s.logEvent);
  const loadDemo = useStore((s) => s.loadDemo);

  const finish = (target: 'baseline' | 'demo' | 'home') => {
    completeOnboarding(nickname);
    if (target === 'demo') {
      loadDemo();
      navigate('/');
    } else if (target === 'baseline') navigate('/assess?baseline=1');
    else navigate('/');
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-sm text-ink-2">
        <Brain size={18} className="text-brand" /> CogniTwin · step {step + 1} of 4
      </div>

      {step === 0 && (
        <div className="animate-fade-in">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Train your mind with a twin that learns with you.</h1>
          <p className="mt-3 max-w-2xl text-[15px] text-ink-2">
            CogniTwin builds a living model of how you perform on six thinking skills, coaches you with explanations you can check, and adapts every exercise to keep you in
            the zone where practice pays off.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {PILLARS.map((p) => (
              <Card key={p.title} className="p-4">
                <div className="flex items-center gap-2 font-semibold">
                  <p.icon size={17} className="text-brand" /> {p.title}
                </div>
                <p className="mt-1 text-[13.5px] text-ink-2">{p.text}</p>
              </Card>
            ))}
          </div>
          <div className="mt-5 rounded-2xl border border-line bg-card-2/60 p-4 text-[13.5px] text-ink-2">
            <strong className="text-ink">What CogniTwin is not.</strong> It is a non-clinical training companion. Scores describe performance on these exercises, relative to
            the exercises — not health, not intelligence, not a comparison with other people. It is not a substitute for professional advice.
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="primary" size="lg" onClick={() => setStep(1)}>
              Get started <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="animate-fade-in space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Your data, your choices</h1>
          <p className="text-[14px] text-ink-2">Exercise history stays on this device. Optional AI and voice features may send the information described below to their providers. Each option starts off and can be changed later.</p>
          <Card>
            <label className="flex cursor-pointer items-start gap-3 py-1">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--brand)]" checked={stored} onChange={(e) => setStored(e.target.checked)} />
              <span>
                <span className="text-sm font-medium">Store my exercise results on this device (required)</span>
                <span className="block text-[13px] text-ink-2">Responses, timings and your profile are kept in this browser’s storage. No account, no cloud copy.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 py-1">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--brand)]" checked={age} onChange={(e) => setAge(e.target.checked)} />
              <span>
                <span className="text-sm font-medium">I am 16 or older, or a parent/guardian agrees to my use (required)</span>
              </span>
            </label>
            <div className="mt-2 border-t border-line pt-2">
              <Toggle
                checked={consent.llm}
                onChange={(v) => setConsent({ llm: v })}
                label="AI narrative coach (optional)"
                description={AI_CONSENT_TEXT}
              />
              <Toggle checked={consent.voiceOut} onChange={(v) => setConsent({ voiceOut: v })} label="Voice coaching (optional)" description={VOICE_OUTPUT_TEXT} />
              <Toggle
                checked={consent.voiceIn}
                onChange={(v) => setConsent({ voiceIn: v })}
                label="Talk to the coach (optional)"
                description="Uses your browser’s speech recognition; some browsers process audio on their vendor’s servers. Nothing is recorded by CogniTwin."
              />
              <Toggle
                checked={consent.camera}
                onChange={(v) => setConsent({ camera: v })}
                label="Camera cues (optional, biometric)"
                description="On-device only: four coarse averages (brow tension, eye closure, looking away, smile). No images stored or sent. Cues only adjust the coach’s tone and can never decide anything on their own."
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <div>
                <div className="text-sm font-medium">Keep raw responses for</div>
                <div className="text-[12.5px] text-ink-2">Older raw data is deleted automatically; summary history stays until you delete it.</div>
              </div>
              <Segmented
                ariaLabel="Retention period"
                value={settings.retentionDays ?? 0}
                onChange={(v) => updateSettings({ retentionDays: v === 0 ? null : v })}
                options={RETENTION}
              />
            </div>
            <div className="mt-3 border-t border-line pt-3">
              <label className="text-sm font-medium" htmlFor="nick">
                What should the coach call you? <span className="font-normal text-ink-2">(optional, stays on device)</span>
              </label>
              <input
                id="nick"
                value={nickname}
                maxLength={40}
                onChange={(e) => setNickname(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm outline-none focus:border-brand"
                placeholder="A first name or nickname"
              />
            </div>
          </Card>
          <button
            type="button"
            className="flex items-center gap-1 text-[13px] font-medium text-brand"
            onClick={() => {
              if (!details) logEvent('consent_informed');
              setDetails((d) => !d);
            }}
            aria-expanded={details}
          >
            Full details: what is stored, for how long, and how to delete it <ChevronDown size={14} className={details ? 'rotate-180' : ''} />
          </button>
          {details && (
            <Card className="animate-fade-in space-y-2 text-[13px] text-ink-2">
              <p>
                <strong className="text-ink">Purpose.</strong> Non-clinical cognitive training and self-reflection. Data is not sold or used for eligibility decisions. Optional provider processing is described above.
              </p>
              <p>
                <strong className="text-ink">What is stored (on this device).</strong> Your exercise trials (correctness, response times, difficulty), session summaries, your Brain Twin
                snapshots, goals, plans, coach conversations and interaction events used for the AI Collaboration Score.
              </p>
              <p>
                <strong className="text-ink">Biometric features.</strong> Camera and microphone are off by default. Camera frames are processed in memory and discarded; only four
                averages per session are kept. A non-biometric mode (the default) offers every feature.
              </p>
              <p>
                <strong className="text-ink">Retention & deletion.</strong> Raw responses older than your chosen period are deleted automatically. You can export everything as a
                file, delete single sessions, categories, or everything at once from “Privacy & settings”.
              </p>
              <p>
                <strong className="text-ink">Legal basis.</strong> Your consent, which you can withdraw at any time. Designed with the EU GDPR and Tunisian Organic Law
                2004-63 on personal data protection in mind.
              </p>
            </Card>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button variant="primary" disabled={!stored || !age} onClick={() => setStep(2)}>
              Continue <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="animate-fade-in space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">A 20-second fairness check</h1>
          <p className="mx-auto max-w-lg text-[14px] text-ink-2">
            Tap as soon as the circle turns green. This measures your device and hand speed — not your thinking — so that response windows are fair whether you use a phone,
            a trackpad or a mouse. It is never shown as a score.
          </p>
          <Card className="py-8">
            <Calibration
              onDone={(c) => {
                setCalibration(c);
                window.setTimeout(() => setStep(3), 600);
              }}
              onSkip={() => {
                setCalibration({ srtMs: 360, factor: 1.2, input: 'mouse', at: Date.now() });
                setStep(3);
              }}
            />
          </Card>
        </div>
      )}

      {step === 3 && (
        <div className="animate-fade-in space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">How would you like to begin?</h1>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="flex flex-col">
              <div className="font-semibold">Baseline check-in</div>
              <p className="mt-1 flex-1 text-[13px] text-ink-2">Six short adaptive activities (~12 min). Builds the first version of your Brain Twin.</p>
              <Button variant="primary" className="mt-4" onClick={() => finish('baseline')}>
                Start baseline
              </Button>
            </Card>
            <Card className="flex flex-col">
              <div className="font-semibold">Explore a demo twin</div>
              <p className="mt-1 flex-1 text-[13px] text-ink-2">Six weeks of simulated history, so you can see every chart right away. Clear it with one click.</p>
              <Button className="mt-4" onClick={() => finish('demo')}>
                Load demo data
              </Button>
            </Card>
            <Card className="flex flex-col">
              <div className="font-semibold">Look around first</div>
              <p className="mt-1 flex-1 text-[13px] text-ink-2">Go to the dashboard and start whenever you like.</p>
              <Button variant="ghost" className="mt-4" onClick={() => finish('home')}>
                Go to dashboard
              </Button>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
