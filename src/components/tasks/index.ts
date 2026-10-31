import type { AnyTaskModule } from './types';
import { targetHuntModule } from './TargetHunt';
import { sequenceRecallModule } from './SequenceRecall';
import { symbolSprintModule } from './SymbolSprint';
import { arrowFocusModule } from './ArrowFocus';
import { ruleSwitchModule } from './RuleSwitch';
import { patternLogicModule } from './PatternLogic';

/** UI module per task id (the engine-side TaskSpec lives in src/engine/tasks). */
export const TASK_MODULES: Record<string, AnyTaskModule> = {
  'target-hunt': targetHuntModule,
  'sequence-recall': sequenceRecallModule,
  'symbol-sprint': symbolSprintModule,
  'arrow-focus': arrowFocusModule,
  'rule-switch': ruleSwitchModule,
  'pattern-logic': patternLogicModule,
};
