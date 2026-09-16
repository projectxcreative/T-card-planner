/**
 * The board as a calendar other apps can subscribe to.
 *
 * The Microsoft 365 connection in `m365.ts` works the other way round: it signs
 * in as you and writes entries into Outlook, which means a browser sign-in that
 * has to be kept alive, and a browser sign-in is the thing that keeps expiring.
 * A feed inverts that. The Worker publishes the board at one unguessable
 * address; Outlook, Google Calendar, Apple Calendar or anything else fetches it
 * on their own schedule and shows it as an extra calendar beside your own.
 *
 * Nothing about it can expire, because there is nothing to sign in to — and for
 * the same reason nothing can write back, so the subscribed copy is read-only
 * wherever it lands. The link is the credential: anyone holding it can read the
 * board's cards, which is why replacing it has to be one button away.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from './sync';

export interface FeedOptions {
  /** What the calendar calls itself, before whatever you name it on subscribing. */
  name: string;
  /** The IANA zone the board's clock times mean. Set from the device that
   *  made the feed — the Worker has no way of knowing it otherwise. */
  timeZone: string;
  /** Every scheduled card, or only the ones ticked for the calendar. */
  scope: 'all' | 'published';
  includeDone: boolean;
  /** Minutes before the start to remind, or null for no reminder. */
  alarmMinutes: number | null;
  /** Days of finished weeks to keep in the feed; null for all of them. */
  pastDays: number | null;
}

export interface FeedState {
  enabled: boolean;
  /** The subscription link, or null when there is no feed. */
  url: string | null;
  createdAt: string | null;
  options: FeedOptions;
}

export const DEFAULT_FEED_OPTIONS: FeedOptions = {
  name: 'T-Card Planner',
  timeZone: 'UTC',
  scope: 'all',
  includeDone: true,
  alarmMinutes: null,
  pastDays: 90,
};

const NO_FEED: FeedState = { enabled: false, url: null, createdAt: null, options: DEFAULT_FEED_OPTIONS };

export const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** `https://…/calendar/x.ics` as the scheme a calendar app answers to. Handed
 *  alongside the plain link rather than instead of it: Outlook on the web wants
 *  pasting, and a desktop client would rather be launched. */
export function webcalOf(url: string): string {
  return url.replace(/^https?:\/\//i, 'webcal://');
}

export interface CalendarFeed {
  /** `unavailable` covers both halves of "there is nowhere to publish from":
   *  no login on this device, and a Worker too old to know the endpoint. */
  status: 'loading' | 'ready' | 'unavailable';
  feed: FeedState;
  busy: boolean;
  error: string | null;
  /** Make one, with this device's timezone. */
  create: () => void;
  /** Change what the feed contains. Takes effect on the next fetch. */
  update: (patch: Partial<FeedOptions>) => void;
  /** New link, old one dead. The only revocation a URL-shaped secret has. */
  rotate: () => void;
  remove: () => void;
}

/**
 * Reads and manages the feed on the Worker.
 *
 * `enabled` is whether this device can talk to the Worker at all. A board
 * running purely locally has no server to publish from, and saying so is more
 * use than a button that fails.
 */
export function useCalendarFeed(enabled: boolean): CalendarFeed {
  const [status, setStatus] = useState<CalendarFeed['status']>('loading');
  const [feed, setFeed] = useState<FeedState>(NO_FEED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const call = useCallback(
    async (init: RequestInit, quiet = false): Promise<boolean> => {
      if (!quiet) setBusy(true);
      try {
        const response = await fetch('/api/calendar', {
          ...init,
          headers: authHeaders(init.body ? { 'content-type': 'application/json' } : {}),
          cache: 'no-store',
        });
        // An older Worker, or one the Access session has stopped letting
        // through: either way there is no feed to show and nothing to press.
        if (response.status === 404 || response.redirected) {
          if (live.current) setStatus('unavailable');
          return false;
        }
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
          throw new Error(body.message || messageFor(body.error) || `The board's server said ${response.status}.`);
        }
        const next = (await response.json()) as FeedState;
        if (!live.current) return true;
        setFeed({ ...NO_FEED, ...next, options: { ...DEFAULT_FEED_OPTIONS, ...(next.options ?? {}) } });
        setStatus('ready');
        setError(null);
        return true;
      } catch (failure) {
        if (live.current) setError(failure instanceof Error ? failure.message : 'Could not reach the board’s server.');
        return false;
      } finally {
        if (live.current && !quiet) setBusy(false);
      }
    },
    [],
  );

  const reload = useCallback(() => void call({ method: 'GET' }, true), [call]);

  useEffect(() => {
    if (!enabled) {
      setStatus('unavailable');
      setFeed(NO_FEED);
      return;
    }
    setStatus('loading');
    reload();
  }, [enabled, reload]);

  const post = useCallback(
    (body: Record<string, unknown>) => void call({ method: 'POST', body: JSON.stringify(body) }),
    [call],
  );

  return {
    status,
    feed,
    busy,
    error,
    create: () => post({ timeZone: LOCAL_TIMEZONE }),
    update: (patch: Partial<FeedOptions>) => {
      // Shown straight away and confirmed by the reply: a tick box that waits
      // on a round trip before it moves feels broken rather than careful.
      setFeed((current) => ({ ...current, options: { ...current.options, ...patch } }));
      post(patch as Record<string, unknown>);
    },
    rotate: () => post({ rotate: true, timeZone: LOCAL_TIMEZONE }),
    remove: () => void call({ method: 'DELETE' }),
  };
}

function messageFor(error: string | undefined): string {
  if (error === 'bad-timezone') return 'This device reports a timezone the server does not recognise.';
  if (error === 'not-configured') return 'The board’s server has no login set up yet, so it cannot publish a feed.';
  if (error === 'unauthorised' || error === 'signed-out') return 'Sign in to the board again to change the feed.';
  return '';
}
