/**
 * Keeping a running app on the latest build.
 *
 * The service worker serves the app out of its own cache, which is what lets
 * the board open with no signal — and it also means a running app keeps
 * whatever build it started with until something replaces it. A browser only
 * looks for a new service worker when it navigates, so on a laptop this sorts
 * itself out by accident: tabs get closed and opened again. An app added to a
 * phone's home screen is never closed, only switched away from, and left to
 * itself will sit on a months-old build indefinitely — which is the device you
 * least want to be behind, because it's the one you check between other things.
 *
 * So the app looks for a new build itself: on a timer while it's open, and
 * every time it comes back to the foreground. One that's ready is taken while
 * the app is out of sight, or when you ask for it — never underneath you
 * mid-sentence, since a reload costs whatever card you were in the middle of.
 */

import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

/** How often an app left open goes looking. Deploys are not that frequent. */
const CHECK_MS = 30 * 60_000;

/** A new build is installed and waiting for the page to let it take over. */
let waiting = false;
/** Hands the page to the waiting build, which reloads onto it. */
let takeIt = () => {};
const listeners = new Set<(ready: boolean) => void>();

function announce() {
  for (const listener of listeners) listener(waiting);
}

function watch(registration: ServiceWorkerRegistration) {
  const look = () => {
    // Nothing to ask with no signal, and nothing worth asking about while the
    // app is in someone's pocket.
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    void registration.update().catch(() => {
      // Offline, or an Access session that has lapsed and sent the request to
      // a login page instead. Either way there is nothing to do but ask again.
    });
  };

  setInterval(look, CHECK_MS);
  // Coming back to a home-screen app is a resume, not a page load, so these are
  // what notice a deploy on a phone — the browser's own check never runs.
  window.addEventListener('pageshow', look);
  window.addEventListener('online', look);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') look();
    // Leaving is the free moment to swap builds: the reload happens to a page
    // nobody is looking at, and the next glance is already the new one.
    else if (waiting) takeIt();
  });
}

/** Registering at import time rather than on mount: the app should be looking
 *  for a new build whether or not anything has asked to be told about one. */
if (typeof window !== 'undefined') {
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true;
      announce();
      if (document.visibilityState === 'hidden') takeIt();
    },
    onRegisteredSW(_url, registration) {
      if (registration) watch(registration);
    },
  });
  takeIt = () => void update();
}

export interface AppUpdate {
  /** A newer build is ready, and is being held back until it's convenient. */
  ready: boolean;
  /** Reload onto it now. */
  apply: () => void;
}

export function useAppUpdate(): AppUpdate {
  const [ready, setReady] = useState(waiting);

  useEffect(() => {
    // One may have arrived between the first render and this running.
    setReady(waiting);
    listeners.add(setReady);
    return () => {
      listeners.delete(setReady);
    };
  }, []);

  return { ready, apply: () => takeIt() };
}
