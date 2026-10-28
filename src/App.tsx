import { useCallback, useEffect, useMemo, useRef } from 'react';
import { DndContext, DragOverlay, MeasuringStrategy } from '@dnd-kit/core';
import Lane from './components/Lane';
import CardPanel from './components/CardPanel';
import TopBar from './components/TopBar';
import SettingsDialog from './components/settings/SettingsDialog';
import DayView from './components/DayView';
import MonthView from './components/MonthView';
import ProjectsView from './components/projects/ProjectsView';
import ClientsView from './components/ClientsView';
import BillingView from './components/BillingView';
import { CardFace } from './components/TCard';
import {
  billingMonths,
  cardsIn,
  cardsOfClient,
  clientTotals,
  laneOf,
  projectsOfClient,
} from './store';
import {
  BACKLOG,
  STATUS_LABELS,
  categoryLabel,
  type Card,
  type LaneId,
} from './types';
import { CategoriesProvider, useCategoryColours } from './categories';
import { LookupsProvider } from './lookups';
import {
  formatDayName,
  formatDayNumber,
  formatFullDay,
  formatMonth,
  formatWeekRange,
  isPast,
  isToday,
  isWeekend,
  monthGrid,
  startOfWeek,
  weekKeys,
} from './dates';
import { summarise } from './cardText';
import { useSync } from './sync';
import { flushUploads, referencedFileIds, setRemoteFiles, sweepAttachments } from './attachments';
import { useAppUpdate } from './updates';
import { effectiveConfig, useM365, usePublishing } from './m365';
import { useCalendarFeed } from './feed';
import { ConflictBar, OfflineBar } from './components/SyncBadge';
import {
  useBoard,
  useBoardActions,
  useCanUndo,
  useClientList,
  usePastUnfinishedCount,
} from './store/boardStore';
import { useSettings, useSettingsActions } from './store/settingsStore';
import { useUIActions, useUIStore } from './store/uiStore';
import { useBoardDnd } from './hooks/useBoardDnd';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

const SWEEP_DELAY_MS = 8000;

export default function App() {
  const board = useBoard((b) => b);
  const boardActions = useBoardActions();
  const canUndo = useCanUndo();
  const pastUnfinishedCount = usePastUnfinishedCount();

  const settings = useSettings();
  const settingsActions = useSettingsActions();

  const ui = useUIStore((s) => s);
  const uiActions = useUIActions();

  const searchRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLElement>(null);

  useCategoryColours(board.categories);

  // Sync with Worker
  const sync = useSync(board, boardActions.swapBoard);
  const update = useAppUpdate();

  // Offline no longer locks the board! Only an unresolved conflict pauses mutations.
  const locked = sync.status === 'conflict';

  // Remote file synchronisation
  const filesRemote = sync.status !== 'off' && sync.status !== 'unconfigured';
  useEffect(() => {
    setRemoteFiles(filesRemote);
  }, [filesRemote]);

  // Clean up unused file attachments
  const inStep = sync.status === 'idle' || sync.status === 'off';
  useEffect(() => {
    if (!inStep) return;
    const timer = setTimeout(() => {
      void flushUploads();
      void sweepAttachments(referencedFileIds(board), { remote: filesRemote });
    }, SWEEP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [inStep, filesRemote, board]);

  // Derived calendar dates
  const days = useMemo(
    () => weekKeys(startOfWeek(ui.focus), settings.includeWeekend),
    [ui.focus, settings.includeWeekend],
  );
  const weeks = useMemo(
    () => monthGrid(ui.focus, settings.includeWeekend),
    [ui.focus, settings.includeWeekend],
  );

  // Auto-scroll to today in Week view
  useEffect(() => {
    if (ui.view !== 'week') return;
    const today = boardRef.current?.querySelector('.lane.is-today');
    today?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
  }, [ui.focus, ui.view]);

  // Search and client filter
  const searchMatches = useMemo(() => {
    const needle = ui.searchQuery.trim().toLowerCase();
    if (!needle) return null;
    const found = new Set<string>();
    for (const card of Object.values(board.cards)) {
      const haystack = [
        card.title,
        summarise(card.description).excerpt,
        categoryLabel(board.categories, card.colour),
        STATUS_LABELS[card.status],
        card.projectId ? board.projects[card.projectId]?.title ?? '' : '',
        ...card.clients.map((id) => board.clients[id]?.name ?? ''),
      ]
        .join(' ')
        .toLowerCase();
      if (haystack.includes(needle)) found.add(card.id);
    }
    return found;
  }, [ui.searchQuery, board.cards, board.categories, board.projects, board.clients]);

  const filterMatches = useMemo(() => {
    const wanted = ui.clientFilter.filter((id) => board.clients[id]);
    if (wanted.length === 0) return null;
    const found = new Set<string>();
    for (const id of wanted) {
      for (const { card } of cardsOfClient(board, id)) found.add(card.id);
    }
    return found;
  }, [board, ui.clientFilter]);

  const matches = useMemo(() => {
    if (!searchMatches) return filterMatches;
    if (!filterMatches) return searchMatches;
    return new Set([...searchMatches].filter((id) => filterMatches.has(id)));
  }, [filterMatches, searchMatches]);

  const clientList = useClientList();
  const months = useMemo(() => billingMonths(board), [board]);
  const clientSums = useCallback((id: string) => clientTotals(board, id), [board]);
  const clientProjects = useCallback((id: string) => projectsOfClient(board, id), [board]);
  const clientCards = useCallback((id: string) => cardsOfClient(board, id), [board]);

  const defaultCategoryId = useMemo(
    () => (board.categories[settings.defaultCategory] ? settings.defaultCategory : board.categoryOrder[0]),
    [board.categories, board.categoryOrder, settings.defaultCategory],
  );

  const openCard: Card | null = ui.openCardId ? board.cards[ui.openCardId] ?? null : null;
  const openLane = openCard ? laneOf(board, openCard.id) ?? BACKLOG : BACKLOG;

  // Cleanup if opened entity was deleted
  useEffect(() => {
    if (ui.openCardId && !board.cards[ui.openCardId]) uiActions.setOpenCardId(null);
  }, [ui.openCardId, board.cards, uiActions]);

  useEffect(() => {
    uiActions.setClientFilter((current) => {
      const kept = current.filter((id) => board.clients[id]);
      return kept.length === current.length ? current : kept;
    });
    if (ui.openClientId && !board.clients[ui.openClientId]) {
      uiActions.setOpenClientId(null);
    }
  }, [board.clients, ui.openClientId, uiActions]);

  const lookups = useMemo(
    () => ({
      clients: board.clients,
      projects: board.projects,
      clientOrder: board.clientOrder,
      categoryOrder: board.categoryOrder,
      updateCategories: board.updateCategories,
      updateCategoryOrder: board.updateCategoryOrder,
      users: sync.users,
      showDescription: settings.showDescription,
    }),
    [
      board.clients,
      board.projects,
      board.clientOrder,
      board.categoryOrder,
      board.updateCategories,
      board.updateCategoryOrder,
      sync.users,
      settings.showDescription,
    ],
  );

  // Microsoft 365 and Calendar Feed
  const m365Config = useMemo(() => effectiveConfig(settings.m365), [settings.m365]);
  const m365 = useM365(m365Config);
  const feed = useCalendarFeed((sync.signedIn || sync.hasToken) && ui.showSettings);
  const calendarReady = m365.status === 'connected';

  useEffect(() => {
    if (ui.view === 'day') m365.watch(ui.focus, ui.focus);
    else if (ui.view === 'month') m365.watch(weeks[0]?.[0] ?? ui.focus, weeks.at(-1)?.at(-1) ?? ui.focus);
    else if (ui.view === 'week') m365.watch(days[0], days[days.length - 1]);
  }, [days, ui.focus, m365, ui.view, weeks]);

  const publishable = useMemo(() => {
    const list: { card: Card; lane: LaneId }[] = [];
    for (const [lane, ids] of Object.entries(board.lanes)) {
      for (const id of ids) {
        const card = board.cards[id];
        if (card && (card.publish || card.eventId)) list.push({ card, lane });
      }
    }
    return list;
  }, [board.cards, board.lanes]);

  const publishing = usePublishing(
    m365Config,
    calendarReady,
    publishable,
    boardActions.patchCard,
    board.orphanedEvents,
    (ids: string[]) => boardActions.dispatch({ type: 'eventsRemoved', ids }),
  );

  // Drag-and-drop
  const dnd = useBoardDnd({
    board,
    dispatch: boardActions.dispatch,
    snapshot: boardActions.snapshot,
  });

  // Global Keyboard shortcuts
  useKeyboardShortcuts({
    showSettings: ui.showSettings,
    onCloseSettings: () => uiActions.setShowSettings(false),
    onCloseCard: () => uiActions.setOpenCardId(null),
    canUndo: canUndo && !locked,
    onUndo: boardActions.undo,
    searchRef,
    view: ui.view,
    focus: ui.focus,
    days,
    onAddAndOpen: (lane) => {
      const card = boardActions.addAndOpen(lane, defaultCategoryId);
      uiActions.setOpenCardId(card.id);
    },
  });

  const rangeLabel =
    ui.view === 'day'
      ? formatFullDay(ui.focus)
      : ui.view === 'month'
        ? formatMonth(ui.focus)
        : formatWeekRange(days);

  const banner = m365.error ?? publishing.error;

  return (
    <CategoriesProvider value={board.categories}>
      <LookupsProvider value={lookups}>
        <div className={openCard && settings.cardSurface === 'drawer' ? 'app has-drawer' : 'app'}>
          <TopBar
            view={ui.view}
            onView={uiActions.setView}
            rangeLabel={rangeLabel}
            onShift={uiActions.shiftFocus}
            onToday={uiActions.resetFocusToToday}
            query={ui.searchQuery}
            onQuery={uiActions.setSearchQuery}
            settings={settings}
            onSettings={settingsActions.updateSettings}
            onOpenSettings={() => uiActions.setShowSettings(true)}
            canUndo={canUndo && !locked}
            onUndo={boardActions.undo}
            pastUnfinishedCount={!locked ? pastUnfinishedCount : 0}
            onRolloverPast={() => boardActions.rolloverPastCards()}
            onSelectCard={uiActions.setOpenCardId}
            searchRef={searchRef}
            clients={clientList}
            clientFilter={ui.clientFilter}
            onClientFilter={uiActions.setClientFilter}
            sync={sync}
            update={update}
          />

          <ConflictBar sync={sync} />
          <OfflineBar sync={sync} />

          {banner && (
            <p className="calendar-banner" role="status">
              {banner}
            </p>
          )}

          <DndContext
            sensors={locked ? [] : dnd.sensors}
            collisionDetection={dnd.collisionDetection}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={dnd.onDragStart}
            onDragOver={dnd.onDragOver}
            onDragEnd={dnd.onDragEnd}
            onDragCancel={dnd.onDragCancel}
          >
            {ui.view === 'week' && (
              <main className="board" ref={boardRef}>
                <Lane
                  id={BACKLOG}
                  title="Backlog"
                  subtitle="Unscheduled"
                  cards={cardsIn(board, BACKLOG)}
                  matches={matches}
                  isBacklog
                  capacity={settings.capacity}
                  locked={locked}
                  onOpen={uiActions.setOpenCardId}
                  onQuickAdd={(lane, title) => boardActions.quickAdd(lane, title, defaultCategoryId)}
                  onNewFromProject={(id) => {
                    const card = boardActions.newCardFromCard(id);
                    if (card) uiActions.setOpenCardId(card.id);
                  }}
                  onPatch={boardActions.patchCard}
                />

                {days.map((day) => (
                  <Lane
                    key={day}
                    id={day}
                    title={formatDayName(day)}
                    subtitle={isToday(day) ? `${formatDayNumber(day)} · today` : formatDayNumber(day)}
                    cards={cardsIn(board, day)}
                    matches={matches}
                    isToday={isToday(day)}
                    isPast={isPast(day)}
                    isWeekend={isWeekend(day)}
                    capacity={settings.capacity}
                    locked={locked}
                    events={m365.events.get(day)}
                    onOpen={uiActions.setOpenCardId}
                    onQuickAdd={(lane, title) => boardActions.quickAdd(lane, title, defaultCategoryId)}
                    onOpenDay={uiActions.openDay}
                    onNewFromProject={(id) => {
                      const card = boardActions.newCardFromCard(id);
                      if (card) uiActions.setOpenCardId(card.id);
                    }}
                    onPatch={boardActions.patchCard}
                  />
                ))}
              </main>
            )}

            {ui.view === 'month' && (
              <main className="board is-month">
                <MonthView
                  anchor={ui.focus}
                  weeks={weeks}
                  cardsFor={(day) => cardsIn(board, day)}
                  events={m365.events}
                  matches={matches}
                  onOpen={uiActions.setOpenCardId}
                  onOpenDay={uiActions.openDay}
                />
              </main>
            )}

            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
              {dnd.activeCard ? <CardFace card={dnd.activeCard} dragging /> : null}
            </DragOverlay>
          </DndContext>

          {ui.view === 'day' && (
            <main className="board is-day">
              <DayView
                day={ui.focus}
                cards={cardsIn(board, ui.focus)}
                events={m365.events.get(ui.focus) ?? []}
                settings={settings}
                calendarReady={calendarReady}
                locked={locked}
                onOpen={uiActions.setOpenCardId}
                onPatch={boardActions.patchCard}
                onQuickAdd={(lane, title) => boardActions.quickAdd(lane, title, defaultCategoryId)}
              />
            </main>
          )}

          {ui.view === 'projects' && (
            <main className="board is-projects">
              <ProjectsView />
            </main>
          )}

          {ui.view === 'billing' && (
            <main className="board is-billing">
              <BillingView
                months={months}
                clients={board.clients}
                onMonth={(id, invoiceMonth) => boardActions.patchProject(id, { invoiceMonth })}
                onMilestoneMonth={boardActions.patchMilestoneMonth}
                onMilestoneStatus={boardActions.patchMilestoneStatus}
                onOpenProject={uiActions.openProjectFrom}
                locked={locked}
              />
            </main>
          )}

          {ui.view === 'clients' && (
            <main className="board is-clients">
              <ClientsView
                clients={clientList}
                totals={clientSums}
                projectsOf={clientProjects}
                cardsOf={clientCards}
                selected={ui.openClientId}
                onSelect={uiActions.setOpenClientId}
                onCreate={boardActions.addClient}
                onPatch={boardActions.patchClient}
                onDelete={boardActions.deleteClient}
                onOpenCard={uiActions.setOpenCardId}
                onOpenProject={uiActions.openProjectFrom}
                onMoveCard={boardActions.moveCard}
                locked={locked}
              />
            </main>
          )}

          {openCard && (
            <CardPanel
              key={openCard.id}
              card={openCard}
              lane={openLane}
              surface={settings.cardSurface}
              calendarReady={calendarReady}
              locked={locked}
              onPatch={boardActions.patchCard}
              onMove={boardActions.moveCard}
              onDuplicate={boardActions.duplicateCard}
              onDelete={boardActions.deleteCard}
              onAddUpdate={boardActions.addCardUpdate}
              onPatchUpdate={boardActions.patchCardUpdate}
              onDeleteUpdate={boardActions.deleteCardUpdate}
              onClose={() => uiActions.setOpenCardId(null)}
            />
          )}

          {ui.showSettings && (
            <SettingsDialog
              sync={sync}
              m365={m365}
              feed={feed}
              onClose={() => uiActions.setShowSettings(false)}
            />
          )}
        </div>
      </LookupsProvider>
    </CategoriesProvider>
  );
}
