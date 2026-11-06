import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_ACS_WEIGHTS,
  DEFAULT_PREFS,
  DIMENSION_IDS,
  buildDemoHistory,
  createTwin,
  currentProfile,
  createPlanItem,
  getDimension,
  ensureDimensions,
  generateDailyPlan,
  isMashedSession,
  localDate,
  replaySessions,
  applySession,
  applyDispute,
  buildScenario,
  makeDispute,
  removeDispute,
  uid,
  type AIEvent,
  type AIEventType,
  type ChallengePreference,
  type CoachMessage,
  type CollabDimension,
  type DailyPlan,
  type DimensionId,
  type DisputeOutcome,
  type DisputeReason,
  type ScenarioId,
  type SessionContext,
  type Goal,
  type SessionRecord,
  type TwinState,
  type VerifyChallenge,
} from '@/engine';
import { resilientStorage } from './storage';
import { exportSchema, goalSchema, type ExportFile } from './schema';
import { withoutCamera, withoutCameraMessages } from '@/engine/privacy';

export const SCHEMA_VERSION = 1;
export const CONSENT_VERSION = '2026-10';
const DAY = 86_400_000;

export interface ConsentState {
  version: string;
  acceptedAt: number | null;
  /** Optional processing, each off by default. */
  llm: boolean;
  voiceOut: boolean;
  voiceIn: boolean;
  camera: boolean;
  log: Array<{ at: number; change: string }>;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  colourIndependent: boolean;
  reducedMotion: boolean;
  textScale: number;
  challenge: ChallengePreference;
  dailyMinutes: number;
  focus: DimensionId[];
  /** null = keep until deleted. */
  retentionDays: number | null;
  speakCoach: boolean;
  askSelfPrediction: boolean;
  askCheckIn: boolean;
}

export interface Calibration {
  srtMs: number;
  factor: number;
  input: 'mouse' | 'touch' | 'keyboard';
  at: number;
}

export interface MissionLog {
  id: string;
  dimension: DimensionId;
  text: string;
  doneAt: number;
  reflection?: string;
}

export interface PersistedState {
  schemaVersion: number;
  onboarded: boolean;
  profile: { nickname: string; createdAt: number };
  consent: ConsentState;
  settings: Settings;
  calibration: Calibration | null;
  twin: TwinState;
  sessions: SessionRecord[];
  goals: Goal[];
  plans: DailyPlan[];
  events: AIEvent[];
  chat: CoachMessage[];
  missions: MissionLog[];
  acsWeights: Record<CollabDimension, number>;
  verify: { current: VerifyChallenge | null; history: Array<{ id: string; found: boolean; at: number }> };
  demo: boolean;
  /** Robustness scenario currently loaded (synthetic data), if any. */
  scenario?: ScenarioId | null;
  lastPurgeAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  colourIndependent: false,
  reducedMotion: false,
  textScale: 1,
  challenge: DEFAULT_PREFS.challenge,
  dailyMinutes: DEFAULT_PREFS.dailyMinutes,
  focus: [],
  retentionDays: 365,
  speakCoach: false,
  askSelfPrediction: true,
  askCheckIn: true,
};

function freshState(now = Date.now()): PersistedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    onboarded: false,
    profile: { nickname: '', createdAt: now },
    consent: { version: CONSENT_VERSION, acceptedAt: null, llm: false, voiceOut: false, voiceIn: false, camera: false, log: [] },
    settings: { ...DEFAULT_SETTINGS },
    calibration: null,
    twin: createTwin(now),
    sessions: [],
    goals: [],
    plans: [],
    events: [],
    chat: [],
    missions: [],
    acsWeights: { ...DEFAULT_ACS_WEIGHTS },
    verify: { current: null, history: [] },
    demo: false,
    scenario: null,
    lastPurgeAt: now,
  };
}

interface Actions {
  completeOnboarding(nickname: string): void;
  setConsent(patch: Partial<Omit<ConsentState, 'log' | 'version'>>): void;
  updateSettings(patch: Partial<Settings>): void;
  setCalibration(c: Calibration): void;
  recordSession(s: SessionRecord): void;
  deleteSession(id: string): void;
  logEvent(type: AIEventType, data?: AIEvent['data']): void;
  addChat(...messages: CoachMessage[]): void;
  clearChat(): void;
  ensureTodayPlan(force?: boolean): DailyPlan | null;
  editPlanItem(itemId: string, dimension: DimensionId | null, reason?: string): void;
  addGoal(goal: Omit<Goal, 'id' | 'createdAt'>): void;
  archiveGoal(id: string): void;
  logMission(m: Omit<MissionLog, 'id' | 'doneAt'>): void;
  setAcsWeights(w: Record<CollabDimension, number>): void;
  setVerify(current: VerifyChallenge | null, result?: { found: boolean }): void;
  loadDemo(): void;
  /** Replace the history with a synthetic robustness scenario (real engine, simulated learner). */
  loadScenario(id: ScenarioId): void;
  /** The user contests a session: it counts less and becomes more uncertain. Returns the before/after numbers. */
  disputeSession(id: string, reason: DisputeReason, opts?: { note?: string; source?: 'chat' | 'button' }): DisputeOutcome | null;
  undisputeSession(id: string): void;
  /** The user's explanation of a flagged (rushed) session. */
  setSessionContext(id: string, context: SessionContext): void;
  clearData(scope: 'all' | 'history' | 'chat' | 'camera' | 'demo'): void;
  purgeExpired(now?: number): number;
  exportData(): ExportFile;
  importData(json: unknown): { ok: true; sessions: number } | { ok: false; error: string };
}

export type AppState = PersistedState & Actions & { hydrated: boolean };

const minutesToday = (sessions: SessionRecord[], now: number) =>
  sessions.filter((s) => localDate(s.endedAt) === localDate(now)).reduce((m, s) => m + (s.endedAt - s.startedAt) / 60000, 0);

export const useStore = create<AppState>()(
  persist(
    (setState, getState) => ({
      ...freshState(),
      hydrated: false,

      completeOnboarding(nickname) {
        const now = Date.now();
        setState((s) => ({
          onboarded: true,
          profile: { ...s.profile, nickname: nickname.trim().slice(0, 40) },
          consent: { ...s.consent, acceptedAt: now, log: [...s.consent.log, { at: now, change: `Accepted local storage (consent ${CONSENT_VERSION})` }] },
        }));
      },

      setConsent(patch) {
        const now = Date.now();
        setState((s) => {
          const changes = Object.entries(patch)
            .filter(([k, v]) => (s.consent as unknown as Record<string, unknown>)[k] !== v)
            .map(([k, v]) => `${k} ${v ? 'enabled' : 'disabled'}`);
          return { consent: { ...s.consent, ...patch, log: [...s.consent.log, ...changes.map((change) => ({ at: now, change }))] } };
        });
      },

      updateSettings(patch) {
        setState((s) => ({ settings: { ...s.settings, ...patch } }));
      },

      setCalibration(c) {
        setState({ calibration: c });
      },

      recordSession(session) {
        setState((s) => {
          const twin = applySession(ensureDimensions(s.twin, [session.dimension]), session);
          const events: AIEvent[] = [
            ...s.events,
            { id: uid('ev_'), type: 'session_completed', at: session.endedAt, data: { hints: session.behaviour.hintsUsed, hintsAvailable: session.taskId === 'pattern-logic', reliability: session.quality.reliability } },
          ];
          if (session.selfPrediction !== undefined)
            events.push({ id: uid('ev_'), type: 'self_prediction', at: session.endedAt, data: { predicted: session.selfPrediction, actual: Math.round(session.scoreAfter.score) } });
          if (isMashedSession(session.quality)) events.push({ id: uid('ev_'), type: 'random_responding', at: session.endedAt });

          // Goals reached?
          const profile = currentProfile(twin, session.endedAt);
          const goals = s.goals.map((g) => {
            if (g.achievedAt || g.archived || g.kind !== 'score' || g.dimension !== session.dimension) return g;
            const p = profile.find((x) => x.id === g.dimension);
            return p && p.summary.score >= g.target ? { ...g, achievedAt: session.endedAt } : g;
          });
          const plans = s.plans.map((p) =>
            p.items.some((i) => i.id === session.planItemId)
              ? { ...p, items: p.items.map((i) => (i.id === session.planItemId ? { ...i, done: true, sessionId: session.id } : i)) }
              : p,
          );
          return { twin, sessions: [...s.sessions, session], events, goals, plans };
        });
        getState().ensureTodayPlan(true);
      },

      deleteSession(id) {
        setState((s) => {
          const remaining = s.sessions.filter((x) => x.id !== id);
          const { twin, sessions } = replaySessions(remaining, s.twin.createdAt);
          const goals = s.goals.map((g) => {
            if (g.kind !== 'score' || !g.dimension) return g;
            const reached = twin.snapshots.find((p) => p.at >= g.createdAt && p.changed === g.dimension && p.dims[g.dimension!]?.score >= g.target);
            return { ...g, achievedAt: reached?.at };
          });
          return { twin, sessions, goals, plans: s.plans.map((p) => ({ ...p, items: p.items.map((i) => i.sessionId === id ? { ...i, done: false, sessionId: undefined } : i) })) };
        });
        getState().ensureTodayPlan(true);
      },

      logEvent(type, data) {
        setState((s) => ({ events: [...s.events, { id: uid('ev_'), type, at: Date.now(), data }] }));
      },

      addChat(...messages) {
        setState((s) => ({ chat: [...s.chat, ...messages].slice(-300) }));
      },

      clearChat() {
        setState({ chat: [] });
      },

      ensureTodayPlan(force = false) {
        const s = getState();
        if (!s.onboarded) return null;
        const now = Date.now();
        const latest = s.plans.at(-1);
        if (!force && latest && latest.date === localDate(now)) return latest;
        const prefs = { dailyMinutes: s.settings.dailyMinutes, challenge: s.settings.challenge, focus: s.settings.focus };
        const done = minutesToday(s.sessions, now);
        const remaining = Math.max(3, prefs.dailyMinutes - done);
        const plan = generateDailyPlan(s.twin, s.sessions, s.goals, { ...prefs, dailyMinutes: remaining }, now, latest && latest.date === localDate(now) ? latest : undefined);
        if (done >= prefs.dailyMinutes) plan.rationale = `Today's ${prefs.dailyMinutes}-minute goal is reached — anything below is an optional bonus. ${plan.rationale}`;
        setState({ plans: [...s.plans, plan].slice(-60) });
        return plan;
      },

      editPlanItem(itemId, dimension, reason) {
        const now = Date.now();
        setState((s) => {
          const plans = s.plans.slice();
          const plan = plans.at(-1);
          if (!plan) return {};
          const original = plan.items.find((i) => i.id === itemId);
          if (!original || (dimension && !DIMENSION_IDS.includes(dimension))) return {};
          const items = dimension
            ? plan.items.map((i) => {
                if (i.id !== itemId && i.dimension === dimension) return { ...original, id: i.id, userEdited: true };
                if (i.id !== itemId) return i;
                const p = currentProfile(s.twin, now).find((x) => x.id === dimension)!;
                const fresh = createPlanItem(p, { now, twin: s.twin, sessions: s.sessions, goals: s.goals, prefs: s.settings });
                return { ...fresh, id: i.id, userEdited: true };
              })
            : plan.items.filter((i) => i.id !== itemId);
          const rationale = items.length ? `Your edited plan: ${items.map((i) => getDimension(i.dimension).short).join(', ')}. About ${Math.round(items.reduce((sum, i) => sum + i.minutes, 0))} minutes.` : 'You removed all activities. Choose any exercise below or generate a new plan.';
          plans[plans.length - 1] = { ...plan, items, rationale, changes: [...plan.changes, dimension ? 'You swapped an activity.' : 'You removed an activity.'] };
          const events: AIEvent[] = [...s.events, { id: uid('ev_'), type: 'plan_edited', at: now }];
          if (reason) events.push({ id: uid('ev_'), type: 'override_with_reason', at: now, data: { reason: reason.slice(0, 200) } });
          return { plans, events };
        });
      },

      addGoal(goal) {
        const now = Date.now();
        const parsed = goalSchema.safeParse({ ...goal, id: uid('g_'), createdAt: now });
        if (!parsed.success) return;
        setState((s) => ({
          goals: [...s.goals, parsed.data],
          events: [...s.events, { id: uid('ev_'), type: goal.selfSet ? 'goal_self_set' : 'goal_from_ai', at: now }],
        }));
        getState().ensureTodayPlan(true);
      },

      archiveGoal(id) {
        setState((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, archived: true } : g)) }));
      },

      logMission(m) {
        setState((s) => ({ missions: [...s.missions, { ...m, id: uid('m_'), doneAt: Date.now() }] }));
      },

      setAcsWeights(w) {
        setState({ acsWeights: w });
      },

      setVerify(current, result) {
        setState((s) => ({
          verify: {
            current,
            history: result && s.verify.current ? [...s.verify.history, { id: s.verify.current.id, found: result.found, at: Date.now() }] : s.verify.history,
          },
          events: result ? [...s.events, { id: uid('ev_'), type: 'verify_challenge', at: Date.now(), data: { found: result.found } }] : s.events,
        }));
      },

      loadDemo() {
        const now = Date.now();
        const demo = buildDemoHistory(now);
        setState((s) => ({
          twin: demo.twin,
          sessions: demo.sessions,
          goals: demo.goals,
          plans: demo.plans,
          events: demo.events,
          chat: [],
          missions: [],
          verify: { current: null, history: [] },
          demo: true,
          scenario: null,
          onboarded: true,
          calibration: s.calibration ?? { srtMs: 320, factor: 1.08, input: 'mouse', at: now },
          profile: { ...s.profile, nickname: s.profile.nickname || 'Demo' },
          consent: s.consent.acceptedAt ? s.consent : { ...s.consent, acceptedAt: now, log: [...s.consent.log, { at: now, change: 'Demo data loaded (synthetic persona)' }] },
        }));
        getState().ensureTodayPlan(true);
      },

      loadScenario(id) {
        const now = Date.now();
        const data = buildScenario(id, now);
        setState((s) => ({
          twin: data.twin,
          sessions: data.sessions,
          goals: data.goals,
          plans: data.plans,
          events: data.events,
          chat: [],
          missions: [],
          verify: { current: null, history: [] },
          demo: true,
          scenario: id,
          onboarded: true,
          calibration: s.calibration ?? { srtMs: 320, factor: 1.08, input: 'mouse', at: now },
          profile: { ...s.profile, nickname: s.profile.nickname || 'Demo' },
          consent: s.consent.acceptedAt ? s.consent : { ...s.consent, acceptedAt: now, log: [...s.consent.log, { at: now, change: `Robustness scenario loaded (${id}, synthetic data)` }] },
        }));
        getState().ensureTodayPlan(true);
      },

      disputeSession(id, reason, opts = {}) {
        const s = getState();
        const now = Date.now();
        const res = applyDispute({ twin: s.twin, sessions: s.sessions, events: s.events, weights: s.acsWeights }, id, makeDispute(reason, now, opts.source ?? 'button', opts.note), uid('ev_'));
        if (!res) return null;
        setState({ twin: ensureDimensions(res.twin, DIMENSION_IDS), sessions: res.sessions, events: [...s.events, res.event] });
        getState().ensureTodayPlan(true);
        return res.outcome;
      },

      undisputeSession(id) {
        setState((s) => {
          const { twin, sessions } = removeDispute(s, id);
          return { twin: ensureDimensions(twin, DIMENSION_IDS), sessions };
        });
        getState().ensureTodayPlan(true);
      },

      setSessionContext(id, context) {
        setState((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, context } : x)),
          events: [...s.events, { id: uid('ev_'), type: 'rush_check_answered', at: Date.now(), data: { answer: context, sessionId: id } }],
        }));
      },

      clearData(scope) {
        const now = Date.now();
        if (scope === 'all') {
          setState({ ...freshState(now) });
          void resilientStorage.removeItem(STORAGE_KEY);
          try {
            localStorage.removeItem('cognitwin-theme');
          } catch {
            /* ignore */
          }
          return;
        }
        setState((s) => {
          if (scope === 'chat') return { chat: [] };
          if (scope === 'camera') return { sessions: s.sessions.map(withoutCamera), chat: withoutCameraMessages(s.chat, s.sessions) };
          // history / demo: wipe training data, keep consent, settings and calibration
          return {
            twin: createTwin(now),
            sessions: [],
            goals: [],
            plans: [],
            events: s.events.filter((e) => e.type === 'consent_informed' || e.type === 'privacy_reviewed'),
            chat: [],
            missions: [],
            verify: { current: null, history: [] },
            demo: false,
            scenario: null,
          };
        });
      },

      purgeExpired(now = Date.now()) {
        const days = getState().settings.retentionDays;
        if (!days) {
          setState({ lastPurgeAt: now });
          return 0;
        }
        const cutoff = now - days * DAY;
        let purged = 0;
        setState((s) => {
          const sessions = s.sessions.map((x) => {
            if (x.endedAt >= cutoff || (!x.trials.length && !x.camera && !x.affect.sources.includes('camera'))) return x;
            purged++;
            // Raw responses and camera cues are deleted; the aggregated estimate is kept for history.
            return { ...withoutCamera(x), trials: [], metrics: x.metrics.filter((m) => m.key === 'accuracy' || m.key === 'medianRt') };
          });
          return {
            sessions,
            chat: withoutCameraMessages(s.chat.filter((c) => c.at >= cutoff), s.sessions.filter((x) => x.endedAt < cutoff)),
            events: s.events.filter((e) => e.at >= cutoff),
            lastPurgeAt: now,
          };
        });
        return purged;
      },

      exportData() {
        const s = getState();
        return {
          app: 'cognitwin' as const,
          schemaVersion: SCHEMA_VERSION,
          exportedAt: Date.now(),
          data: {
            sessions: s.sessions,
            goals: s.goals,
            events: s.events,
            chat: s.chat,
            settings: s.settings as unknown as Record<string, unknown>,
            profile: s.profile,
            calibration: s.calibration,
            missions: s.missions,
            acsWeights: s.acsWeights,
            demo: s.demo,
            consent: s.consent,
            plans: s.plans,
            verify: s.verify,
          },
        } as unknown as ExportFile;
      },

      importData(json) {
        const parsed = exportSchema.safeParse(json);
        if (!parsed.success) return { ok: false, error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
        const d = parsed.data.data;
        const sessions = d.sessions as unknown as SessionRecord[];
        const createdAt = Math.min(Date.now(), ...sessions.map((x) => x.startedAt));
        let rebuilt: ReturnType<typeof replaySessions>;
        try { rebuilt = replaySessions(sessions, createdAt); }
        catch { return { ok: false, error: 'The sessions could not be replayed. No data was changed.' }; }
        const { twin, sessions: replayed } = rebuilt;
        setState((s) => ({
          twin: ensureDimensions(twin, DIMENSION_IDS),
          sessions: replayed,
          goals: d.goals as unknown as Goal[],
          events: d.events as unknown as AIEvent[],
          chat: (d.chat ?? []) as unknown as CoachMessage[],
          settings: { ...s.settings, ...((d.settings ?? {}) as Partial<Settings>) },
          calibration: (d.calibration as Calibration | null | undefined) ?? s.calibration,
          profile: { ...s.profile, nickname: d.profile?.nickname ?? s.profile.nickname },
          plans: [],
          demo: d.demo ?? false,
          onboarded: true,
          missions: d.missions ?? [],
          acsWeights: d.acsWeights ?? { ...DEFAULT_ACS_WEIGHTS },
          verify: { current: null, history: [] },
        }));
        getState().ensureTodayPlan(true);
        getState().purgeExpired();
        return { ok: true, sessions: replayed.length };
      },
    }),
    {
      name: 'cognitwin-state',
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => resilientStorage),
      partialize: (s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { hydrated, ...rest } = s;
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function')) as unknown as PersistedState;
      },
      migrate: (persisted) => {
        // Future schema changes are handled here; v1 is the first public schema.
        return persisted as PersistedState;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedState>;
        const merged = { ...current, ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } } as AppState;
        // Forward compatibility: dimensions added after the data was created.
        merged.twin = ensureDimensions(merged.twin ?? createTwin(Date.now()), DIMENSION_IDS);
        return merged;
      },
      onRehydrateStorage: () => () => {
        useStore.setState({ hydrated: true });
      },
    },
  ),
);

const STORAGE_KEY = 'cognitwin-state';

export function newEventId() {
  return uid('ev_');
}
