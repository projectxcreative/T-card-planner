import SyncBadge from './SyncBadge';
import ClientFilter from './ClientFilter';
import { VIEWS, VIEW_LABELS, type Client, type Settings, type ViewMode } from '../types';
import type { Sync } from '../sync';

interface Props {
  view: ViewMode;
  onView: (view: ViewMode) => void;
  /** What the arrows are stepping over: a week, a day, a month. */
  rangeLabel: string;
  onShift: (steps: number) => void;
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
  clients: Client[];
  clientFilter: string[];
  onClientFilter: (ids: string[]) => void;
  sync: Sync;
}

export default function TopBar(props: Props) {
  const { view, onView, rangeLabel, onShift, onToday, query, onQuery, settings, onSettings, onOpenSettings, overdueCount, onRollOver, canUndo, onUndo, searchRef, clients, clientFilter, onClientFilter, sync } = props;

  // Projects and clients aren't stretches of time, so there is nothing for the
  // arrows to step over while they're on screen.
  const dated = view !== 'projects' && view !== 'clients';
  // Nor is there a board to narrow while one of them is up.
  const filterable = dated;
  const stepName = view === 'day' ? 'day' : view === 'month' ? 'month' : 'week';

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">T-Card Planner</span>
      </div>

      <div className="viewtabs" role="tablist" aria-label="View">
        {VIEWS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={view === option}
            className={view === option ? 'viewtab is-on' : 'viewtab'}
            onClick={() => onView(option)}
          >
            {VIEW_LABELS[option]}
          </button>
        ))}
      </div>

      {dated && (
        <div className="weeknav">
          <button type="button" className="ghost" onClick={() => onShift(-1)} aria-label={`Previous ${stepName}`} title={`Previous ${stepName}`}>
            ‹
          </button>
          <button type="button" className="ghost" onClick={onToday} title={`Jump to this ${stepName}`}>
            Today
          </button>
          <button type="button" className="ghost" onClick={() => onShift(1)} aria-label={`Next ${stepName}`} title={`Next ${stepName}`}>
            ›
          </button>
          <span className="weekrange">{rangeLabel}</span>
        </div>
      )}

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

        {filterable && <ClientFilter clients={clients} value={clientFilter} onChange={onClientFilter} />}

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
          title="Categories, clients, the week, backups"
          aria-label="Settings"
        >
          ⚙
        </button>

        <SyncBadge sync={sync} />
      </div>
    </header>
  );
}
