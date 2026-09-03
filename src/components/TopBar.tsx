import SyncBadge from './SyncBadge';
import ClientFilter from './ClientFilter';
import { VIEWS, VIEW_LABELS, type Client, type Settings, type ViewMode } from '../types';
import type { Sync } from '../sync';
import type { AppUpdate } from '../updates';

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
  canUndo: boolean;
  onUndo: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  clients: Client[];
  clientFilter: string[];
  onClientFilter: (ids: string[]) => void;
  sync: Sync;
  update: AppUpdate;
}

export default function TopBar(props: Props) {
  const { view, onView, rangeLabel, onShift, onToday, query, onQuery, settings, onSettings, onOpenSettings, canUndo, onUndo, searchRef, clients, clientFilter, onClientFilter, sync, update } = props;

  // Projects and clients aren't stretches of time, so there is nothing for the
  // arrows to step over while they're on screen.
  const dated = view !== 'projects' && view !== 'clients';
  // Nor is there a board to narrow while one of them is up.
  const filterable = dated;
  // Only the week and the month draw columns the weekend could be one of.
  const showsWeekend = view === 'week' || view === 'month';
  // Only the week draws card faces, so it is the only view the excerpt is on.
  const showsCards = view === 'week';
  const stepName = view === 'day' ? 'day' : view === 'month' ? 'month' : 'week';

  return (
    <header className="topbar">
     <div className="topbar-inner">
      <div className="brand">
        <img className="brand-mark" src="/logo.svg" alt="" width={20} height={20} />
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

          {showsWeekend && (
            <button
              type="button"
              className={settings.includeWeekend ? 'ghost accent toggle is-on' : 'ghost toggle'}
              aria-pressed={settings.includeWeekend}
              onClick={() => onSettings({ includeWeekend: !settings.includeWeekend })}
              title={settings.includeWeekend ? 'Hide Saturday and Sunday' : 'Show Saturday and Sunday'}
            >
              <span className="toggle-box" aria-hidden="true" />
              Weekends
            </button>
          )}

          {/* The same switch as the one in Settings, put where you actually
              want it: beside the board it makes taller or shorter. */}
          {showsCards && (
            <button
              type="button"
              className={settings.showDescription ? 'ghost accent toggle is-on' : 'ghost toggle'}
              aria-pressed={settings.showDescription}
              onClick={() => onSettings({ showDescription: !settings.showDescription })}
              title={settings.showDescription ? 'Hide the excerpt under each card title' : 'Show the excerpt under each card title'}
            >
              <span className="toggle-box" aria-hidden="true" />
              Details
            </button>
          )}
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

        {/* Only while one is actually held back. Taking it is a reload, so it
            is offered rather than done to you — though leaving the app for
            anything else takes it too, which is how a phone gets it. */}
        {update.ready && (
          <button
            type="button"
            className="ghost accent update"
            onClick={update.apply}
            title="A newer version of the planner is ready. Reload onto it."
          >
            ↻ <span className="update-label">Update</span>
          </button>
        )}

        <SyncBadge sync={sync} />
      </div>
     </div>
    </header>
  );
}
