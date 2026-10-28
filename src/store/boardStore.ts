import {
  BACKLOG,
  CATEGORY_PALETTE,
  CLIENT_PALETTE,
  type BillingBucket,
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
  pastUnfinishedCards,
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
export const WORKSPACE_STORAGE_KEY = 'tcard-planner.workspace';

function readStoredWorkspaceId(): string {
  try {
    return localStorage.getItem(WORKSPACE_STORAGE_KEY)?.trim() || 'default';
  } catch {
    return 'default';
  }
}

interface BoardStoreState {
  workspaceId: string;
  board: BoardState;
  past: BoardState[];
  canUndo: boolean;
}

const initialWorkspaceId = readStoredWorkspaceId();
const initialBoard = load(initialWorkspaceId);

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(board: BoardState, workspaceId = boardStore.getState().workspaceId) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => save(board, workspaceId), 200);
}

export const boardStore = createStore<BoardStoreState>({
  workspaceId: initialWorkspaceId,
  board: initialBoard,
  past: [],
  canUndo: false,
});

export function getBoardState(): BoardState {
  return boardStore.getState().board;
}

export function getActiveWorkspaceId(): string {
  return boardStore.getState().workspaceId;
}

export function switchWorkspaceBoard(workspaceId: string): void {
  const nextId = workspaceId.trim() || 'default';
  const current = boardStore.getState();
  if (current.workspaceId === nextId) return;
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  save(current.board, current.workspaceId);
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, nextId);
  } catch {
    // Ignore storage failures.
  }
  const nextBoard = load(nextId);
  boardStore.setState({
    workspaceId: nextId,
    board: nextBoard,
    past: [],
    canUndo: false,
  });
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
    scheduleSave(next, current.workspaceId);
    boardStore.setState({ board: next });
  }
}

export function undoBoardAction(): void {
  const { past, workspaceId } = boardStore.getState();
  const previous = past[past.length - 1];
  if (!previous) return;
  const nextPast = past.slice(0, -1);
  scheduleSave(previous, workspaceId);
  boardStore.setState({
    board: previous,
    past: nextPast,
    canUndo: nextPast.length > 0,
  });
}

export const BACKUP_STORAGE_KEY = 'tcard-planner.board.backup.v1';

export function swapRemoteBoard(incoming: BoardState): void {
  const { board: current, past, workspaceId } = boardStore.getState();
  try {
    if (Object.keys(current.cards).length > 0) {
      localStorage.setItem(
        `${BACKUP_STORAGE_KEY}:${workspaceId}`,
        JSON.stringify({ savedAt: new Date().toISOString(), board: current }),
      );
    }
  } catch {
    // Ignore storage quota errors on backup.
  }
  const stranded = [...current.orphanedEvents, ...strandedEvents(current, incoming)];
  let next = incoming;
  if (stranded.length > 0) {
    next = reducer(next, { type: 'orphanEvents', ids: stranded });
  }
  scheduleSave(next, workspaceId);
  boardStore.setState({
    board: next,
    past: [...past, current].slice(-HISTORY_LIMIT),
    canUndo: true,
  });
}

/* ---------- hooks for specific slices ---------- */

export function useBoard<T>(selector: (board: BoardState) => T): T {
  return boardStore.useStore((s) => selector(s.board));
}

export function useCanUndo(): boolean {
  return boardStore.useStore((s) => s.canUndo);
}

export function usePastUnfinishedCount(today = todayKey()): number {
  return boardStore.useStore((s) => pastUnfinishedCards(s.board, today).length);
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

    rolloverPastCards: (fromLane?: LaneId) => {
      const today = todayKey();
      const board = getBoardState();
      const count = pastUnfinishedCards(board, today).filter(
        ({ lane }) => !fromLane || lane === fromLane,
      ).length;
      if (count === 0) return 0;
      snapshotBoard();
      dispatchBoardAction({ type: 'rolloverPast', today, fromLane });
      return count;
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

    patchMilestoneMonth: (projectId: string, milestoneId: string, invoiceMonth: string | null) => {
      const project = getBoardState().projects[projectId];
      if (!project) return;
      const milestones = project.milestones.map((ms) =>
        ms.id === milestoneId ? { ...ms, invoiceMonth } : ms,
      );
      dispatchBoardAction({ type: 'updateProject', id: projectId, patch: { milestones } });
    },

    patchMilestoneStatus: (projectId: string, milestoneId: string, status: BillingBucket) => {
      const project = getBoardState().projects[projectId];
      if (!project) return;
      const milestones = project.milestones.map((ms) =>
        ms.id === milestoneId ? { ...ms, status } : ms,
      );
      dispatchBoardAction({ type: 'updateProject', id: projectId, patch: { milestones } });
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
    addCardUpdate: (cardId: string, categoryId: string, minutes: number, note: string, date?: string) => {
      dispatchBoardAction({
        type: 'addUpdate',
        cardId,
        update: newCardUpdate(categoryId, minutes, note, date),
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
