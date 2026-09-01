import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Over,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import Lane from './components/Lane';
import CardPanel from './components/CardPanel';
import TopBar from './components/TopBar';
import SettingsDialog from './components/SettingsDialog';
import DayView from './components/DayView';
import MonthView from './components/MonthView';
import ProjectsView from './components/ProjectsView';
import ClientsView from './components/ClientsView';
import { CardFace } from './components/TCard';
import type { Action } from './store';
import {
  byStage,
  cardsIn,
  cardsOfClient,
  cardsOfProject,
  clientTotals,
  projectsOfClient,
  laneOf,
  load,
  newCard,
  newClient,
  newProject,
  normalise,
  reducer,
  sameArrangement,
  save,
} from './store';
import {
  BACKLOG,
  CATEGORY_IDS,
  CLIENT_PALETTE,
  DEFAULT_SETTINGS,
  STATUS_LABELS,
  categoryLabel,
  type BoardState,
  type Card,
  type Category,
  type CategoryId,
  type Client,
  type LaneId,
  type Project,
  type Settings,
  type ViewMode,
} from './types';
import { CategoriesProvider, useCategoryColours } from './categories';
import { LookupsProvider } from './lookups';
import {
  addDays,
  addMonths,
  formatDayName,
  formatDayNumber,
  formatFullDay,
  formatMonth,
  formatWeekRange,
  isPast,
  isToday,
  isWeekend,
  monthGrid,
  startOfMonth,
  startOfWeek,
  todayKey,
  weekKeys,
} from './dates';
import { summarise } from './cardText';
import { useSync } from './sync';
import { useM365, usePublishing } from './m365';
import { ConflictBar } from './components/SyncBadge';

const SETTINGS_KEY = 'tcard-planner.settings.v1';
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_LIMIT = 40;

/** Pointer position beats bounding-box overlap on a board this wide: a card is
 *  wider than the gap between columns, so rect-based hits drift a lane sideways.
 *  The rect strategies are only a fallback for keyboard drags and gaps. */
const collisionDetection: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  if (byPointer.length > 0) return byPointer;
  const byRect = rectIntersection(args);
  return byRect.length > 0 ? byRect : closestCorners(args);
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    const preferDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return {
      ...DEFAULT_SETTINGS,
      theme: preferDark ? 'dark' : 'light',
      ...stored,
      // Settings written before the calendar existed have no `m365` at all.
      m365: { ...DEFAULT_SETTINGS.m365, ...(stored.m365 ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function App() {
  const [board, dispatch] = useReducer(reducer, undefined, load);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [view, setView] = useState<ViewMode>('week');
  /** One day the whole app is looking at; each view reads the week, day or
   *  month around it, so switching views keeps your place. */
  const [focus, setFocus] = useState(todayKey);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [openClient, setOpenClient] = useState<string | null>(null);
  /** Client ids the board is narrowed to; empty means all of them. Deliberately
   *  not persisted — coming back to a filtered board you don't remember setting
   *  is worse than setting it again. */
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [past, setPast] = useState<BoardState[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  /** Snapshot before anything a misclick would make expensive: a delete, a
   *  roll-over, an import. Drags file their own entry; typing is left to the
   *  editor's own undo. */
  const snapshot = useCallback(() => setPast((stack) => [...stack, board].slice(-HISTORY_LIMIT)), [board]);

  const undo = useCallback(() => {
    const previous = past[past.length - 1];
    if (!previous) return;
    dispatch({ type: 'replace', state: previous });
    setPast((stack) => stack.slice(0, -1));
  }, [past]);

  /* ---------- persistence ---------- */

  useEffect(() => {
    const timer = setTimeout(() => save(board), 200);
    return () => clearTimeout(timer);
  }, [board]);

  useCategoryColours(board.categories);

  // localStorage stays the local copy of record; the Worker keeps devices level.
  const adoptRemote = useCallback((state: BoardState) => dispatch({ type: 'replace', state }), []);
  const sync = useSync(board, adoptRemote);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  /* ---------- derived ---------- */

  const days = useMemo(() => weekKeys(startOfWeek(focus), settings.includeWeekend), [focus, settings.includeWeekend]);
  const weeks = useMemo(() => monthGrid(focus, settings.includeWeekend), [focus, settings.includeWeekend]);

  // On a phone only one column fits, and on a laptop a long week can overflow.
  // Either way the useful column is today's, not the backlog on the far left.
  const boardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (view !== 'week') return;
    const today = boardRef.current?.querySelector('.lane.is-today');
    // Instant, not smooth: an animation here would fight a user who starts
    // dragging or scrolling the moment the board appears.
    today?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
  }, [focus, view]);

  const searchMatches = useMemo(() => {
    const needle = query.trim().toLowerCase();
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
  }, [query, board.cards, board.categories, board.projects, board.clients]);

  /** The filter uses the same definition of a client's work as the Clients
   *  view: their tagged cards, plus everything on their projects. */
  const filterMatches = useMemo(() => {
    const wanted = clientFilter.filter((id) => board.clients[id]);
    if (wanted.length === 0) return null;
    const found = new Set<string>();
    for (const id of wanted) for (const { card } of cardsOfClient(board, id)) found.add(card.id);
    return found;
  }, [board, clientFilter]);

  // Two narrowings at once means both have to be satisfied, not either.
  const matches = useMemo(() => {
    if (!searchMatches) return filterMatches;
    if (!filterMatches) return searchMatches;
    return new Set([...searchMatches].filter((id) => filterMatches.has(id)));
  }, [filterMatches, searchMatches]);

  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<CategoryId, number>;
    for (const card of Object.values(board.cards)) counts[card.colour] = (counts[card.colour] ?? 0) + 1;
    return counts;
  }, [board.cards]);

  const clientCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const card of Object.values(board.cards)) for (const id of card.clients) counts[id] = (counts[id] ?? 0) + 1;
    for (const project of Object.values(board.projects)) {
      if (project.clientId) counts[project.clientId] = (counts[project.clientId] ?? 0) + 1;
    }
    return counts;
  }, [board.cards, board.projects]);

  const clientList = useMemo(
    () => board.clientOrder.map((id) => board.clients[id]).filter(Boolean) as Client[],
    [board.clientOrder, board.clients],
  );

  // Pipeline order, so the list reads as a funnel and the stage headings drawn
  // down it land on runs rather than on every other row.
  const projectList = useMemo(() => Object.values(board.projects).sort(byStage), [board.projects]);

  const overdue = useMemo(() => {
    const lanes = Object.keys(board.lanes).filter((lane) => DAY_KEY.test(lane) && isPast(lane)).sort();
    const count = lanes.reduce(
      (sum, lane) => sum + (board.lanes[lane] ?? []).filter((id) => board.cards[id]?.status !== 'done').length,
      0,
    );
    return { lanes, count };
  }, [board]);

  const openCard: Card | null = openId ? board.cards[openId] ?? null : null;
  const openLane = openCard ? laneOf(board, openCard.id) ?? BACKLOG : BACKLOG;
  const activeCard = activeId ? board.cards[activeId] ?? null : null;

  useEffect(() => {
    if (openId && !board.cards[openId]) setOpenId(null);
  }, [openId, board.cards]);

  useEffect(() => {
    setClientFilter((current) => {
      const kept = current.filter((id) => board.clients[id]);
      return kept.length === current.length ? current : kept;
    });
    setOpenClient((current) => (current && !board.clients[current] ? null : current));
  }, [board.clients]);

  const lookups = useMemo(
    () => ({
      clients: board.clients,
      projects: board.projects,
      clientOrder: board.clientOrder,
      showDescription: settings.showDescription,
    }),
    [board.clients, board.projects, board.clientOrder, settings.showDescription],
  );

  /* ---------- the calendar ---------- */

  const m365 = useM365(settings.m365);
  const calendarReady = m365.status === 'connected';

  // Whichever view is up decides the stretch of calendar worth holding.
  useEffect(() => {
    if (view === 'day') m365.watch(focus, focus);
    else if (view === 'month') m365.watch(weeks[0]?.[0] ?? focus, weeks.at(-1)?.at(-1) ?? focus);
    else if (view === 'week') m365.watch(days[0], days[days.length - 1]);
  }, [days, focus, m365, view, weeks]);

  /** Only the cards the calendar has any say over: the ones ticked to publish,
   *  and the ones that were and now need their entry taking away. */
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

  const patchCard = useCallback((id: string, patch: Partial<Card>) => dispatch({ type: 'update', id, patch }), []);
  const publishing = usePublishing(settings.m365, calendarReady, publishable, patchCard);

  /* ---------- card actions ---------- */

  const moveCard = useCallback((id: string, lane: LaneId) => dispatch({ type: 'move', id, lane }), []);

  const quickAdd = useCallback(
    (lane: LaneId, title: string) => {
      const card = newCard(title, { colour: settings.defaultCategory });
      dispatch({ type: 'add', lane, card });
    },
    [settings.defaultCategory],
  );

  const addAndOpen = useCallback(
    (lane: LaneId) => {
      const card = newCard('', { colour: settings.defaultCategory });
      dispatch({ type: 'add', lane, card });
      setOpenId(card.id);
    },
    [settings.defaultCategory],
  );

  const setCategory = useCallback(
    (id: CategoryId, patch: Partial<Category>) => dispatch({ type: 'category', id, patch }),
    [],
  );

  const resetCategories = useCallback(() => {
    if (!window.confirm('Put every category label and colour back to the defaults?')) return;
    snapshot();
    dispatch({ type: 'resetCategories' });
  }, [snapshot]);

  const rollOver = useCallback(() => {
    if (overdue.count === 0) return;
    const plural = overdue.count === 1 ? 'card' : 'cards';
    if (!window.confirm(`Move ${overdue.count} unfinished ${plural} from past days to today?`)) return;
    snapshot();
    dispatch({ type: 'rollOver', from: overdue.lanes, to: todayKey() });
    setFocus(todayKey());
  }, [overdue, snapshot]);

  /* ---------- projects and clients ---------- */

  const createProject = useCallback(
    (title: string) => {
      const project = newProject(title, { colour: settings.defaultCategory });
      dispatch({ type: 'addProject', project });
      setOpenProject(project.id);
    },
    [settings.defaultCategory],
  );

  const patchProject = useCallback(
    (id: string, patch: Partial<Project>) => dispatch({ type: 'updateProject', id, patch }),
    [],
  );

  const deleteProject = useCallback(
    (id: string) => {
      snapshot();
      dispatch({ type: 'deleteProject', id });
    },
    [snapshot],
  );

  /** A card made inside a project inherits its category and its clients, and
   *  lands on whichever day the row was set to. */
  const addProjectCard = useCallback(
    (projectId: string, title: string, day: LaneId) => {
      const project = board.projects[projectId];
      const card = newCard(title, {
        projectId,
        colour: project?.colour ?? settings.defaultCategory,
        // A card can still wear several clients; it just starts with its
        // project's one, which is the answer nearly every time.
        clients: project?.clientId ? [project.clientId] : [],
      });
      dispatch({ type: 'add', lane: day, card });
    },
    [board.projects, settings.defaultCategory],
  );

  const addClient = useCallback(
    (name: string) => {
      const colour = CLIENT_PALETTE[board.clientOrder.length % CLIENT_PALETTE.length];
      dispatch({ type: 'addClient', client: newClient(name, colour) });
    },
    [board.clientOrder.length],
  );

  const deleteClient = useCallback(
    (id: string) => {
      snapshot();
      dispatch({ type: 'deleteClient', id });
    },
    [snapshot],
  );

  const projectCards = useCallback((projectId: string) => cardsOfProject(board, projectId), [board]);
  const clientProjects = useCallback((clientId: string) => projectsOfClient(board, clientId), [board]);
  const clientCards = useCallback((clientId: string) => cardsOfClient(board, clientId), [board]);
  const clientSums = useCallback((clientId: string) => clientTotals(board, clientId), [board]);

  /** From a client's project straight to that project, which is where you go
   *  next often enough that hunting for it in the other tab is a nuisance. */
  const openProjectFrom = useCallback((id: string) => {
    setOpenProject(id);
    setView('projects');
  }, []);

  /* ---------- import / export ---------- */

  const exportBoard = useCallback(() => {
    const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `t-card-planner-${todayKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [board]);

  const importBoard = useCallback(async (file: File) => {
    try {
      const state = normalise(JSON.parse(await file.text()));
      const count = Object.keys(state.cards).length;
      if (!window.confirm(`Replace the current board with ${count} card${count === 1 ? '' : 's'} from ${file.name}?`)) return;
      snapshot();
      dispatch({ type: 'replace', state });
      setOpenId(null);
    } catch {
      window.alert(`Couldn't read that file — it doesn't look like a T-Card Planner export.`);
    }
  }, [snapshot]);

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (event.key === 'Escape') {
        if (typing) return;
        // The dialog handles its own Escape; this catches the case where focus
        // has wandered off it, so the key still means "close the top thing".
        if (showSettings) setShowSettings(false);
        else setOpenId(null);
        return;
      }
      // The dialog is modal: its own shortcuts only, until it closes.
      if (showSettings) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        undo();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        const today = todayKey();
        if (view === 'day') addAndOpen(focus);
        else addAndOpen(days.includes(today) ? today : days[0]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addAndOpen, days, focus, showSettings, undo, view]);

  /* ---------- drag and drop ---------- */

  const sensors = useSensors(
    // A small threshold keeps a plain click on a card as "open", not "drag".
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // On touch a short press starts the drag, so a plain swipe still scrolls
    // the column. Tolerance lets a finger wobble during that press.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const laneFromOver = useCallback(
    (over: Over | null): LaneId | undefined => {
      if (!over) return undefined;
      const data = over.data.current as { type?: string; lane?: LaneId } | undefined;
      if (data?.lane) return data.lane;
      const id = String(over.id);
      return id.startsWith('lane:') ? id.slice(5) : laneOf(board, id);
    },
    [board],
  );

  // The board is edited live while dragging, so keep the pre-drag board to
  // revert to on cancel and to file as the single undo entry for the whole drag.
  const beforeDrag = useRef<BoardState | null>(null);

  const endDrag = (revert: boolean) => {
    const before = beforeDrag.current;
    beforeDrag.current = null;
    setActiveId(null);
    if (revert && before && !sameArrangement(before, board)) dispatch({ type: 'replace', state: before });
    return before;
  };

  const onDragStart = (event: DragStartEvent) => {
    beforeDrag.current = board;
    setActiveId(String(event.active.id));
  };

  /** Where in the target lane a drop lands. Dropped on a card, it takes that
   *  card's place; dropped on the column itself, the reducer decides — which
   *  means above the done pile rather than under it. */
  const indexFromOver = (over: Over, to: LaneId, below: boolean): number | undefined => {
    const data = over.data.current as { type?: string } | undefined;
    if (data?.type !== 'card') return undefined;
    const ids = board.lanes[to] ?? [];
    const at = ids.indexOf(String(over.id));
    return at >= 0 ? at + (below ? 1 : 0) : undefined;
  };

  /** Cross-lane hops happen live, so the gap opens in the column you're over. */
  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const id = String(active.id);
    const from = laneOf(board, id);
    const to = laneFromOver(over);
    if (!from || !to || from === to) return;

    const dragged = active.rect.current.translated;
    const below = dragged ? dragged.top > over.rect.top + over.rect.height / 2 : false;
    dispatch({ type: 'move', id, lane: to, index: indexFromOver(over, to, below) });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const id = String(active.id);
    const to = over ? laneFromOver(over) : undefined;

    // Released over nothing: put the card back rather than leaving it in
    // whichever column it happened to be hovering.
    if (!over || !to) {
      endDrag(true);
      return;
    }
    const before = endDrag(false);

    const action: Action = { type: 'move', id, lane: to, index: indexFromOver(over, to, false) };
    const settled = reducer(board, action);
    if (before && !sameArrangement(before, settled)) setPast((stack) => [...stack, before].slice(-HISTORY_LIMIT));
    if (settled !== board) dispatch(action);
  };

  /* ---------- view plumbing ---------- */

  const shift = useCallback(
    (steps: number) => {
      setFocus((current) => {
        if (view === 'day') return addDays(current, steps);
        if (view === 'month') return startOfMonth(addMonths(startOfMonth(current), steps));
        return addDays(current, steps * 7);
      });
    },
    [view],
  );

  const openDay = useCallback((day: LaneId) => {
    setFocus(day);
    setView('day');
  }, []);

  const rangeLabel =
    view === 'day' ? formatFullDay(focus) : view === 'month' ? formatMonth(focus) : formatWeekRange(days);

  const cardsForDay = useCallback((day: LaneId) => cardsIn(board, day), [board]);

  /* ---------- render ---------- */

  const banner = m365.error ?? publishing.error;

  return (
    <CategoriesProvider value={board.categories}>
      <LookupsProvider value={lookups}>
        <div className={openCard && settings.cardSurface === 'drawer' ? 'app has-drawer' : 'app'}>
          <TopBar
            view={view}
            onView={setView}
            rangeLabel={rangeLabel}
            onShift={shift}
            onToday={() => setFocus(todayKey())}
            query={query}
            onQuery={setQuery}
            settings={settings}
            onSettings={(patch) => setSettings((current) => ({ ...current, ...patch }))}
            onOpenSettings={() => setShowSettings(true)}
            overdueCount={overdue.count}
            onRollOver={rollOver}
            canUndo={past.length > 0}
            onUndo={undo}
            searchRef={searchRef}
            clients={clientList}
            clientFilter={clientFilter}
            onClientFilter={setClientFilter}
            sync={sync}
          />

          <ConflictBar sync={sync} />

          {banner && (
            <p className="calendar-banner" role="status">
              {banner}
            </p>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={() => endDrag(true)}
          >
            {view === 'week' && (
              <main className="board" ref={boardRef}>
                <Lane
                  id={BACKLOG}
                  title="Backlog"
                  subtitle="Unscheduled"
                  cards={cardsIn(board, BACKLOG)}
                  matches={matches}
                  isBacklog
                  capacity={settings.capacity}
                  onOpen={setOpenId}
                  onQuickAdd={quickAdd}
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
                    onOpen={setOpenId}
                    onQuickAdd={quickAdd}
                    onOpenDay={openDay}
                  />
                ))}
              </main>
            )}

            {view === 'month' && (
              <main className="board is-month">
                <MonthView
                  anchor={focus}
                  weeks={weeks}
                  cardsFor={cardsForDay}
                  events={m365.events}
                  matches={matches}
                  onOpen={setOpenId}
                  onOpenDay={openDay}
                />
              </main>
            )}

            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
              {activeCard ? <CardFace card={activeCard} dragging /> : null}
            </DragOverlay>
          </DndContext>

          {view === 'day' && (
            <main className="board is-day">
              <DayView
                day={focus}
                cards={cardsIn(board, focus)}
                events={m365.events.get(focus) ?? []}
                settings={settings}
                calendarReady={calendarReady}
                onOpen={setOpenId}
                onPatch={patchCard}
                onQuickAdd={quickAdd}
              />
            </main>
          )}

          {view === 'projects' && (
            <main className="board is-projects">
              <ProjectsView
                projects={projectList}
                cardsOf={projectCards}
                selected={openProject}
                onSelect={setOpenProject}
                onCreate={createProject}
                onPatch={patchProject}
                onDelete={deleteProject}
                onOpenCard={setOpenId}
                onAddCard={addProjectCard}
                onMoveCard={moveCard}
              />
            </main>
          )}

          {view === 'clients' && (
            <main className="board is-clients">
              <ClientsView
                clients={clientList}
                totals={clientSums}
                projectsOf={clientProjects}
                cardsOf={clientCards}
                selected={openClient}
                onSelect={setOpenClient}
                onCreate={addClient}
                onPatch={(id, patch) => dispatch({ type: 'updateClient', id, patch })}
                onDelete={deleteClient}
                onOpenCard={setOpenId}
                onOpenProject={openProjectFrom}
                onMoveCard={moveCard}
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
              onPatch={patchCard}
              onMove={moveCard}
              onDuplicate={(id) => dispatch({ type: 'duplicate', id })}
              onDelete={(id) => {
                snapshot();
                dispatch({ type: 'delete', id });
                setOpenId(null);
              }}
              onClose={() => setOpenId(null)}
            />
          )}

          {showSettings && (
            <SettingsDialog
              categories={board.categories}
              counts={categoryCounts}
              onCategory={setCategory}
              onResetCategories={resetCategories}
              clients={clientList}
              clientCounts={clientCounts}
              onAddClient={addClient}
              onClient={(id, patch) => dispatch({ type: 'updateClient', id, patch })}
              onDeleteClient={deleteClient}
              settings={settings}
              onSettings={(patch) => setSettings((current) => ({ ...current, ...patch }))}
              m365={m365}
              onExport={exportBoard}
              onImport={importBoard}
              onClose={() => setShowSettings(false)}
            />
          )}
        </div>
      </LookupsProvider>
    </CategoriesProvider>
  );
}
