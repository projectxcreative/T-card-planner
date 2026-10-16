import { addDays, addMonths, startOfMonth, todayKey } from '../dates';
import type { LaneId, ViewMode } from '../types';
import { createStore } from './createStore';

export interface UIState {
  view: ViewMode;
  focus: string;
  openCardId: string | null;
  openProjectId: string | null;
  openClientId: string | null;
  clientFilter: string[];
  searchQuery: string;
  showSettings: boolean;
  activeDragId: string | null;
}

export interface UIActions {
  setView: (view: ViewMode) => void;
  setFocus: (focus: string) => void;
  shiftFocus: (steps: number) => void;
  resetFocusToToday: () => void;
  setOpenCardId: (id: string | null) => void;
  setOpenProjectId: (id: string | null) => void;
  setOpenClientId: (id: string | null) => void;
  setClientFilter: (filter: string[] | ((prev: string[]) => string[])) => void;
  setSearchQuery: (query: string) => void;
  setShowSettings: (show: boolean) => void;
  setActiveDragId: (id: string | null) => void;
  openDay: (day: LaneId) => void;
  openProjectFrom: (projectId: string) => void;
}

const initialUIState: UIState = {
  view: 'week',
  focus: todayKey(),
  openCardId: null,
  openProjectId: null,
  openClientId: null,
  clientFilter: [],
  searchQuery: '',
  showSettings: false,
  activeDragId: null,
};

export const uiStore = createStore<UIState & UIActions>({
  ...initialUIState,

  setView: (view: ViewMode) => uiStore.setState({ view }),
  setFocus: (focus: string) => uiStore.setState({ focus }),

  shiftFocus: (steps: number) => {
    const { view, focus } = uiStore.getState();
    let nextFocus = focus;
    if (view === 'day') nextFocus = addDays(focus, steps);
    else if (view === 'month') nextFocus = startOfMonth(addMonths(startOfMonth(focus), steps));
    else nextFocus = addDays(focus, steps * 7);
    uiStore.setState({ focus: nextFocus });
  },

  resetFocusToToday: () => uiStore.setState({ focus: todayKey() }),

  setOpenCardId: (openCardId: string | null) => uiStore.setState({ openCardId }),
  setOpenProjectId: (openProjectId: string | null) => uiStore.setState({ openProjectId }),
  setOpenClientId: (openClientId: string | null) => uiStore.setState({ openClientId }),

  setClientFilter: (filter: string[] | ((prev: string[]) => string[])) => {
    const next = typeof filter === 'function' ? filter(uiStore.getState().clientFilter) : filter;
    uiStore.setState({ clientFilter: next });
  },

  setSearchQuery: (searchQuery: string) => uiStore.setState({ searchQuery }),
  setShowSettings: (showSettings: boolean) => uiStore.setState({ showSettings }),
  setActiveDragId: (activeDragId: string | null) => uiStore.setState({ activeDragId }),

  openDay: (day: LaneId) => {
    uiStore.setState({ focus: day, view: 'day' });
  },

  openProjectFrom: (projectId: string) => {
    uiStore.setState({ openProjectId: projectId, view: 'projects' });
  },
});

export function useUIStore<T>(selector: (state: UIState & UIActions) => T): T {
  return uiStore.useStore(selector);
}

export function useUIActions(): UIActions {
  const state = uiStore.getState();
  return {
    setView: state.setView,
    setFocus: state.setFocus,
    shiftFocus: state.shiftFocus,
    resetFocusToToday: state.resetFocusToToday,
    setOpenCardId: state.setOpenCardId,
    setOpenProjectId: state.setOpenProjectId,
    setOpenClientId: state.setOpenClientId,
    setClientFilter: state.setClientFilter,
    setSearchQuery: state.setSearchQuery,
    setShowSettings: state.setShowSettings,
    setActiveDragId: state.setActiveDragId,
    openDay: state.openDay,
    openProjectFrom: state.openProjectFrom,
  };
}
