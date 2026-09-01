import { useEffect, useRef, useState } from 'react';
import {
  CATEGORY_IDS,
  CLIENT_NAME_MAX,
  DEFAULT_CATEGORIES,
  LABEL_MAX,
  categoryLabel,
  type Categories,
  type Category,
  type CategoryId,
  type Client,
  type Settings,
} from '../types';
import { hasBuiltInApp, redirectUri, type M365 } from '../m365';

interface Props {
  categories: Categories;
  /** How many cards currently carry each category, so renaming one isn't blind. */
  counts: Record<CategoryId, number>;
  onCategory: (id: CategoryId, patch: Partial<Category>) => void;
  onResetCategories: () => void;
  clients: Client[];
  /** How many cards and projects wear each client tag. */
  clientCounts: Record<string, number>;
  onAddClient: (name: string) => void;
  onClient: (id: string, patch: Partial<Client>) => void;
  onDeleteClient: (id: string) => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  m365: M365;
  onExport: () => void;
  onImport: (file: File) => void;
  onClose: () => void;
}

export default function SettingsDialog(props: Props) {
  const {
    categories, counts, onCategory, onResetCategories,
    clients, clientCounts, onAddClient, onClient, onDeleteClient,
    settings, onSettings, m365, onExport, onImport, onClose,
  } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [newClient, setNewClient] = useState('');

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const addClient = () => {
    const name = newClient.trim();
    if (!name) return;
    onAddClient(name.slice(0, CLIENT_NAME_MAX));
    setNewClient('');
  };

  return (
    <div
      className="modal-backdrop"
      // A click that starts inside and drifts out shouldn't close the dialog,
      // which is why this is on the backdrop's own target rather than on click.
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
          <button ref={closeRef} type="button" className="ghost" onClick={onClose} title="Close (Esc)" aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modal-body">
          <section className="settings-section">
            <div className="settings-head">
              <h3 className="settings-title">Categories</h3>
              <button
                type="button"
                className="ghost"
                onClick={onResetCategories}
                title="Put every label and colour back to how it started"
              >
                Reset all
              </button>
            </div>
            <p className="settings-note">
              Eight of them, one per colour. Rename or recolour as you like — cards keep the category you
              gave them, so a rename reaches every card at once.
            </p>

            <ul className="cat-list">
              {CATEGORY_IDS.map((id) => {
                const category = categories[id];
                const used = counts[id] ?? 0;
                return (
                  <li key={id} className={`cat-row c-${id}`}>
                    <input
                      type="color"
                      className="cat-colour"
                      value={category.colour}
                      aria-label={`Colour for ${category.label || DEFAULT_CATEGORIES[id].label}`}
                      onChange={(event) => onCategory(id, { colour: event.target.value })}
                    />
                    <input
                      type="text"
                      className="cat-label"
                      value={category.label}
                      maxLength={LABEL_MAX}
                      placeholder={DEFAULT_CATEGORIES[id].label}
                      aria-label={`Name for the ${DEFAULT_CATEGORIES[id].label} category`}
                      onChange={(event) => onCategory(id, { label: event.target.value.slice(0, LABEL_MAX) })}
                      onBlur={(event) => {
                        // An empty box would leave a nameless strip on the board.
                        if (!event.target.value.trim()) onCategory(id, { label: DEFAULT_CATEGORIES[id].label });
                      }}
                    />
                    <span className="cat-count" title={`${used} card${used === 1 ? '' : 's'} in this category`}>
                      {used}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="settings-section">
            <h3 className="settings-title">Clients</h3>
            <p className="settings-note">
              Client tags say who the work is for. A card or a project can wear several, and they're separate
              from categories — the category is what kind of work it is, the client is who it's for.
            </p>

            <ul className="cat-list">
              {clients.map((client) => {
                const used = clientCounts[client.id] ?? 0;
                return (
                  <li key={client.id} className="cat-row" style={{ '--c': client.colour } as React.CSSProperties}>
                    <input
                      type="color"
                      className="cat-colour"
                      value={client.colour}
                      aria-label={`Colour for ${client.name}`}
                      onChange={(event) => onClient(client.id, { colour: event.target.value })}
                    />
                    <input
                      type="text"
                      className="cat-label"
                      value={client.name}
                      maxLength={CLIENT_NAME_MAX}
                      aria-label={`Name for ${client.name}`}
                      onChange={(event) => onClient(client.id, { name: event.target.value.slice(0, CLIENT_NAME_MAX) })}
                      onBlur={(event) => {
                        if (!event.target.value.trim()) onClient(client.id, { name: client.name || 'Client' });
                      }}
                    />
                    <span className="cat-count" title={`${used} card${used === 1 ? '' : 's'} and projects tagged`}>
                      {used}
                    </span>
                    <button
                      type="button"
                      className="ghost danger cat-remove"
                      title={`Remove ${client.name}`}
                      aria-label={`Remove ${client.name}`}
                      onClick={() => {
                        const warning = used > 0 ? ` It is on ${used} card${used === 1 ? '' : 's'} and project${used === 1 ? '' : 's'}.` : '';
                        if (window.confirm(`Remove the client “${client.name}”?${warning}`)) onDeleteClient(client.id);
                      }}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
              {clients.length === 0 && <li className="settings-note">No clients yet.</li>}
            </ul>

            <div className="settings-actions">
              <input
                className="cat-label"
                value={newClient}
                maxLength={CLIENT_NAME_MAX}
                placeholder="Add a client"
                aria-label="New client name"
                onChange={(event) => setNewClient(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addClient();
                  }
                }}
              />
              <button type="button" className="ghost" onClick={addClient} disabled={!newClient.trim()}>
                Add
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-title">Cards</h3>

            <label className="settings-row">
              <span>
                Default category
                <span className="settings-hint">What a new card starts as</span>
              </span>
              <span className={`picker c-${settings.defaultCategory} settings-picker`}>
                <span className="picker-dot" aria-hidden="true" />
                <select
                  className="picker-select"
                  value={settings.defaultCategory}
                  onChange={(event) => onSettings({ defaultCategory: event.target.value as CategoryId })}
                >
                  {CATEGORY_IDS.map((id) => (
                    <option key={id} value={id}>
                      {categoryLabel(categories, id)}
                    </option>
                  ))}
                </select>
              </span>
            </label>

            <label className="settings-row">
              <span>
                Show descriptions on cards
                <span className="settings-hint">The two-line excerpt under the title</span>
              </span>
              <input
                type="checkbox"
                checked={settings.showDescription}
                onChange={(event) => onSettings({ showDescription: event.target.checked })}
              />
            </label>

            <label className="settings-row">
              <span>
                Open a card in
                <span className="settings-hint">Beside the board, or over it</span>
              </span>
              <select
                value={settings.cardSurface}
                onChange={(event) => onSettings({ cardSurface: event.target.value as Settings['cardSurface'] })}
              >
                <option value="drawer">A sidebar</option>
                <option value="modal">A window</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <h3 className="settings-title">The week</h3>

            <label className="settings-row">
              <span>
                Show the weekend
                <span className="settings-hint">Saturday and Sunday columns</span>
              </span>
              <input
                type="checkbox"
                checked={settings.includeWeekend}
                onChange={(event) => onSettings({ includeWeekend: event.target.checked })}
              />
            </label>

            <label className="settings-row">
              <span>
                Hours in a day
                <span className="settings-hint">A day's bar turns red past this</span>
              </span>
              <input
                type="number"
                className="settings-number"
                min={1}
                max={24}
                step={1}
                value={settings.capacity}
                onChange={(event) => onSettings({ capacity: Math.min(24, Math.max(1, Number(event.target.value) || 1)) })}
              />
            </label>

            <label className="settings-row">
              <span>
                Day view starts at
                <span className="settings-hint">The first hour on the timeline</span>
              </span>
              <input
                type="number"
                className="settings-number"
                min={0}
                max={23}
                step={1}
                value={settings.dayStart}
                onChange={(event) => {
                  const hour = Math.min(23, Math.max(0, Number(event.target.value) || 0));
                  onSettings({ dayStart: hour, dayEnd: Math.max(settings.dayEnd, hour + 1) });
                }}
              />
            </label>

            <label className="settings-row">
              <span>
                …and ends at
                <span className="settings-hint">The last hour on the timeline</span>
              </span>
              <input
                type="number"
                className="settings-number"
                min={1}
                max={24}
                step={1}
                value={settings.dayEnd}
                onChange={(event) => {
                  const hour = Math.min(24, Math.max(1, Number(event.target.value) || 1));
                  onSettings({ dayEnd: hour, dayStart: Math.min(settings.dayStart, hour - 1) });
                }}
              />
            </label>

            <label className="settings-row">
              <span>
                Dark theme
                <span className="settings-hint">Also on the toolbar</span>
              </span>
              <input
                type="checkbox"
                checked={settings.theme === 'dark'}
                onChange={(event) => onSettings({ theme: event.target.checked ? 'dark' : 'light' })}
              />
            </label>
          </section>

          <section className="settings-section">
            <h3 className="settings-title">Microsoft 365 calendar</h3>
            <p className="settings-note">
              Reads your Outlook calendar into the day and month views, and writes an entry for any card you tick
              “publish” on.{' '}
              {hasBuiltInApp
                ? 'Connect and Microsoft will ask you to sign in and approve the two permissions it needs — reading your profile, and reading and writing your calendar.'
                : 'This build ships without an app registration, so you will need to point it at one of your own below.'}
            </p>

            <div className="settings-row">
              <span>
                {m365.status === 'connected' ? 'Connected' : 'Not connected'}
                <span className="settings-hint">
                  {m365.status === 'connected'
                    ? m365.account || 'Signed in'
                    : m365.status === 'unconfigured'
                      ? 'Add a client ID below first'
                      : 'Sign in with your Microsoft account'}
                </span>
              </span>
              {m365.status === 'connected' ? (
                <button type="button" className="ghost" onClick={m365.disconnect}>
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  className="ghost accent"
                  disabled={m365.status === 'unconfigured' || m365.status === 'connecting'}
                  onClick={m365.connect}
                >
                  {m365.status === 'connecting' ? 'Connecting…' : 'Connect Microsoft 365'}
                </button>
              )}
            </div>

            {m365.error && <p className="settings-note is-error">{m365.error}</p>}

            {/* Only worth opening if you are hosting this yourself, or your
                tenant will not have the shipped app. Open by default when there
                is nothing shipped, because then it is the only way through. */}
            <details className="settings-more" open={!hasBuiltInApp}>
              <summary>Use your own app registration</summary>
              <p className="settings-note">
                An Entra ID app registration, registered as a <strong>single-page application</strong> with{' '}
                <code>{redirectUri()}</code> as a redirect URI, and delegated Microsoft Graph permissions{' '}
                <code>Calendars.ReadWrite</code> and <code>User.Read</code>. Leave the client ID blank to go back to
                the one this build ships with.
              </p>

              <label className="settings-row">
                <span>
                  Client ID
                  <span className="settings-hint">From the app registration's overview</span>
                </span>
                <input
                  type="text"
                  className="cat-label settings-wide"
                  value={settings.m365.clientId}
                  placeholder={hasBuiltInApp ? 'Using the built-in one' : '00000000-0000-0000-0000-000000000000'}
                  spellCheck={false}
                  onChange={(event) => onSettings({ m365: { ...settings.m365, clientId: event.target.value.trim() } })}
                />
              </label>

              <label className="settings-row">
                <span>
                  Tenant
                  <span className="settings-hint">Your tenant id or domain, or “common”</span>
                </span>
                <input
                  type="text"
                  className="cat-label settings-wide"
                  value={settings.m365.tenant}
                  placeholder="common"
                  spellCheck={false}
                  onChange={(event) => onSettings({ m365: { ...settings.m365, tenant: event.target.value.trim() } })}
                />
              </label>
            </details>
          </section>

          <section className="settings-section">
            <h3 className="settings-title">Backup</h3>
            <p className="settings-note">
              A JSON file of the whole board — cards, days, categories, projects and clients. Importing replaces
              what's here.
            </p>
            <div className="settings-actions">
              <button type="button" className="ghost" onClick={onExport}>
                Export a backup
              </button>
              <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
                Import a backup
              </button>
            </div>
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
          </section>
        </div>
      </section>
    </div>
  );
}
