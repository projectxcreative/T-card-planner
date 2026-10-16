import { useEffect } from 'react';
import { todayKey } from '../dates';
import type { LaneId, ViewMode } from '../types';

interface KeyboardOptions {
  showSettings: boolean;
  onCloseSettings: () => void;
  onCloseCard: () => void;
  canUndo: boolean;
  onUndo: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  view: ViewMode;
  focus: string;
  days: string[];
  onAddAndOpen: (lane: LaneId) => void;
}

export function useKeyboardShortcuts({
  showSettings,
  onCloseSettings,
  onCloseCard,
  onUndo,
  searchRef,
  view,
  focus,
  days,
  onAddAndOpen,
}: KeyboardOptions) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (event.key === 'Escape') {
        if (typing) return;
        if (showSettings) onCloseSettings();
        else onCloseCard();
        return;
      }

      if (showSettings) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        onUndo();
        return;
      }

      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        const today = todayKey();
        if (view === 'day') onAddAndOpen(focus);
        else onAddAndOpen(days.includes(today) ? today : days[0]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [days, focus, onAddAndOpen, onCloseCard, onCloseSettings, onUndo, searchRef, showSettings, view]);
}
