import { useEffect, useRef } from 'react';
import {
  CATEGORY_IDS,
  DEFAULT_CATEGORIES,
  LABEL_MAX,
  type Categories,
  type Category,
  type CategoryId,
  type Settings,
} from '../types';

interface Props {
  categories: Categories;
  /** How many cards currently carry each category, so renaming one isn't blind. */
  counts: Record<CategoryId, number>;
  onCategory: (id: CategoryId, patch: Partial<Category>) => void;
  onResetCategories: () => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onClose: () => void;
}

export default function SettingsDialog(props: Props) {
  const { categories, counts, onCategory, onResetCategories, settings, onSettings, onExport, onImport, onClose } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

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
            <h3 className="settings-title">Backup</h3>
            <p className="settings-note">
              A JSON file of the whole board — cards, days and categories. Importing replaces what's here.
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
