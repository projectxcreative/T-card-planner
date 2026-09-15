import { createContext, useContext, useLayoutEffect } from 'react';
import { forDarkTheme, inkOn } from './colour';
import { defaultCategories, type Categories } from './types';

/** The card face is several components deep and re-renders on every drag, so
 *  the colour code travels by context rather than down five prop lists. */
const CategoriesContext = createContext<Categories>(defaultCategories());

export const CategoriesProvider = CategoriesContext.Provider;

export function useCategories(): Categories {
  return useContext(CategoriesContext);
}

const STYLE_ID = 'category-colours';

/** Each category becomes three custom properties: the strip, its dark-theme
 *  twin, and the ink that reads on top of whichever is showing.
 *
 *  Categories used to be a fixed eight, each with its own `.c-slate` rule
 *  written into the stylesheet by hand. Now that a board can add or remove
 *  its own, that mapping — `.c-<id> { --c: var(--c-<id>); ... }` — is written
 *  here instead, once per id that actually exists, so a class the rest of the
 *  app reaches for by the card's own colour id always has something to read. */
export function categoryCss(categories: Categories): string {
  const ids = Object.keys(categories);
  const rules = (theme: 'light' | 'dark') =>
    ids
      .map((id) => {
        const chosen = categories[id].colour;
        const colour = theme === 'dark' ? forDarkTheme(chosen) : chosen;
        return `  --c-${id}: ${colour};\n  --c-${id}-ink: ${inkOn(colour)};`;
      })
      .join('\n');

  const classes = ids.map((id) => `.c-${id} { --c: var(--c-${id}); --c-ink: var(--c-${id}-ink); }`).join('\n');

  return `:root {\n${rules('light')}\n}\n\n:root[data-theme='dark'] {\n${rules('dark')}\n}\n\n${classes}\n`;
}

/** Writes the category colours into the document as one stylesheet, so the
 *  rest of the CSS can go on naming `--c-blue` without knowing who set it.
 *
 *  Before the paint rather than after it: these are the only place the strip
 *  colours come from, and a frame of colourless cards is worth avoiding. */
export function useCategoryColours(categories: Categories): void {
  useLayoutEffect(() => {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = categoryCss(categories);
  }, [categories]);
}
