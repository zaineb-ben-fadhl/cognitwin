// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveSession, DIMENSION_IDS, createRng, taskForDimension } from '@/engine';
import { switchAnswer } from '@/engine/tasks/flexibility';
import { TASK_MODULES } from './index';
import { TaskRunner } from './TaskRunner';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('six exercise interfaces', () => {
  it.each(DIMENSION_IDS)('%s accepts a correct accessible response only once', (dimension) => {
    const task = taskForDimension(dimension);
    const module = TASK_MODULES[task.id];
    const stim = task.generate(3, createRng(42), 0) as any;
    const onRespond = vi.fn();
    const View = module.View;
    render(<View stim={stim} level={3} deadlineMs={30000} colourIndependent practice={false} onRespond={onRespond} />);
    if (dimension === 'attention') {
      const button = screen.getByRole('button', { name: new RegExp(`^Item ${stim.targetIndex + 1}:`) });
      fireEvent.keyDown(button, { key: 'Enter' });
      fireEvent.keyDown(button, { key: 'Enter' });
    } else if (dimension === 'memory') {
      advance(650 + stim.sequence.length * (stim.flashMs + stim.gapMs));
      fireEvent.click(screen.getByRole('button', { name: `Tile ${stim.sequence[0] + 1}` }));
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      for (const cell of stim.sequence) fireEvent.click(screen.getByRole('button', { name: `Tile ${cell + 1}` }));
      fireEvent.click(screen.getByRole('button', { name: 'Tile 1' }));
      advance(200);
      expect(onRespond.mock.calls[0][0].corrections).toBe(1);
    } else if (dimension === 'speed') {
      fireEvent.click(screen.getByRole('button', { name: stim.same ? /Same/ : /Different/ }));
      fireEvent.keyDown(window, { key: 'f' });
    } else if (dimension === 'inhibition') {
      if (stim.center === 'stop') advance(30000);
      else fireEvent.click(screen.getByRole('button', { name: stim.center === 'left' ? 'Left' : 'Right' }));
    } else if (dimension === 'flexibility') {
      fireEvent.keyDown(window, { key: 'f' });
      expect(onRespond).not.toHaveBeenCalled();
      advance(stim.cueLeadMs);
      fireEvent.click(screen.getByRole('button', { name: switchAnswer(stim) === 'left' ? /circle/ : /square/ }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: /Hint/ }));
      fireEvent.click(screen.getByRole('button', { name: `Option ${stim.answerIndex + 1}` }));
      expect(onRespond.mock.calls[0][0].hintUsed).toBe(true);
    }
    advance(60000);
    expect(onRespond).toHaveBeenCalledOnce();
    const response = onRespond.mock.calls[0][0];
    expect(module.evaluate(stim, response.response, response.rtMs).correct).toBe(true);
  });

  it.each(DIMENSION_IDS)('%s reports a timeout and cleans up on unmount', (dimension) => {
    const task = taskForDimension(dimension);
    const View = TASK_MODULES[task.id].View;
    const stim = task.generate(2, createRng(12), 0);
    const onRespond = vi.fn();
    const { unmount } = render(<View stim={stim} level={2} deadlineMs={100} colourIndependent={false} practice={false} onRespond={onRespond} />);
    advance(20000); // memory/cue preparation finishes before its response deadline starts
    advance(100);
    expect(onRespond).toHaveBeenCalledOnce();
    expect(onRespond.mock.calls[0][0]).toMatchObject({ response: null, rtMs: null });
    unmount(); advance(60000);
    expect(onRespond).toHaveBeenCalledOnce();
  });

  it('cancels delayed sequence submission when the view is removed', () => {
    const View = TASK_MODULES['sequence-recall'].View;
    const onRespond = vi.fn();
    const { unmount } = render(<View stim={{ gridSize: 3, sequence: [0, 1], flashMs: 100, gapMs: 100 }} level={1} deadlineMs={3000} colourIndependent={false} practice onRespond={onRespond} />);
    advance(1050);
    fireEvent.click(screen.getByRole('button', { name: 'Tile 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tile 2' }));
    unmount(); advance(5000);
    expect(onRespond).not.toHaveBeenCalled();
  });
});

describe('session lifecycle', () => {
  const setup = () => {
    const task = taskForDimension('speed');
    const adaptive = new AdaptiveSession(task, { mode: 'training', prior: { mean: 0, sd: 1 }, trialBudget: 2 });
    const onComplete = vi.fn(), onQuit = vi.fn();
    render(<TaskRunner task={task} adaptive={adaptive} deadlineFactor={1} colourIndependent={false} onComplete={onComplete} onQuit={onQuit} />);
    return { adaptive, onComplete, onQuit };
  };
  it('freezes fixation during pause and completes the budget once', () => {
    const { adaptive, onComplete } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    advance(60000);
    expect(adaptive.trials).toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Resume' })[0]);
    advance(450);
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.keyDown(window, { key: 'j' });
    expect(adaptive.trials).toHaveLength(1);
    expect(adaptive.trials[0].weight).toBe(.3);
    advance(2000); advance(450);
    fireEvent.keyDown(window, { key: 'f' });
    advance(2000); advance(60000);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0][0].trials).toHaveLength(2);
  });
  it('quits without late completion or additional trials', () => {
    const { adaptive, onComplete, onQuit } = setup();
    advance(450);
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop session' }));
    advance(60000);
    expect(onQuit).toHaveBeenCalledOnce();
    expect(onQuit.mock.calls[0][0].behaviour.quitEarly).toBe(true);
    expect(adaptive.trials).toHaveLength(1);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
