import { useEffect, useState } from 'react';
import { todayKey } from '../dates';
import { newCardUpdate } from '../store';
import { dispatchBoardAction, getBoardState } from './boardStore';
import { createStore } from './createStore';

const TIMER_STORAGE_KEY = 'tcard-planner.timer.v1';

export interface TimerState {
  cardId: string | null;
  categoryId: string;
  note: string;
  running: boolean;
  startedAt: number | null;
  accumulatedMs: number;
}

const emptyTimerState = (): TimerState => ({
  cardId: null,
  categoryId: '',
  note: '',
  running: false,
  startedAt: null,
  accumulatedMs: 0,
});

function loadTimerState(): TimerState {
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_KEY);
    if (!raw) return emptyTimerState();
    const parsed = JSON.parse(raw) as Partial<TimerState>;
    if (!parsed || typeof parsed.cardId !== 'string' || !parsed.cardId) return emptyTimerState();
    const running = parsed.running === true;
    const startedAt = running && Number.isFinite(parsed.startedAt) ? Number(parsed.startedAt) : null;
    const accumulatedMs = Number.isFinite(parsed.accumulatedMs) ? Math.max(0, Number(parsed.accumulatedMs)) : 0;
    return {
      cardId: parsed.cardId,
      categoryId: typeof parsed.categoryId === 'string' ? parsed.categoryId : '',
      note: typeof parsed.note === 'string' ? parsed.note : '',
      running: running && startedAt !== null,
      startedAt,
      accumulatedMs,
    };
  } catch {
    return emptyTimerState();
  }
}

function saveTimerState(state: TimerState): void {
  try {
    if (!state.cardId) {
      localStorage.removeItem(TIMER_STORAGE_KEY);
    } else {
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore storage errors.
  }
}

export const timerStore = createStore<TimerState>(loadTimerState());

function setAndPersist(next: TimerState): void {
  saveTimerState(next);
  timerStore.setState(next);
}

export function elapsedMsOf(state: TimerState, now = Date.now()): number {
  if (!state.cardId) return 0;
  const live = state.running && state.startedAt ? Math.max(0, now - state.startedAt) : 0;
  return state.accumulatedMs + live;
}

export function formatTimerClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

/** Starts a timer for `cardId`. If another card already has a timer running or
 *  paused with >30 seconds on it, logs that work first so switching tasks never
 *  quietly loses time. */
export function startTimer(cardId: string, categoryId?: string): void {
  const current = timerStore.getState();
  if (current.cardId === cardId) {
    if (!current.running) resumeTimer();
    return;
  }
  if (current.cardId && elapsedMsOf(current) >= 30_000) {
    stopAndLogTimer();
  }
  const board = getBoardState();
  const defaultCat = categoryId || board.updateCategoryOrder[0] || 'build';
  setAndPersist({
    cardId,
    categoryId: defaultCat,
    note: '',
    running: true,
    startedAt: Date.now(),
    accumulatedMs: 0,
  });
}

export function pauseTimer(): void {
  const current = timerStore.getState();
  if (!current.cardId || !current.running) return;
  const total = elapsedMsOf(current);
  setAndPersist({
    ...current,
    running: false,
    startedAt: null,
    accumulatedMs: total,
  });
}

export function resumeTimer(): void {
  const current = timerStore.getState();
  if (!current.cardId || current.running) return;
  setAndPersist({
    ...current,
    running: true,
    startedAt: Date.now(),
  });
}

export function updateTimerDraft(patch: Partial<Pick<TimerState, 'categoryId' | 'note'>>): void {
  const current = timerStore.getState();
  if (!current.cardId) return;
  setAndPersist({
    ...current,
    ...patch,
  });
}

export function discardTimer(): void {
  setAndPersist(emptyTimerState());
}

/** Stops the active timer and appends a `CardUpdate` entry to the card.
 *  Minimum logged unit is 1 minute so a quick timed check-in still registers. */
export function stopAndLogTimer(): { cardId: string; minutes: number } | null {
  const current = timerStore.getState();
  if (!current.cardId) return null;
  const ms = elapsedMsOf(current);
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const board = getBoardState();
  const card = board.cards[current.cardId];
  const categoryId =
    current.categoryId && board.updateCategories[current.categoryId]
      ? current.categoryId
      : board.updateCategoryOrder[0] || 'build';

  if (card && categoryId) {
    const update = newCardUpdate(
      categoryId,
      minutes,
      current.note.trim() || 'Timed session',
      todayKey(),
    );
    dispatchBoardAction({
      type: 'addUpdate',
      cardId: current.cardId,
      update,
    });
  }

  const result = { cardId: current.cardId, minutes };
  setAndPersist(emptyTimerState());
  return result;
}

export function useActiveTimer() {
  const state = timerStore.useStore((s) => s);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!state.cardId || !state.running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.cardId, state.running, state.startedAt]);

  const elapsedSeconds = state.cardId ? Math.floor(elapsedMsOf(state, now) / 1000) : 0;

  return {
    ...state,
    elapsedSeconds,
    formatted: formatTimerClock(elapsedSeconds),
  };
}
