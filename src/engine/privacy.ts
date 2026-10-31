import { estimateAffect } from './affect';
import type { SessionRecord } from './types';
import type { CoachMessage } from './coach/types';

/** Erase measurements AND derived evidence; keep only non-camera state estimates. */
export function withoutCamera(session: SessionRecord): SessionRecord {
  return {
    ...session,
    camera: undefined,
    affect: estimateAffect(session.trials, session.behaviour, { ...session.selfReportBefore, ...session.selfReportAfter }),
  };
}

export function withoutCameraMessages(chat: CoachMessage[], sessions: SessionRecord[]): CoachMessage[] {
  const affected = new Set(sessions.filter((s) => s.camera || s.affect.sources.includes('camera')).map((s) => `${s.id}-affect`));
  return chat.filter((m) => !m.evidence.some((e) => /camera/i.test(e.label)) && !m.insightIds.some((id) => affected.has(id)));
}
