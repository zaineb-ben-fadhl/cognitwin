import { describe, expect, it } from 'vitest';
import { DIMENSIONS, createRng } from '../index';
import { attentionTask, ATTENTION_SET_SIZES } from '../tasks/attention';
import { memoryTask, MEMORY_SPANS } from '../tasks/memory';
import { speedTask } from '../tasks/speed';
import { inhibitionTask } from '../tasks/inhibition';
import { flexibilityTask, switchAnswer, type SwitchStim } from '../tasks/flexibility';
import { reasoningTask, sameCell, REASONING_LEVEL_RULES } from '../tasks/reasoning';

const seeds = Array.from({ length: 25 }, (_, i) => i + 1);
const levels = Array.from({ length: 10 }, (_, i) => i + 1);

describe('every task', () => {
  it('has a sane spec and monotonic difficulty description', () => {
    for (const d of DIMENSIONS) {
      const t = d.task;
      expect(t.levels).toBe(10);
      expect(t.assessment.minTrials).toBeLessThanOrEqual(t.assessment.maxTrials);
      for (const l of levels) {
        expect(t.deadlineMs(l)).toBeGreaterThan(300);
        expect(t.levelDescription(l).length).toBeGreaterThan(3);
      }
    }
  });
});

describe('Target Hunt (attention)', () => {
  it('has exactly one item matching the target on both features', () => {
    for (const seed of seeds)
      for (const l of levels) {
        const s = attentionTask.generate(l, createRng(seed * 100 + l), 0);
        expect(s.items).toHaveLength(ATTENTION_SET_SIZES[l - 1]);
        const matches = s.items.filter((it) => it.shape === s.target.shape && it.tone === s.target.tone);
        expect(matches).toHaveLength(1);
        expect(s.items[s.targetIndex]).toBe(matches[0]);
        const cells = new Set(s.items.map((it) => `${it.col},${it.row}`));
        expect(cells.size).toBe(s.items.length);
      }
  });
});

describe('Sequence Recall (memory)', () => {
  it('generates unique in-board cells with the level span', () => {
    for (const seed of seeds)
      for (const l of levels) {
        const s = memoryTask.generate(l, createRng(seed + l * 7), 0);
        expect(s.sequence).toHaveLength(MEMORY_SPANS[l - 1]);
        expect(new Set(s.sequence).size).toBe(s.sequence.length);
        expect(Math.max(...s.sequence)).toBeLessThan(s.gridSize * s.gridSize);
      }
  });
});

describe('Symbol Sprint (speed)', () => {
  it('"same" pairs are identical and "different" pairs differ', () => {
    for (const seed of seeds)
      for (const l of levels) {
        const s = speedTask.generate(l, createRng(seed * 3 + l), 0);
        expect(s.left).toHaveLength(s.right.length);
        const identical = s.left.every((g, i) => g === s.right[i]);
        expect(identical).toBe(s.same);
      }
  });
});

describe('Arrow Focus (inhibition)', () => {
  it('conditions are consistent with arrows and no-go only appears from level 4', () => {
    for (const seed of seeds)
      for (const l of levels) {
        const s = inhibitionTask.generate(l, createRng(seed * 5 + l), 0);
        if (s.condition === 'congruent') expect(s.flank).toBe(s.center);
        if (s.condition === 'incongruent') expect(s.flank).not.toBe(s.center);
        if (s.condition === 'neutral') expect(s.flank).toBe('none');
        if (s.condition === 'nogo') {
          expect(s.center).toBe('stop');
          expect(l).toBeGreaterThanOrEqual(4);
        }
      }
  });
});

describe('Rule Switch (flexibility)', () => {
  it('marks switches correctly and congruent stimuli map to the same key under both rules', () => {
    for (const seed of seeds) {
      const rng = createRng(seed);
      let prev: SwitchStim | undefined;
      for (let i = 0; i < 40; i++) {
        const s = flexibilityTask.generate(6, rng, i, prev);
        if (prev) expect(s.isSwitch).toBe(s.rule !== prev.rule);
        const byShape = switchAnswer({ ...s, rule: 'shape' });
        const byTone = switchAnswer({ ...s, rule: 'tone' });
        expect(byShape === byTone).toBe(s.congruent);
        prev = s;
      }
    }
  });
});

describe('Pattern Logic (reasoning)', () => {
  it('the answer is the hidden cell, appears exactly once, and distractors are distinct', () => {
    for (const seed of seeds)
      for (const l of levels) {
        const s = reasoningTask.generate(l, createRng(seed * 11 + l), 0);
        expect(sameCell(s.options[s.answerIndex], s.cells[8])).toBe(true);
        expect(s.options.filter((o) => sameCell(o, s.cells[8]))).toHaveLength(1);
        for (let i = 0; i < s.options.length; i++)
          for (let j = i + 1; j < s.options.length; j++) expect(sameCell(s.options[i], s.options[j])).toBe(false);
        const varying = Object.values(s.rules).filter((r) => r !== 'constant').length;
        expect(varying).toBe(REASONING_LEVEL_RULES[l - 1].length);
      }
  });

  it('row rules are visible: every row follows the same pattern', () => {
    const s = reasoningTask.generate(1, createRng(5), 0);
    const attr = (Object.keys(s.rules) as Array<keyof typeof s.rules>).find((k) => s.rules[k] === 'row')!;
    for (let c = 0; c < 3; c++) {
      expect(s.cells[c][attr]).toEqual(s.cells[3 + c][attr]);
      expect(s.cells[c][attr]).toEqual(s.cells[6 + c][attr]);
    }
  });
});
