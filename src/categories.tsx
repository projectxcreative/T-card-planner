import { createContext, useContext, useLayoutEffect } from 'react';
import { forDarkTheme, inkOn } from './colour';
import { CATEGORY_IDS, defaultCategories, type Categories } from './types';

/** The card face is several components deep and re-renders on every drag, so
 *  the colour code travels by context rather than down five prop lists. */
const CategoriesContext = createContext<Categories>(defaultCategories());

export const CategoriesProvider = CategoriesContext.Provider;

export function useCategories(): Categories {
  return useContext(CategoriesContext);
}

const STYLE_ID = 'category-colours';

/** Each category becomes three custom properties: the strip, its dark-theme
 *  twin, and the ink that reads on top of whichever is showing. */
export function categoryCss(categories: Categories): string {
  const rules = (theme: 'light' | 'dark') =>
    CATEGORY_IDS.map((id) => {
      const chosen = categories[id].colour;
      const colour = theme === 'dark' ? forDarkTheme(chosen) : chosen;
      return `  --c-${id}: ${colour};\n  --c-${id}-ink: ${inkOn(colour)};`;
    }).join('\n');

  return `:root {\n${rules('light')}\n}\n\n:root[data-theme='dark'] {\n${rules('dark')}\n}\n`;
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
