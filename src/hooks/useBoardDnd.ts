import { useCallback, useRef, useState } from 'react';
import {
  KeyboardSensor,
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
import type { BoardState, Card, LaneId } from '../types';
import { laneOf, reducer, sameArrangement, type Action } from '../store';

const collisionDetection: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  if (byPointer.length > 0) return byPointer;
  const byRect = rectIntersection(args);
  return byRect.length > 0 ? byRect : closestCorners(args);
};

interface UseBoardDndOptions {
  board: BoardState;
  dispatch: (action: Action) => void;
  snapshot: () => void;
}

export function useBoardDnd({ board, dispatch, snapshot }: UseBoardDndOptions) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const beforeDrag = useRef<BoardState | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
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

  const endDrag = (revert: boolean) => {
    const before = beforeDrag.current;
    beforeDrag.current = null;
    setActiveId(null);
    if (revert && before && !sameArrangement(before, board)) {
      dispatch({ type: 'replace', state: before });
    }
    return before;
  };

  const onDragStart = (event: DragStartEvent) => {
    beforeDrag.current = board;
    setActiveId(String(event.active.id));
  };

  const indexFromOver = (over: Over, to: LaneId, below: boolean): number | undefined => {
    const data = over.data.current as { type?: string } | undefined;
    if (data?.type !== 'card') return undefined;
    const ids = board.lanes[to] ?? [];
    const at = ids.indexOf(String(over.id));
    return at >= 0 ? at + (below ? 1 : 0) : undefined;
  };

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

    if (!over || !to) {
      endDrag(true);
      return;
    }
    const before = endDrag(false);

    const action: Action = { type: 'move', id, lane: to, index: indexFromOver(over, to, false) };
    const settled = reducer(board, action);
    if (before && !sameArrangement(before, settled)) {
      snapshot();
    }
    if (settled !== board) {
      dispatch(action);
    }
  };

  const activeCard: Card | null = activeId ? board.cards[activeId] ?? null : null;

  return {
    sensors,
    collisionDetection,
    activeCard,
    activeId,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel: () => endDrag(true),
  };
}
