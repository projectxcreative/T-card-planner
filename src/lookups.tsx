import { createContext, useContext, useMemo } from 'react';
import type { Client, Project, UpdateCategories } from './types';

/** What a card face needs to know beyond its own fields: who the clients and
 *  projects it names actually are, and whether descriptions are being shown.
 *  Same reasoning as the category context next door — the card is several
 *  components deep and re-renders on every drag.
 *
 *  A card's own categories travel by their own context (`categories.tsx`),
 *  which predates this one; the order they're listed in, and the whole of
 *  the update-category list, ride along here instead since only the
 *  category picker and the panel's Updates section need them. */
export interface Lookups {
  clients: Record<string, Client>;
  projects: Record<string, Project>;
  clientOrder: string[];
  categoryOrder: string[];
  updateCategories: UpdateCategories;
  updateCategoryOrder: string[];
  showDescription: boolean;
}

const EMPTY: Lookups = {
  clients: {},
  projects: {},
  clientOrder: [],
  categoryOrder: [],
  updateCategories: {},
  updateCategoryOrder: [],
  showDescription: true,
};

const LookupsContext = createContext<Lookups>(EMPTY);

export const LookupsProvider = LookupsContext.Provider;

export function useLookups(): Lookups {
  return useContext(LookupsContext);
}

/** The clients on a card or project, in the order Settings lists them, with
 *  ids that no longer name anything quietly dropped. */
export function useClientList(ids: string[]): Client[] {
  const { clients, clientOrder } = useLookups();
  return useMemo(() => {
    const wanted = new Set(ids);
    return clientOrder.filter((id) => wanted.has(id)).map((id) => clients[id]).filter(Boolean);
  }, [clientOrder, clients, ids]);
}
