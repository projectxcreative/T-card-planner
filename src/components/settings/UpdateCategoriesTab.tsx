import { useState } from 'react';
import { MIN_UPDATE_CATEGORIES, UPDATE_CATEGORY_LABEL_MAX } from '../../types';
import { useBoard, useBoardActions } from '../../store/boardStore';

export default function UpdateCategoriesTab() {
  const updateCategories = useBoard((b) => b.updateCategories);
  const updateCategoryOrder = useBoard((b) => b.updateCategoryOrder);
  const updateCounts = useBoard((b) => {
    const counts: Record<string, number> = {};
    for (const card of Object.values(b.cards)) {
      for (const update of card.updates) {
        counts[update.categoryId] = (counts[update.categoryId] ?? 0) + 1;
      }
    }
    return counts;
  });

  const {
    patchUpdateCategory,
    addUpdateCategory,
    deleteUpdateCategory,
    resetUpdateCategories,
  } = useBoardActions();
  const [newUpdateCategory, setNewUpdateCategory] = useState('');

  const handleAdd = () => {
    const label = newUpdateCategory.trim();
    if (!label) return;
    addUpdateCategory(label.slice(0, UPDATE_CATEGORY_LABEL_MAX));
    setNewUpdateCategory('');
  };

  return (
    <section className="settings-section">
      <div className="settings-head">
        <h3 className="settings-title">Update categories</h3>
        <button
          type="button"
          className="ghost"
          onClick={resetUpdateCategories}
          title="Put every built-in label and colour back to how it started"
        >
          Reset all
        </button>
      </div>
      <p className="settings-note">
        What an update on a card can be logged as — video editing, capture, travel, and so on. Separate
        from a card's own category: this is what was actually done, not what kind of card it's on.
      </p>

      <ul className="cat-list">
        {updateCategoryOrder.map((id) => {
          const category = updateCategories[id];
          if (!category) return null;
          const used = updateCounts[id] ?? 0;
          return (
            <li key={id} className="cat-row" style={{ '--c': category.colour } as React.CSSProperties}>
              <input
                type="color"
                className="cat-colour"
                value={category.colour}
                aria-label={`Colour for ${category.label}`}
                onChange={(event) => patchUpdateCategory(id, { colour: event.target.value })}
              />
              <input
                type="text"
                className="cat-label"
                value={category.label}
                maxLength={UPDATE_CATEGORY_LABEL_MAX}
                aria-label={`Name for ${category.label}`}
                onChange={(event) =>
                  patchUpdateCategory(id, {
                    label: event.target.value.slice(0, UPDATE_CATEGORY_LABEL_MAX),
                  })
                }
                onBlur={(event) => {
                  if (!event.target.value.trim()) patchUpdateCategory(id, { label: category.label || 'Category' });
                }}
              />
              <span className="cat-count" title={`${used} update${used === 1 ? '' : 's'} logged`}>
                {used}
              </span>
              <button
                type="button"
                className="ghost danger cat-remove"
                disabled={updateCategoryOrder.length <= MIN_UPDATE_CATEGORIES}
                title={
                  updateCategoryOrder.length <= MIN_UPDATE_CATEGORIES
                    ? 'There has to be at least one'
                    : `Remove ${category.label}`
                }
                aria-label={`Remove ${category.label}`}
                onClick={() => {
                  const warning =
                    used > 0
                      ? ` ${used} logged update${used === 1 ? '' : 's'} will move to whatever's first on the list.`
                      : '';
                  if (window.confirm(`Remove the update category “${category.label}”?${warning}`)) {
                    deleteUpdateCategory(id);
                  }
                }}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      <div className="settings-actions">
        <input
          className="cat-label"
          value={newUpdateCategory}
          maxLength={UPDATE_CATEGORY_LABEL_MAX}
          placeholder="Add an update category"
          aria-label="New update category name"
          onChange={(event) => setNewUpdateCategory(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleAdd();
            }
          }}
        />
        <button type="button" className="ghost" onClick={handleAdd} disabled={!newUpdateCategory.trim()}>
          Add
        </button>
      </div>
    </section>
  );
}
