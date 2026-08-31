import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
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
import CardDrawer from './components/CardDrawer';
import TopBar, { type Settings } from './components/TopBar';
import { CardFace } from './components/TCard';
import type { Action } from './store';
import { cardsIn, laneOf, load, newCard, normalise, reducer, sameArrangement, save } from './store';
import { BACKLOG, COLOUR_LABELS, STATUS_LABELS, type BoardState, type Card, type LaneId } from './types';
import {
  addDays,
  formatDayName,
  formatDayNumber,
  isPast,
  isToday,
  isWeekend,
  startOfWeek,
  todayKey,
  weekKeys,
} from './dates';
import { summarise } from './cardText';

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

const DEFAULT_SETTINGS: Settings = { includeWeekend: false, capacity: 6, theme: 'light' };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    const preferDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return { ...DEFAULT_SETTINGS, theme: preferDark ? 'dark' : 'light', ...stored };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function App() {
  const [board, dispatch] = useReducer(reducer, undefined, load);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [anchor, setAnchor] = useState(() => startOfWeek(todayKey()));
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
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

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  /* ---------- derived ---------- */

  const days = useMemo(() => weekKeys(anchor, settings.includeWeekend), [anchor, settings.includeWeekend]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    const found = new Set<string>();
    for (const card of Object.values(board.cards)) {
      const haystack = [
        card.title,
        summarise(card.description).excerpt,
        COLOUR_LABELS[card.colour],
        STATUS_LABELS[card.status],
      ]
        .join(' ')
        .toLowerCase();
      if (haystack.includes(needle)) found.add(card.id);
    }
    return found;
  }, [query, board.cards]);

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

  /* ---------- card actions ---------- */

  const patchCard = useCallback((id: string, patch: Partial<Card>) => dispatch({ type: 'update', id, patch }), []);
  const moveCard = useCallback((id: string, lane: LaneId) => dispatch({ type: 'move', id, lane }), []);

  const quickAdd = useCallback((lane: LaneId, title: string) => {
    const card = newCard(title);
    dispatch({ type: 'add', lane, card });
  }, []);

  const addAndOpen = useCallback((lane: LaneId) => {
    const card = newCard('');
    dispatch({ type: 'add', lane, card });
    setOpenId(card.id);
  }, []);

  const rollOver = useCallback(() => {
    if (overdue.count === 0) return;
    const plural = overdue.count === 1 ? 'card' : 'cards';
    if (!window.confirm(`Move ${overdue.count} unfinished ${plural} from past days to today?`)) return;
    snapshot();
    dispatch({ type: 'rollOver', from: overdue.lanes, to: todayKey() });
    setAnchor(startOfWeek(todayKey()));
  }, [overdue, snapshot]);

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
        setOpenId(null);
        return;
      }
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
        addAndOpen(days.includes(today) ? today : days[0]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addAndOpen, days, undo]);

  /* ---------- drag and drop ---------- */

  const sensors = useSensors(
    // A small threshold keeps a plain click on a card as "open", not "drag".
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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

  /** Cross-lane hops happen live, so the gap opens in the column you're over. */
  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const id = String(active.id);
    const from = laneOf(board, id);
    const to = laneFromOver(over);
    if (!from || !to || from === to) return;

    const targetIds = board.lanes[to] ?? [];
    let index = targetIds.length;
    const overData = over.data.current as { type?: string } | undefined;
    if (overData?.type === 'card') {
      const overIndex = targetIds.indexOf(String(over.id));
      const dragged = active.rect.current.translated;
      const below = dragged ? dragged.top > over.rect.top + over.rect.height / 2 : false;
      index = overIndex >= 0 ? overIndex + (below ? 1 : 0) : targetIds.length;
    }
    dispatch({ type: 'move', id, lane: to, index });
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

    const targetIds = board.lanes[to] ?? [];
    let index = targetIds.length;
    const overData = over.data.current as { type?: string } | undefined;
    if (overData?.type === 'card') {
      const overIndex = targetIds.indexOf(String(over.id));
      if (overIndex >= 0) index = overIndex;
    }
    const action: Action = { type: 'move', id, lane: to, index };
    const settled = reducer(board, action);
    if (before && !sameArrangement(before, settled)) setPast((stack) => [...stack, before].slice(-HISTORY_LIMIT));
    if (settled !== board) dispatch(action);
  };

  /* ---------- render ---------- */

  return (
    <div className={openCard ? 'app has-drawer' : 'app'}>
      <TopBar
        weekKeys={days}
        onShiftWeek={(weeks) => setAnchor((current) => addDays(current, weeks * 7))}
        onToday={() => setAnchor(startOfWeek(todayKey()))}
        query={query}
        onQuery={setQuery}
        settings={settings}
        onSettings={(patch) => setSettings((current) => ({ ...current, ...patch }))}
        overdueCount={overdue.count}
        onRollOver={rollOver}
        canUndo={past.length > 0}
        onUndo={undo}
        onExport={exportBoard}
        onImport={importBoard}
        searchRef={searchRef}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => endDrag(true)}
      >
        <main className="board">
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
            />
          ))}
        </main>

        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {activeCard ? <CardFace card={activeCard} dragging /> : null}
        </DragOverlay>
      </DndContext>

      {openCard && (
        <CardDrawer
          key={openCard.id}
          card={openCard}
          lane={openLane}
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

    </div>
  );
}
