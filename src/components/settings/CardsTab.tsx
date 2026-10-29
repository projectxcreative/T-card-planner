import { categoryLabel, type CategoryId, type Settings } from '../../types';
import { useBoard } from '../../store/boardStore';
import { useSettings, useSettingsActions } from '../../store/settingsStore';
import UpdateCategoriesTab from './UpdateCategoriesTab';

export default function CardsTab() {
  const settings = useSettings();
  const { updateSettings } = useSettingsActions();
  const categories = useBoard((b) => b.categories);
  const categoryOrder = useBoard((b) => b.categoryOrder);

  const defaultCategory = categories[settings.defaultCategory]
    ? settings.defaultCategory
    : categoryOrder[0] ?? 'slate';

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-title">Cards</h3>

        <label className="settings-row">
          <span>
            Default category
            <span className="settings-hint">What a new card starts as</span>
          </span>
          <span className={`picker c-${defaultCategory} settings-picker`}>
            <span className="picker-dot" aria-hidden="true" />
            <select
              className="picker-select"
              value={defaultCategory}
              onChange={(event) => updateSettings({ defaultCategory: event.target.value as CategoryId })}
            >
              {categoryOrder.map((id) => (
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
            onChange={(event) => updateSettings({ showDescription: event.target.checked })}
          />
        </label>

        <label className="settings-row">
          <span>
            Open a card in
            <span className="settings-hint">Beside the board, or over it</span>
          </span>
          <select
            value={settings.cardSurface}
            onChange={(event) => updateSettings({ cardSurface: event.target.value as Settings['cardSurface'] })}
          >
            <option value="drawer">A sidebar</option>
            <option value="modal">A window</option>
          </select>
        </label>
      </section>

      <section className="settings-section">
        <h3 className="settings-title">Appearance</h3>

        <label className="settings-row">
          <span>
            Dark theme
            <span className="settings-hint">Also on the toolbar</span>
          </span>
          <input
            type="checkbox"
            checked={settings.theme === 'dark'}
            onChange={(event) => updateSettings({ theme: event.target.checked ? 'dark' : 'light' })}
          />
        </label>

        <label className="settings-row">
          <span>
            Skin
            <span className="settings-hint">Shape and type, independent of light and dark</span>
          </span>
          <select
            value={settings.skin}
            onChange={(event) => updateSettings({ skin: event.target.value as Settings['skin'] })}
          >
            <option value="default">Default</option>
            <option value="draft">Draft</option>
          </select>
        </label>
      </section>

      <UpdateCategoriesTab />
    </>
  );
}
