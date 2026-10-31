import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './index';
import { DIMENSION_IDS, buildDemoHistory, computeCollabScore, estimateAffect } from '@/engine';
import type { SessionRecord } from '@/engine';

const now = Date.now();
const demo = buildDemoHistory(now);
beforeEach(async () => {
  await useStore.persist.rehydrate();
  useStore.getState().clearData('all');
});

function cameraSession(): SessionRecord {
  const session = { ...demo.sessions[0], selfReportAfter: { energy: 1 }, camera: { samples: 60, browTension: .8, eyeClosure: .5, gazeAway: .6, smile: 0 } };
  return { ...session, affect: estimateAffect(session.trials, session.behaviour, session.selfReportAfter, session.camera) };
}

describe('privacy and persistence integration', () => {
  it('removes camera measurements and all derived camera evidence', () => {
    const session = cameraSession();
    expect(session.affect.sources).toContain('camera');
    useStore.setState({ sessions: [session] });
    useStore.getState().clearData('camera');
    const result = useStore.getState().sessions[0];
    expect(result.camera).toBeUndefined();
    expect(result.affect.sources).not.toContain('camera');
    expect(result.affect.evidence.some((e) => e.source === 'camera')).toBe(false);
    expect(result.after).toEqual(session.after);
    expect(result.trials).toEqual(session.trials);
  });
  it('purges expired raw trials, camera evidence, chat and events while retaining the twin', () => {
    const old = { ...cameraSession(), endedAt: now - 100 * 86400000 };
    useStore.setState({ sessions: [old], twin: demo.twin, settings: { ...useStore.getState().settings, retentionDays: 30 }, events: [{ id: 'old', type: 'why_opened', at: old.endedAt }] });
    expect(useStore.getState().purgeExpired(now)).toBe(1);
    expect(useStore.getState().sessions[0].trials).toEqual([]);
    expect(useStore.getState().sessions[0].affect.sources).not.toContain('camera');
    expect(useStore.getState().events).toEqual([]);
    expect(useStore.getState().twin).toEqual(demo.twin);
  });
  it('also removes legacy camera evidence when the original camera field is gone', () => {
    const old = { ...cameraSession(), camera: undefined, trials: [], endedAt: now - 100 * 86400000 };
    useStore.setState({ sessions: [old], settings: { ...useStore.getState().settings, retentionDays: 30 } });
    useStore.getState().purgeExpired(now);
    expect(useStore.getState().sessions[0].affect.sources).not.toContain('camera');
  });
  it('round-trips demo sessions, missions and custom collaboration weights without enabling permissions', () => {
    const s = useStore.getState();
    s.loadDemo();
    s.logMission({ dimension: 'memory', text: 'Practised a shopping list', reflection: 'Useful' });
    s.setAcsWeights({ clarification: .1, verification: .4, iteration: .2, autonomy: .2, responsible: .1 });
    s.setConsent({ camera: true, llm: true });
    const exported = useStore.getState().exportData();
    const previous = useStore.getState().twin;
    s.clearData('all');
    const result = useStore.getState().importData(exported);
    expect(result).toMatchObject({ ok: true, sessions: demo.sessions.length });
    expect(useStore.getState().twin.dims).toEqual(previous.dims);
    expect(useStore.getState().missions).toHaveLength(1);
    expect(useStore.getState().acsWeights.verification).toBe(.4);
    expect(useStore.getState().demo).toBe(true);
    expect(useStore.getState().consent.camera).toBe(false);
    expect(useStore.getState().consent.llm).toBe(false);
    expect(Number.isFinite(computeCollabScore(useStore.getState().events).total)).toBe(true);
  });
  it.each(['version', 'unknown task', 'dimension mismatch', 'invalid settings', 'duplicate session', 'unknown event', 'bad event number', 'invalid goal'])('rejects %s atomically', (kind) => {
    useStore.getState().loadDemo();
    const input = JSON.parse(JSON.stringify(useStore.getState().exportData()));
    if (kind === 'version') input.schemaVersion = 99;
    if (kind === 'unknown task') input.data.sessions[0].taskId = 'unknown';
    if (kind === 'dimension mismatch') input.data.sessions[0].dimension = 'unknown';
    if (kind === 'invalid settings') input.data.settings.focus = 'memory';
    if (kind === 'duplicate session') input.data.sessions.push(input.data.sessions[0]);
    if (kind === 'unknown event') input.data.events.push({ id:'bad',at:now,type:'unknown' });
    if (kind === 'bad event number') input.data.events.push({ id:'bad',at:now,type:'self_prediction',data:{ predicted:'oops',actual:50 } });
    if (kind === 'invalid goal') input.data.goals.push({ id:'bad', kind:'score', target:50, deadline:now+10000,createdAt:now,selfSet:true,dimension:'unknown' });
    const previous = useStore.getState().sessions;
    expect(useStore.getState().importData(input).ok).toBe(false);
    expect(useStore.getState().sessions).toBe(previous);
  });
  it('replays history after deleting a session and revokes goals achieved only by it', () => {
    const session = demo.sessions[0];
    useStore.getState().completeOnboarding('Test');
    useStore.getState().addGoal({ kind:'score',dimension:session.dimension,target:1,deadline:now+86400000,selfSet:true });
    useStore.setState({ goals: useStore.getState().goals.map((g) => ({ ...g, createdAt: session.startedAt - 1 })) });
    useStore.getState().recordSession(session);
    expect(useStore.getState().goals[0].achievedAt).toBeDefined();
    useStore.getState().deleteSession(session.id);
    expect(useStore.getState().twin.snapshots).toHaveLength(0);
    expect(useStore.getState().goals[0].achievedAt).toBeUndefined();
  });
  it('can swap to every dimension, including those outside the selected daily plan', () => {
    useStore.getState().loadDemo();
    for (const dimension of DIMENSION_IDS) {
      const plan = useStore.getState().plans.at(-1)!;
      const item = plan.items[0];
      useStore.getState().editPlanItem(item.id, dimension, 'I want to practise this skill.');
      const next = useStore.getState().plans.at(-1)!;
      expect(next.items[0].dimension).toBe(dimension);
      expect(new Set(next.items.map((i) => i.dimension)).size).toBe(next.items.length);
    }
  });
  it('refuses non-finite or inverted goal dates at the store boundary', () => {
    for (const deadline of [NaN, Infinity, now - 1]) {
      useStore.getState().addGoal({ kind: 'score', dimension: 'memory', target: 70, deadline, selfSet: true });
    }
    expect(useStore.getState().goals).toHaveLength(0);
  });
});
