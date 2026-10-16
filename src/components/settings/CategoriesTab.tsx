import { useState } from 'react';
import {
  DEFAULT_CATEGORIES,
  LABEL_MAX,
  MIN_CATEGORIES,
} from '../../types';
import { useBoard, useBoardActions } from '../../store/boardStore';

export default function CategoriesTab() {
  const categories = useBoard((b) => b.categories);
  const categoryOrder = useBoard((b) => b.categoryOrder);
  const counts = useBoard((b) => {
    const c: Record<string, number> = {};
    for (const card of Object.values(b.cards)) c[card.colour] = (c[card.colour] ?? 0) + 1;
    return c;
  });

  const { patchCategory, addCategory, deleteCategory, resetCategories } = useBoardActions();
  const [newCategory, setNewCategory] = useState('');

  const handleAdd = () => {
    const label = newCategory.trim();
    if (!label) return;
    addCategory(label.slice(0, LABEL_MAX));
    setNewCategory('');
  };

  return (
    <section className="settings-section">
      <div className="settings-head">
        <h3 className="settings-title">Categories</h3>
        <button
          type="button"
          className="ghost"
          onClick={resetCategories}
          title="Put every built-in label and colour back to how it started"
        >
          Reset all
        </button>
      </div>
      <p className="settings-note">
        One per colour. Rename, recolour, add or remove them — cards keep the category id they were
        given, so a rename reaches every card at once, and removing one moves its cards to whatever's
        first on the list.
      </p>

      <ul className="cat-list">
        {categoryOrder.map((id) => {
          const category = categories[id];
          if (!category) return null;
          const used = counts[id] ?? 0;
          const fallback = DEFAULT_CATEGORIES[id]?.label ?? 'Category';
          return (
            <li key={id} className={`cat-row c-${id}`}>
              <input
                type="color"
                className="cat-colour"
                value={category.colour}
                aria-label={`Colour for ${category.label || fallback}`}
                onChange={(event) => patchCategory(id, { colour: event.target.value })}
              />
              <input
                type="text"
                className="cat-label"
                value={category.label}
                maxLength={LABEL_MAX}
                placeholder={fallback}
                aria-label={`Name for the ${fallback} category`}
                onChange={(event) => patchCategory(id, { label: event.target.value.slice(0, LABEL_MAX) })}
                onBlur={(event) => {
                  if (!event.target.value.trim()) patchCategory(id, { label: fallback });
                }}
              />
              <span className="cat-count" title={`${used} card${used === 1 ? '' : 's'} in this category`}>
                {used}
              </span>
              <button
                type="button"
                className="ghost danger cat-remove"
                disabled={categoryOrder.length <= MIN_CATEGORIES}
                title={
                  categoryOrder.length <= MIN_CATEGORIES
                    ? 'A board needs at least one category'
                    : `Remove ${category.label || fallback}`
                }
                aria-label={`Remove ${category.label || fallback}`}
                onClick={() => {
                  const warning =
                    used > 0
                      ? ` ${used} card${used === 1 ? '' : 's'} will move to whatever's first on the list.`
                      : '';
                  if (window.confirm(`Remove the category “${category.label || fallback}”?${warning}`)) {
                    deleteCategory(id);
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
          value={newCategory}
          maxLength={LABEL_MAX}
          placeholder="Add a category"
          aria-label="New category name"
          onChange={(event) => setNewCategory(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleAdd();
            }
          }}
        />
        <button type="button" className="ghost" onClick={handleAdd} disabled={!newCategory.trim()}>
          Add
        </button>
      </div>
    </section>
  );
}
