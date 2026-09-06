import { createContext, useContext } from 'react';
import type { AccountUser } from './authClient';

export interface AccountContextValue {
  /** Null under legacy Access/token auth, or while offline with no Worker to ask. */
  user: AccountUser | null;
  /** Re-asks `/api/session` — call after anything that could change who's signed in. */
  refresh: () => void;
}

export const AccountContext = createContext<AccountContextValue>({ user: null, refresh: () => {} });

export const useAccount = () => useContext(AccountContext);
