import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CoachAction, CoachMessage } from '@/engine';
import { useStore } from '@/store';

const DAY = 86_400_000;

/** Executes a coach-proposed action — only ever on an explicit user click. */
export function useCoachAction() {
  const navigate = useNavigate();
  const addGoal = useStore((s) => s.addGoal);
  const logEvent = useStore((s) => s.logEvent);
  const [breakMinutes, setBreakMinutes] = useState<number | null>(null);

  const run = useCallback(
    (action: CoachAction, message?: CoachMessage, evidenceViewed = false) => {
      logEvent('recommendation_response', { response: 'accepted', confidence: message?.confidence ?? 'moderate', evidenceViewed });
      switch (action.kind) {
        case 'start_session':
          navigate(`/session/${action.taskId}?mode=${action.mode}`);
          break;
        case 'open':
          navigate(action.route);
          break;
        case 'create_goal':
          addGoal({ kind: 'score', dimension: action.dimension, target: action.target, deadline: Date.now() + action.deadlineDays * DAY, selfSet: false });
          navigate('/goals');
          break;
        case 'take_break':
          logEvent('break_suggested', { taken: true });
          setBreakMinutes(action.minutes);
          break;
      }
    },
    [addGoal, logEvent, navigate],
  );

  const dismiss = useCallback(
    (message: CoachMessage, evidenceViewed: boolean, reason?: string) => {
      logEvent('recommendation_response', { response: 'rejected', confidence: message.confidence, evidenceViewed, ...(reason ? { reason } : {}) });
      if (message.action?.kind === 'take_break') logEvent('break_suggested', { taken: false });
    },
    [logEvent],
  );

  return { run, dismiss, breakMinutes, closeBreak: () => setBreakMinutes(null) };
}
