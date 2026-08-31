import { useRef } from 'react';
import { formatWeekRange } from '../dates';

export interface Settings {
  includeWeekend: boolean;
  capacity: number;
  theme: 'light' | 'dark';
}

interface Props {
  weekKeys: string[];
  onShiftWeek: (weeks: number) => void;
  onToday: () => void;
  query: string;
  onQuery: (value: string) => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  overdueCount: number;
  onRollOver: () => void;
  canUndo: boolean;
  onUndo: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

export default function TopBar(props: Props) {
  const { weekKeys, onShiftWeek, onToday, query, onQuery, settings, onSettings, overdueCount, onRollOver, canUndo, onUndo, onExport, onImport, searchRef } = props;
  const fileRef = useRef<HTMLInputElement>(null);

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

        <label className="toggle" title="Show Saturday and Sunday">
          <input
            type="checkbox"
            checked={settings.includeWeekend}
            onChange={(event) => onSettings({ includeWeekend: event.target.checked })}
          />
          <span>Weekend</span>
        </label>

        <label className="capacity" title="Hours you plan to fill in a day">
          <input
            type="number"
            min={1}
            max={24}
            step={1}
            value={settings.capacity}
            onChange={(event) => onSettings({ capacity: Math.min(24, Math.max(1, Number(event.target.value) || 1)) })}
          />
          <span>h/day</span>
        </label>

        <button
          type="button"
          className="ghost"
          onClick={() => onSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
          title="Switch theme"
          aria-label="Switch theme"
        >
          {settings.theme === 'dark' ? '☀' : '☾'}
        </button>

        <button type="button" className="ghost" onClick={onExport} title="Download a JSON backup">
          Export
        </button>
        <button type="button" className="ghost" onClick={() => fileRef.current?.click()} title="Replace the board from a JSON backup">
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.target.value = '';
          }}
        />
      </div>
    </header>
  );
}
