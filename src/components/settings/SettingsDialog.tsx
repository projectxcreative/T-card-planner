import { useEffect, useRef, useState } from 'react';
import type { CalendarFeed } from '../../feed';
import type { M365 } from '../../m365';
import type { Sync } from '../../sync';
import CategoriesTab from './CategoriesTab';
import ClientsTab from './ClientsTab';
import CardsTab from './CardsTab';
import CalendarTab from './CalendarTab';
import BackupTab from './BackupTab';
import TeamTab from './TeamTab';

export const SETTINGS_TABS = [
  { id: 'team', label: 'Team & boards' },
  { id: 'categories', label: 'Categories' },
  { id: 'clients', label: 'Clients' },
  { id: 'cards', label: 'Cards & updates' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'backup', label: 'Backup' },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

export interface SettingsDialogProps {
  sync: Sync;
  m365: M365;
  feed: CalendarFeed;
  onClose: () => void;
  initialTab?: SettingsTabId;
}

export default function SettingsDialog({
  sync,
  m365,
  feed,
  onClose,
  initialTab = 'team',
}: SettingsDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<SettingsTabId>(initialTab);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="modal-head">
          <h2 id="settings-title" className="modal-title">
            Settings
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="ghost"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="settings-tabbar">
          <div className="viewtabs" role="tablist" aria-label="Settings section">
            {SETTINGS_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'viewtab is-on' : 'viewtab'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-body">
          {tab === 'team' && <TeamTab sync={sync} />}
          {tab === 'categories' && <CategoriesTab />}
          {tab === 'clients' && <ClientsTab />}
          {tab === 'cards' && <CardsTab />}
          {tab === 'calendar' && <CalendarTab m365={m365} feed={feed} />}
          {tab === 'backup' && <BackupTab />}
        </div>
      </section>
    </div>
  );
}
