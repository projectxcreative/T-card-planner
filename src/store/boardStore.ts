import {
  BACKLOG,
  CATEGORY_PALETTE,
  CLIENT_PALETTE,
  type BoardState,
  type Card,
  type CardUpdate,
  type Category,
  type CategoryId,
  type Client,
  type LaneId,
  type Project,
  type UpdateCategory,
} from '../types';
import {
  attachableCards,
  billingMonths,
  byStage,
  cardsIn,
  cardsOfClient,
  cardsOfProject,
  clientTotals,
  laneOf,
  load,
  newCard,
  newCardUpdate,
  newCategory,
  newClient,
  newProject,
  newUpdateCategory,
  normalise,
  projectsOfClient,
  reducer,
  save,
  strandedEvents,
  type Action,
  type BillingMonth,
} from '../store';
import { todayKey } from '../dates';
import { createStore } from './createStore';

const HISTORY_LIMIT = 40;

interface BoardStoreState {
  board: BoardState;
  past: BoardState[];
  canUndo: boolean;
}

const initialBoard = load();

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(board: BoardState) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => save(board), 200);
}

export const boardStore = createStore<BoardStoreState>({
  board: initialBoard,
  past: [],
  canUndo: false,
});

export function getBoardState(): BoardState {
  return boardStore.getState().board;
}

export function snapshotBoard(): void {
  const { board, past } = boardStore.getState();
  boardStore.setState({
    past: [...past, board].slice(-HISTORY_LIMIT),
    canUndo: true,
  });
}

export function dispatchBoardAction(action: Action, shouldSnapshot = false): void {
  const current = boardStore.getState();
  if (shouldSnapshot) {
    snapshotBoard();
  }
  const next = reducer(current.board, action);
  if (next !== current.board) {
    scheduleSave(next);
    boardStore.setState({ board: next });
  }
}

export function undoBoardAction(): void {
  const { past } = boardStore.getState();
  const previous = past[past.length - 1];
  if (!previous) return;
  const nextPast = past.slice(0, -1);
  scheduleSave(previous);
  boardStore.setState({
    board: previous,
    past: nextPast,
    canUndo: nextPast.length > 0,
  });
}

export function swapRemoteBoard(incoming: BoardState): void {
  const current = boardStore.getState().board;
  const stranded = [...current.orphanedEvents, ...strandedEvents(current, incoming)];
  let next = incoming;
  if (stranded.length > 0) {
    next = reducer(next, { type: 'orphanEvents', ids: stranded });
  }
  scheduleSave(next);
  boardStore.setState({ board: next });
}

/* ---------- hooks for specific slices ---------- */

export function useBoard<T>(selector: (board: BoardState) => T): T {
  return boardStore.useStore((s) => selector(s.board));
}

export function useCanUndo(): boolean {
  return boardStore.useStore((s) => s.canUndo);
}

export function useCard(id: string | null): Card | null {
  return boardStore.useStore((s) => (id ? s.board.cards[id] ?? null : null));
}

export function useLaneCards(laneId: LaneId): Card[] {
  return boardStore.useStore((s) => cardsIn(s.board, laneId));
}

export function useProjectList(): Project[] {
  return boardStore.useStore((s) => Object.values(s.board.projects).sort(byStage));
}

export function useClientList(): Client[] {
  return boardStore.useStore((s) =>
    s.board.clientOrder.map((id) => s.board.clients[id]).filter(Boolean) as Client[],
  );
}

export function useProject(id: string | null): Project | null {
  return boardStore.useStore((s) => (id ? s.board.projects[id] ?? null : null));
}

export function useClient(id: string | null): Client | null {
  return boardStore.useStore((s) => (id ? s.board.clients[id] ?? null : null));
}

export function useCardsOfProject(projectId: string): { card: Card; lane: LaneId }[] {
  return boardStore.useStore((s) => cardsOfProject(s.board, projectId));
}

export function useAttachableCards(projectId: string): { card: Card; lane: LaneId }[] {
  return boardStore.useStore((s) => attachableCards(s.board, projectId));
}

export function useBillingMonths(): BillingMonth[] {
  return boardStore.useStore((s) => billingMonths(s.board));
}

export function useClientTotals(clientId: string) {
  return boardStore.useStore((s) => clientTotals(s.board, clientId));
}

export function useProjectsOfClient(clientId: string): Project[] {
  return boardStore.useStore((s) => projectsOfClient(s.board, clientId));
}

export function useCardsOfClient(clientId: string): { card: Card; lane: LaneId }[] {
  return boardStore.useStore((s) => cardsOfClient(s.board, clientId));
}

/* ---------- convenience action hook ---------- */

export function useBoardActions() {
  return {
    dispatch: dispatchBoardAction,
    snapshot: snapshotBoard,
    undo: undoBoardAction,
    swapBoard: swapRemoteBoard,

    // Cards
    quickAdd: (lane: LaneId, title: string, defaultCategoryId: CategoryId) => {
      const card = newCard(title, { colour: defaultCategoryId });
      dispatchBoardAction({ type: 'add', lane, card });
      return card;
    },

    addAndOpen: (lane: LaneId, defaultCategoryId: CategoryId) => {
      const card = newCard('', { colour: defaultCategoryId });
      dispatchBoardAction({ type: 'add', lane, card });
      return card;
    },

    newCardFromCard: (sourceId: string) => {
      const board = getBoardState();
      const source = board.cards[sourceId];
      if (!source) return null;
      const lane = laneOf(board, sourceId) ?? BACKLOG;
      const card = newCard('', {
        colour: source.colour,
        projectId: source.projectId,
        clients: [...source.clients],
      });
      const index = (board.lanes[lane] ?? []).indexOf(sourceId) + 1;
      dispatchBoardAction({ type: 'add', lane, card, index });
      return card;
    },

    patchCard: (id: string, patch: Partial<Card>) => {
      dispatchBoardAction({ type: 'update', id, patch });
    },

    deleteCard: (id: string) => {
      snapshotBoard();
      dispatchBoardAction({ type: 'delete', id });
    },

    duplicateCard: (id: string) => {
      dispatchBoardAction({ type: 'duplicate', id });
    },

    moveCard: (id: string, lane: LaneId, index?: number) => {
      dispatchBoardAction({ type: 'move', id, lane, index });
    },

    // Projects
    createProject: (title: string, defaultCategoryId: CategoryId) => {
      const project = newProject(title, { colour: defaultCategoryId });
      dispatchBoardAction({ type: 'addProject', project });
      return project;
    },

    patchProject: (id: string, patch: Partial<Project>) => {
      dispatchBoardAction({ type: 'updateProject', id, patch });
    },

    deleteProject: (id: string) => {
      snapshotBoard();
      dispatchBoardAction({ type: 'deleteProject', id });
    },

    addProjectCard: (projectId: string, title: string, day: LaneId, defaultCategoryId: CategoryId) => {
      const board = getBoardState();
      const project = board.projects[projectId];
      const card = newCard(title, {
        projectId,
        colour: project?.colour ?? defaultCategoryId,
        clients: project?.clientId ? [project.clientId] : [],
      });
      dispatchBoardAction({ type: 'add', lane: day, card });
      return card;
    },

    attachProjectCard: (cardId: string, projectId: string) => {
      dispatchBoardAction({ type: 'update', id: cardId, patch: { projectId } });
    },

    // Clients
    addClient: (name: string) => {
      const board = getBoardState();
      const colour = CLIENT_PALETTE[board.clientOrder.length % CLIENT_PALETTE.length];
      const client = newClient(name, colour);
      dispatchBoardAction({ type: 'addClient', client });
      return client;
    },

    patchClient: (id: string, patch: Partial<Client>) => {
      dispatchBoardAction({ type: 'updateClient', id, patch });
    },

    deleteClient: (id: string) => {
      snapshotBoard();
      dispatchBoardAction({ type: 'deleteClient', id });
    },

    // Categories
    patchCategory: (id: CategoryId, patch: Partial<Category>) => {
      dispatchBoardAction({ type: 'category', id, patch });
    },

    addCategory: (label: string) => {
      const board = getBoardState();
      const colour = CATEGORY_PALETTE[board.categoryOrder.length % CATEGORY_PALETTE.length];
      const { id, category } = newCategory(label, colour);
      dispatchBoardAction({ type: 'addCategory', id, category });
    },

    deleteCategory: (id: string) => {
      snapshotBoard();
      dispatchBoardAction({ type: 'deleteCategory', id });
    },

    resetCategories: () => {
      if (!window.confirm('Put every category label and colour back to the defaults?')) return;
      snapshotBoard();
      dispatchBoardAction({ type: 'resetCategories' });
    },

    // Update categories
    patchUpdateCategory: (id: string, patch: Partial<UpdateCategory>) => {
      dispatchBoardAction({ type: 'updateCategory', id, patch });
    },

    addUpdateCategory: (label: string) => {
      const board = getBoardState();
      const colour = CATEGORY_PALETTE[board.updateCategoryOrder.length % CATEGORY_PALETTE.length];
      const { id, category } = newUpdateCategory(label, colour);
      dispatchBoardAction({ type: 'addUpdateCategory', id, category });
    },

    deleteUpdateCategory: (id: string) => {
      snapshotBoard();
      dispatchBoardAction({ type: 'deleteUpdateCategory', id });
    },

    resetUpdateCategories: () => {
      if (!window.confirm('Put every update category label and colour back to the defaults?')) return;
      snapshotBoard();
      dispatchBoardAction({ type: 'resetUpdateCategories' });
    },

    // Card updates (work logs)
    addCardUpdate: (cardId: string, categoryId: string, minutes: number, note: string) => {
      dispatchBoardAction({
        type: 'addUpdate',
        cardId,
        update: newCardUpdate(categoryId, minutes, note),
      });
    },

    patchCardUpdate: (cardId: string, updateId: string, patch: Partial<CardUpdate>) => {
      dispatchBoardAction({ type: 'patchUpdate', cardId, updateId, patch });
    },

    deleteCardUpdate: (cardId: string, updateId: string) => {
      dispatchBoardAction({ type: 'deleteUpdate', cardId, updateId });
    },

    // Import / Export
    exportBoard: () => {
      const board = getBoardState();
      const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `t-card-planner-${todayKey()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },

    importBoard: async (file: File) => {
      try {
        const state = normalise(JSON.parse(await file.text()));
        const count = Object.keys(state.cards).length;
        if (!window.confirm(`Replace the current board with ${count} card${count === 1 ? '' : 's'} from ${file.name}?`)) return;
        snapshotBoard();
        swapRemoteBoard(state);
      } catch {
        window.alert("Couldn't read that file — it doesn't look like a T-Card Planner export.");
      }
    },
  };
}
