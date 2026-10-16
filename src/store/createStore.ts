import { useCallback, useRef, useSyncExternalStore } from 'react';

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a) as (keyof T)[];
  const keysB = Object.keys(b) as (keyof T)[];
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.is(a[key], b[key])) {
      return false;
    }
  }

  return true;
}

export interface StoreApi<T> {
  getState: () => T;
  setState: (partial: Partial<T> | ((prev: T) => Partial<T> | T)) => void;
  subscribe: (listener: () => void) => () => void;
  useStore: <Slice = T>(
    selector?: (state: T) => Slice,
    equalityFn?: (a: Slice, b: Slice) => boolean,
  ) => Slice;
}

export function createStore<T>(initialState: T): StoreApi<T> {
  let state = initialState;
  const listeners = new Set<() => void>();

  const getState = () => state;

  const setState = (partial: Partial<T> | ((prev: T) => Partial<T> | T)) => {
    const next = typeof partial === 'function' ? (partial as (prev: T) => Partial<T> | T)(state) : partial;
    if (next !== state) {
      state =
        typeof next === 'object' && next !== null && !Array.isArray(next)
          ? { ...state, ...next }
          : (next as T);
      listeners.forEach((listener) => listener());
    }
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  function useStore<Slice = T>(
    selector: (state: T) => Slice = (s) => s as unknown as Slice,
    equalityFn: (a: Slice, b: Slice) => boolean = Object.is,
  ): Slice {
    const currentSliceRef = useRef<Slice | undefined>(undefined);
    const selectorRef = useRef(selector);
    selectorRef.current = selector;
    const equalityFnRef = useRef(equalityFn);
    equalityFnRef.current = equalityFn;

    const getSnapshot = useCallback(() => {
      const nextSlice = selectorRef.current(state);
      if (currentSliceRef.current === undefined || !equalityFnRef.current(currentSliceRef.current, nextSlice)) {
        currentSliceRef.current = nextSlice;
      }
      return currentSliceRef.current;
    }, []);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }

  return { getState, setState, subscribe, useStore };
}
