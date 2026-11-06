// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';
import { useStore } from '@/store';
import { DIMENSIONS } from '@/engine';

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 360, top: 0, left: 0, right: 640, bottom: 360, x: 0, y: 0, toJSON() {} });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ llm: false, model: null }))));
});
beforeEach(async () => {
  await useStore.persist.rehydrate();
  useStore.getState().clearData('all');
  useStore.getState().loadDemo();
  useStore.setState({ hydrated: true });
});
afterEach(cleanup);
const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('application routes with synthetic history', () => {
  it.each([
    ['/', 'Today'], ['/assess', 'Check-ins'], ['/train', 'Train'], ['/twin', 'Brain Twin'],
    ['/coach', 'Coach'], ['/goals', 'Goals & learning path'], ['/collab', 'AI Collaboration Score'],
    ['/methods', 'Methods & transparency'], ['/privacy', 'Privacy & settings'], ['/lab', 'Robustness lab'],
    ...DIMENSIONS.map((d) => [`/session/${d.task.id}?mode=training`, d.task.name]),
  ])('%s renders its working page', async (path, title) => {
    open(path);
    // Lazy page imports can exceed the DOM library's default 1 s on a busy machine.
    expect(await screen.findByRole('heading', { level: 1, name: title }, { timeout: 5000 })).toBeTruthy();
    if (path === '/coach') {
      fireEvent.change(screen.getByRole('textbox', { name: 'Message to the coach' }), { target: { value: 'How is my memory?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }));
      await act(async () => { await Promise.resolve(); });
      expect(useStore.getState().chat).toHaveLength(0);
    }
  });

  it('pushback in the coach disputes the session, widens its uncertainty and rewards the user', async () => {
    useStore.getState().loadScenario('pushback');
    const before = useStore.getState();
    const acsEvents = before.events.length;
    open('/coach');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message to the coach' }, { timeout: 5000 }), { target: { value: 'I disagree, my score dropped because I was distracted by noise around me.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => { await Promise.resolve(); });
    const after = useStore.getState();
    const disputed = after.sessions.find((x) => x.dispute);
    expect(disputed?.dimension).toBe('memory');
    expect(after.events.length).toBeGreaterThan(acsEvents);
    expect(after.events.some((e) => e.type === 'pushback')).toBe(true);
    const reply = after.chat.at(-1)!;
    expect(reply.intent).toBe('pushback');
    expect(reply.text).toMatch(/Collaboration Score went from/);
    expect(await screen.findByText(/marked your Sequence Recall/)).toBeTruthy();
  });

  it('answers the "why this exercise" audit from the Brain Twin data', async () => {
    open('/coach?ask=' + encodeURIComponent('Why did you assign me this specific exercise today?'));
    const box = (await screen.findByRole('textbox', { name: 'Message to the coach' }, { timeout: 5000 })) as HTMLTextAreaElement;
    expect(box.value).toMatch(/Why did you assign me/);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/I assigned/, undefined, { timeout: 5000 })).toBeTruthy();
    expect(useStore.getState().chat.at(-1)?.intent).toBe('why_plan');
  });

  it('blocks invalid goal dates, saves a valid goal and archives it', async () => {
    useStore.setState({ goals: [] });
    open('/goals');
    fireEvent.click(await screen.findByRole('button', { name: 'New goal' }));
    const date = screen.getByLabelText('By');
    fireEvent.change(date, { target: { value: '' } });
    expect((screen.getByRole('button', { name: 'Save goal' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(date, { target: { value: '2099-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
    expect(useStore.getState().goals).toHaveLength(0);
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    fireEvent.change(date, { target: { value: nextMonth } });
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
    expect(useStore.getState().goals).toHaveLength(1);
    expect(Number.isFinite(useStore.getState().goals[0].deadline)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Archive goal' }));
    expect(useStore.getState().goals[0].archived).toBe(true);
  });

  it('requires a separate confirmation before replacing an existing history', async () => {
    open('/privacy');
    const sessions = useStore.getState().sessions;
    fireEvent.click(await screen.findByRole('button', { name: 'Load demo twin' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(useStore.getState().sessions).toBe(sessions);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useStore.getState().sessions).toBe(sessions);
  });
});
