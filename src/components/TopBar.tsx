import { formatWeekRange } from '../dates';
import SyncBadge from './SyncBadge';
import type { Settings } from '../types';
import type { Sync } from '../sync';

interface Props {
  weekKeys: string[];
  onShiftWeek: (weeks: number) => void;
  onToday: () => void;
  query: string;
  onQuery: (value: string) => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onOpenSettings: () => void;
  overdueCount: number;
  onRollOver: () => void;
  canUndo: boolean;
  onUndo: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  sync: Sync;
}

export default function TopBar(props: Props) {
  const { weekKeys, onShiftWeek, onToday, query, onQuery, settings, onSettings, onOpenSettings, overdueCount, onRollOver, canUndo, onUndo, searchRef, sync } = props;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">T-Card Planner</span>
      </div>

      <div className="weeknav">
        <button type="button" className="ghost" onClick={() => onShiftWeek(-1)} aria-label="Previous week" title="Previous week">
          ‹
        </button>
        <button type="button" className="ghost" onClick={onToday} title="Jump to this week">
          Today
        </button>
        <button type="button" className="ghost" onClick={() => onShiftWeek(1)} aria-label="Next week" title="Next week">
          ›
        </button>
        <span className="weekrange">{formatWeekRange(weekKeys)}</span>
      </div>

      <div className="topbar-tools">
        <button
          type="button"
          className="ghost"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo the last move, delete or roll-over  (⌘Z)"
        >
          ↶ Undo
        </button>

        {overdueCount > 0 && (
          <button type="button" className="ghost accent" onClick={onRollOver} title="Move unfinished cards from past days to today">
            Roll over {overdueCount}
          </button>
        )}

        <input
          ref={searchRef}
          type="search"
          className="search"
          value={query}
          placeholder="Search cards  (/)"
          aria-label="Search cards"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onQuery('');
          }}
        />

        {/* The theme is a one-click thing you flip with the light in the room;
            everything else that used to sit here lives in Settings now. */}
        <button
          type="button"
          className="ghost"
          onClick={() => onSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
          title="Switch theme"
          aria-label="Switch theme"
        >
          {settings.theme === 'dark' ? '☀' : '☾'}
        </button>

        <button
          type="button"
          className="ghost"
          onClick={onOpenSettings}
          title="Categories, the week, backups"
          aria-label="Settings"
        >
          ⚙
        </button>

        <SyncBadge sync={sync} />
      </div>
    </header>
  );
}
