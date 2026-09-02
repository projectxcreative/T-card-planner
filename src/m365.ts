/**
 * Microsoft 365 calendar, from the browser.
 *
 * The app registration you point this at is a *public* client — a single-page
 * application — so there is no secret anywhere in here and none to keep on the
 * Worker. Sign-in is the authorization-code flow with PKCE: the browser mints a
 * verifier, sends only its hash to Microsoft, and proves ownership when it
 * swaps the code for tokens. The tokens live on the device that earned them.
 *
 * Two things are done with the calendar, and they are deliberately separate:
 * existing entries are *read* into the day and month views so the plan is made
 * with meetings in front of you, and a card only *writes* an entry when you
 * tick "publish" on it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { graphDateTime, minutesOfDay, toKey } from './dates';
import { BACKLOG, type Card, type LaneId, type M365Config } from './types';

const TOKEN_KEY = 'tcard-planner.m365.v1';
const PKCE_KEY = 'tcard-planner.m365.pkce';
const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Read the calendar, write our own entries, and know whose calendar it is.
 *  `offline_access` is what makes the connection outlast the access token. */
const SCOPES = 'openid profile offline_access User.Read Calendars.ReadWrite';

/** Refresh a little before the token actually dies, so a call in flight when
 *  it expires doesn't fail on the wire. */
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

export const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

interface Tokens {
  access: string;
  refresh: string;
  /** Epoch ms. */
  expires: number;
  account: string;
  /** The tenant/client the tokens were issued for; changing either drops them. */
  tenant: string;
  clientId: string;
}

export type M365Status = 'unconfigured' | 'disconnected' | 'connecting' | 'connected' | 'error';

/** One entry already in the calendar, flattened to what the views draw. */
export interface CalendarEvent {
  id: string;
  subject: string;
  /** Local day key. All-day entries can span several; they are listed on each. */
  day: string;
  /** Minutes from midnight, or null for an all-day entry. */
  start: number | null;
  end: number | null;
  allDay: boolean;
  location: string;
  /** True when Outlook has it as free/tentative rather than a hard commitment. */
  soft: boolean;
  webLink: string;
}

/* ---------- token storage ---------- */

/**
 * There is exactly one set of tokens on a device, so there is exactly one
 * holder of them here.
 *
 * This matters more than it looks: Microsoft rotates the refresh token on
 * every use, so a second copy of it held elsewhere in the app is already spent
 * the moment the first copy is redeemed. A single cache and a single in-flight
 * refresh is what keeps two hooks from knocking each other out.
 */
let cached: Tokens | null | undefined;
let refreshing: Promise<Tokens> | null = null;

/** Told when the connection is lost, so every hook can say so at once. */
const lostListeners = new Set<() => void>();

function onTokensLost(listener: () => void): () => void {
  lostListeners.add(listener);
  return () => lostListeners.delete(listener);
}

function currentTokens(): Tokens | null {
  if (cached === undefined) cached = readTokens();
  return cached;
}

/** `announce` is false when the tokens are being cleared for a reason the app
 *  already knows about — a deliberate disconnect, or a changed client id —
 *  rather than because the connection died under it. */
function setTokens(tokens: Tokens | null, announce = true): void {
  cached = tokens;
  writeTokens(tokens);
  if (!tokens && announce) for (const listener of [...lostListeners]) listener();
}

function readTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Tokens>;
    if (typeof value.access !== 'string' || typeof value.refresh !== 'string') return null;
    return {
      access: value.access,
      refresh: value.refresh,
      expires: Number(value.expires) || 0,
      account: typeof value.account === 'string' ? value.account : '',
      tenant: typeof value.tenant === 'string' ? value.tenant : '',
      clientId: typeof value.clientId === 'string' ? value.clientId : '',
    };
  } catch {
    return null;
  }
}

function writeTokens(tokens: Tokens | null): void {
  try {
    if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // A device that won't hold the tokens can still sign in for this session.
  }
}

/* ---------- PKCE ---------- */

function base64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64Url(bytes.buffer);
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(digest);
}

/** Whatever the tenant was written as, as the path segment Microsoft wants. */
function authority(config: M365Config): string {
  const tenant = config.tenant.trim() || 'common';
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}`;
}

/** The app is a single page, so the redirect only ever comes back to its root.
 *  This is the value that has to be registered on the app registration. */
export function redirectUri(): string {
  return `${window.location.origin}/`;
}

/**
 * The app registration this build ships with, if it was given one.
 *
 * With it, connecting a calendar is a button: the visitor signs in to
 * Microsoft, approves the two permissions, and comes back. Without it, each
 * person has to go and create an app registration of their own first — fine
 * for whoever set the board up, a wall for anyone else.
 *
 * The value is an identifier, not a credential. See `vite-env.d.ts`.
 */
const BUILT_IN: M365Config = {
  clientId: (import.meta.env.VITE_M365_CLIENT_ID ?? '').trim(),
  tenant: (import.meta.env.VITE_M365_TENANT ?? '').trim() || 'common',
};

/** True when this build can connect a calendar with no setup at all. */
export const hasBuiltInApp = Boolean(BUILT_IN.clientId);

/**
 * Which registration to actually use.
 *
 * An override is all or nothing: give a client id of your own and your tenant
 * goes with it. Half of one registration and half of another would only ever
 * be a mistake, so it isn't a state you can get into.
 */
export function effectiveConfig(own: M365Config): M365Config {
  return own.clientId.trim() ? own : BUILT_IN;
}

export function isConfigured(config: M365Config): boolean {
  return Boolean(config.clientId.trim());
}

/* ---------- the token dance ---------- */

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function postToken(config: M365Config, body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${authority(config)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId.trim(), ...body }),
  });
  return (await response.json()) as TokenResponse;
}

/** Who the tokens belong to, so the settings panel can say more than "connected". */
async function readAccount(access: string): Promise<string> {
  try {
    const response = await fetch(`${GRAPH}/me?$select=userPrincipalName,mail,displayName`, {
      headers: { authorization: `Bearer ${access}` },
    });
    if (!response.ok) return '';
    const me = (await response.json()) as { mail?: string; userPrincipalName?: string; displayName?: string };
    return me.mail || me.userPrincipalName || me.displayName || '';
  } catch {
    return '';
  }
}

function store(config: M365Config, reply: TokenResponse, account: string, fallbackRefresh = ''): Tokens {
  const tokens: Tokens = {
    access: reply.access_token!,
    refresh: reply.refresh_token || fallbackRefresh,
    expires: Date.now() + (reply.expires_in ?? 3600) * 1000,
    account,
    tenant: config.tenant.trim() || 'common',
    clientId: config.clientId.trim(),
  };
  cached = tokens;
  writeTokens(tokens);
  return tokens;
}

/** Sends the browser to Microsoft. Nothing after this call runs. */
export async function beginSignIn(config: M365Config): Promise<void> {
  const verifier = randomString();
  const state = randomString();
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));

  const params = new URLSearchParams({
    client_id: config.clientId.trim(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    // The account picker, rather than silently reusing whoever the browser
    // signed in as last — a work calendar is rarely the only one you have.
    prompt: 'select_account',
  });
  window.location.assign(`${authority(config)}/oauth2/v2.0/authorize?${params}`);
}

/**
 * Finishes a sign-in if this load is the one Microsoft redirected back to.
 *
 * Returns the tokens, an error, or null when the page was loaded normally. The
 * query string is cleaned off either way, so a reload doesn't try to spend a
 * code that has already been used.
 */
async function completeSignIn(config: M365Config): Promise<{ tokens?: Tokens; error?: string } | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const failure = url.searchParams.get('error');
  if (!code && !failure) return null;

  const raw = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  const clean = () => {
    for (const key of ['code', 'state', 'error', 'error_description', 'session_state']) url.searchParams.delete(key);
    window.history.replaceState(null, '', url.toString());
  };

  if (failure) {
    clean();
    return { error: url.searchParams.get('error_description') || failure };
  }

  let pending: { verifier?: string; state?: string } = {};
  try {
    pending = raw ? JSON.parse(raw) : {};
  } catch {
    pending = {};
  }
  // A code that arrived without the verifier that started it — a second tab, a
  // stale link — is not ours to spend.
  if (!pending.verifier || pending.state !== state) {
    clean();
    return null;
  }

  const reply = await postToken(config, {
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
    scope: SCOPES,
  });
  clean();

  if (!reply.access_token) return { error: reply.error_description || reply.error || 'Sign-in failed.' };
  return { tokens: store(config, reply, await readAccount(reply.access_token)) };
}

/* ---------- the connection ---------- */

export interface M365 {
  status: M365Status;
  account: string;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  /** Entries already in the calendar, keyed by day, for the range being viewed. */
  events: Map<string, CalendarEvent[]>;
  /** Ask for a fresh read of a day range. Idempotent and cheap to call. */
  watch: (from: string, to: string) => void;
  refresh: () => void;
}

/**
 * A live access token, refreshing the held one when it is spent.
 *
 * Concurrent callers share the one refresh rather than each spending the
 * rotating refresh token, which would leave all but the first holding a
 * credential the server has already retired.
 */
async function liveTokens(config: M365Config): Promise<Tokens> {
  const held = currentTokens();
  if (!held) throw new Error('Not connected to Microsoft 365.');
  if (held.expires - EXPIRY_MARGIN_MS > Date.now()) return held;

  if (!refreshing) {
    refreshing = (async () => {
      const reply = await postToken(config, {
        grant_type: 'refresh_token',
        refresh_token: held.refresh,
        scope: SCOPES,
      });
      if (!reply.access_token) {
        // Revoked, or aged out: a sign-in problem rather than a network one,
        // so say so instead of retrying against a credential that is gone.
        setTokens(null);
        throw new Error(reply.error_description || 'The Microsoft 365 connection has expired.');
      }
      return store(config, reply, held.account, held.refresh);
    })();
    refreshing.catch(() => undefined).finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** A Graph call with a live token on it. */
async function graphFetch(config: M365Config, path: string, init: RequestInit = {}): Promise<Response> {
  const tokens = await liveTokens(config);
  return fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${tokens.access}`,
      'content-type': 'application/json',
      prefer: `outlook.timezone="${LOCAL_TIMEZONE}"`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

interface GraphEvent {
  id: string;
  subject?: string;
  isAllDay?: boolean;
  showAs?: string;
  webLink?: string;
  location?: { displayName?: string };
  start?: { dateTime?: string };
  end?: { dateTime?: string };
}

/** Graph hands back naive local times because of the `Prefer` header above, so
 *  they are parsed as local rather than pulled through a UTC conversion. */
function parseLocal(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match;
  return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
}

function toCalendarEvents(raw: GraphEvent[]): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>();
  const push = (day: string, event: CalendarEvent) => {
    const list = byDay.get(day);
    if (list) list.push(event);
    else byDay.set(day, [event]);
  };

  for (const item of raw) {
    const from = parseLocal(item.start?.dateTime);
    const to = parseLocal(item.end?.dateTime);
    if (!from) continue;
    const base = {
      id: item.id,
      subject: item.subject?.trim() || '(no subject)',
      allDay: item.isAllDay === true,
      location: item.location?.displayName?.trim() ?? '',
      soft: item.showAs === 'free' || item.showAs === 'tentative' || item.showAs === 'workingElsewhere',
      webLink: item.webLink ?? '',
    };

    if (base.allDay) {
      // Graph ends an all-day entry at midnight on the following day; that last
      // instant is not a day you are busy on. An entry that ends where it
      // starts still occupies the day it is on, rather than no days at all.
      const last = to && to.getTime() > from.getTime() ? new Date(to.getTime() - 60_000) : from;
      for (let day = new Date(from); toKey(day) <= toKey(last); day.setDate(day.getDate() + 1)) {
        push(toKey(day), { ...base, day: toKey(day), start: null, end: null });
      }
      continue;
    }

    const day = toKey(from);
    const sameDay = to && toKey(to) === day;
    push(day, {
      ...base,
      day,
      start: minutesOfDay(from),
      // An entry running past midnight is drawn to the end of its first day.
      end: sameDay ? minutesOfDay(to) : 24 * 60,
    });
  }

  for (const list of byDay.values()) {
    list.sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
  }
  return byDay;
}

/**
 * Holds the connection, and keeps a window of the calendar in memory.
 *
 * The range comes from whichever view is on screen — a day, a week, a month —
 * and is re-read when it changes, when the tab comes back, and on demand.
 */
export function useM365(config: M365Config): M365 {
  const configured = isConfigured(config);
  const [status, setStatus] = useState<M365Status>('unconfigured');
  const [account, setAccount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<Map<string, CalendarEvent[]>>(() => new Map());
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  // The tokens can be dropped by any caller's refresh, not only by ours.
  useEffect(
    () =>
      onTokensLost(() => {
        setStatus('disconnected');
        setAccount('');
        setError('The Microsoft 365 connection has expired — connect again.');
      }),
    [],
  );

  const graph = useCallback((path: string, init?: RequestInit) => graphFetch(config, path, init), [config]);

  // Adopt whatever this device already holds, and finish a sign-in if this
  // load is the redirect back from Microsoft.
  useEffect(() => {
    if (!configured) {
      setStatus('unconfigured');
      return;
    }
    let live = true;
    const held = currentTokens();
    // Tokens issued for a different app registration are no use here.
    if (held && held.clientId === config.clientId.trim()) {
      setStatus('connected');
      setAccount(held.account);
    } else if (held) {
      setTokens(null, false);
    }

    void (async () => {
      try {
        const finished = await completeSignIn(config);
        if (!live || !finished) return;
        if (finished.error) {
          setStatus('error');
          setError(finished.error);
          return;
        }
        setStatus('connected');
        setAccount(finished.tokens!.account);
        setError(null);
      } catch (failure) {
        if (!live) return;
        setStatus('error');
        setError(failure instanceof Error ? failure.message : 'Sign-in failed.');
      }
    })();

    return () => {
      live = false;
    };
  }, [config, configured]);

  const load = useCallback(async () => {
    if (!range || status !== 'connected') return;
    try {
      const params = new URLSearchParams({
        startDateTime: `${range.from}T00:00:00`,
        endDateTime: `${range.to}T23:59:59`,
        $select: 'subject,start,end,isAllDay,location,showAs,webLink',
        $orderby: 'start/dateTime',
        $top: '250',
      });
      const response = await graph(`/me/calendarView?${params}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message || `Calendar read failed (${response.status}).`);
      }
      const body = (await response.json()) as { value: GraphEvent[] };
      setEvents(toCalendarEvents(body.value ?? []));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not read the calendar.');
    }
  }, [graph, range, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // A calendar read on a stale tab is worth having; a poll while it is hidden
  // is not, so the read follows the tab rather than a timer.
  useEffect(() => {
    if (status !== 'connected') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load, status]);

  const watch = useCallback((from: string, to: string) => {
    setRange((current) => (current && current.from === from && current.to === to ? current : { from, to }));
  }, []);

  const connect = useCallback(() => {
    if (!configured) return;
    setStatus('connecting');
    setError(null);
    void beginSignIn(config).catch((failure: unknown) => {
      setStatus('error');
      setError(failure instanceof Error ? failure.message : 'Could not start sign-in.');
    });
  }, [config, configured]);

  const disconnect = useCallback(() => {
    setTokens(null, false);
    setEvents(new Map());
    setAccount('');
    setError(null);
    setStatus(configured ? 'disconnected' : 'unconfigured');
  }, [configured]);

  useEffect(() => {
    if (!configured) return;
    // Configured but never connected reads as "disconnected", not "error".
    setStatus((current) => (current === 'unconfigured' ? (currentTokens() ? 'connected' : 'disconnected') : current));
  }, [configured]);

  return useMemo(
    () => ({ status, account, error, connect, disconnect, events, watch, refresh: () => void load() }),
    [account, connect, disconnect, error, events, load, status, watch],
  );
}

/* ---------- publishing cards ---------- */

/** Everything about a card that a calendar entry would show. Publishing is
 *  driven off this rather than off `updatedAt`, so retitling a card pushes and
 *  reordering a column does not. */
function signature(card: Card, lane: LaneId): string {
  return [lane, card.start, card.estimate, card.title, card.publish, card.status].join('|');
}

const DEFAULT_START_MINUTES = 9 * 60;
const DEFAULT_LENGTH_MINUTES = 60;

/** A card with no time of its own still has to become an entry with one. */
export function eventWindow(card: Card): { start: number; end: number } {
  const start = card.start ?? DEFAULT_START_MINUTES;
  const length = card.estimate > 0 ? Math.round(card.estimate * 60) : DEFAULT_LENGTH_MINUTES;
  return { start, end: Math.min(start + length, 24 * 60) };
}

export interface PublishState {
  /** Card ids currently being written to the calendar. */
  busy: Set<string>;
  error: string | null;
}

/**
 * Keeps the calendar in step with every card that has "publish" ticked.
 *
 * Only scheduled cards can be published — an entry needs a day — and only the
 * cards whose shown detail has actually changed are pushed. Un-ticking a card,
 * or moving it back to the backlog, takes its entry away again.
 */
export function usePublishing(
  config: M365Config,
  connected: boolean,
  cards: { card: Card; lane: LaneId }[],
  onPatch: (id: string, patch: Partial<Card>) => void,
  /** Entries whose card has gone, and the way to say they have been removed. */
  orphans: string[],
  onRemoved: (ids: string[]) => void,
): PublishState {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  /** What we last successfully wrote, per card. */
  const pushed = useRef(new Map<string, string>());
  const running = useRef(false);

  useEffect(() => onTokensLost(() => setError('The Microsoft 365 connection has expired.')), []);

  const graph = useCallback((path: string, init?: RequestInit) => graphFetch(config, path, init), [config]);

  const patchRef = useRef(onPatch);
  patchRef.current = onPatch;
  const removedRef = useRef(onRemoved);
  removedRef.current = onRemoved;

  // The list is rebuilt on every board change; the signatures are what decide
  // whether there is anything to do.
  const work = useMemo(
    () =>
      cards.map(({ card, lane }) => ({
        card,
        lane,
        signature: signature(card, lane),
        // A card in the backlog has no day, so there is nothing to publish.
        wanted: card.publish && lane !== BACKLOG,
      })),
    [cards],
  );

  useEffect(() => {
    if (!connected || running.current) return;
    const todo = work.filter(
      (item) =>
        (item.wanted && pushed.current.get(item.card.id) !== item.signature) ||
        (!item.wanted && item.card.eventId),
    );
    if (todo.length === 0) return;

    running.current = true;
    setBusy(new Set(todo.map((item) => item.card.id)));

    void (async () => {
      for (const item of todo) {
        const { card, lane, wanted } = item;
        try {
          if (!wanted) {
            if (card.eventId) {
              const response = await graph(`/me/events/${card.eventId}`, { method: 'DELETE' });
              // A 404 means someone deleted it in Outlook, which is the same
              // outcome we were after.
              if (!response.ok && response.status !== 404) throw new Error(`Could not remove the calendar entry (${response.status}).`);
              patchRef.current(card.id, { eventId: null });
            }
            pushed.current.delete(card.id);
            continue;
          }

          const { start, end } = eventWindow(card);
          const body = {
            subject: card.title || 'Untitled card',
            body: { contentType: 'HTML', content: card.description || '' },
            start: { dateTime: graphDateTime(lane, start), timeZone: LOCAL_TIMEZONE },
            end: { dateTime: graphDateTime(lane, end), timeZone: LOCAL_TIMEZONE },
            showAs: card.status === 'done' ? 'free' : 'busy',
          };

          const response = card.eventId
            ? await graph(`/me/events/${card.eventId}`, { method: 'PATCH', body: JSON.stringify(body) })
            : await graph('/me/events', { method: 'POST', body: JSON.stringify(body) });

          // The entry we were updating is gone: make a new one rather than
          // leaving the card permanently unpublishable.
          if (response.status === 404 && card.eventId) {
            patchRef.current(card.id, { eventId: null });
            continue;
          }
          if (!response.ok) {
            const failure = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
            throw new Error(failure.error?.message || `Could not publish “${card.title}” (${response.status}).`);
          }

          const saved = (await response.json()) as { id?: string };
          if (saved.id && saved.id !== card.eventId) patchRef.current(card.id, { eventId: saved.id });
          pushed.current.set(card.id, item.signature);
          setError(null);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : 'Could not reach the calendar.');
          break;
        }
      }
      running.current = false;
      setBusy(new Set());
    })();
  }, [connected, graph, work]);

  /**
   * Takes the stranded entries off the calendar.
   *
   * Separate from the card loop above because there is no card left to hang it
   * off — only an id. A 404 counts as done: someone deleting it in Outlook
   * first is the outcome we were after, and leaving it on the list would mean
   * retrying it forever.
   */
  const sweeping = useRef(false);

  useEffect(() => {
    if (!connected || sweeping.current || orphans.length === 0) return;
    sweeping.current = true;
    const doing = [...orphans];

    void (async () => {
      const removed: string[] = [];
      try {
        for (const id of doing) {
          const response = await graph(`/me/events/${id}`, { method: 'DELETE' });
          if (response.ok || response.status === 404) {
            removed.push(id);
            continue;
          }
          // Anything else is worth another go later rather than dropping.
          throw new Error(`Could not remove a calendar entry (${response.status}).`);
        }
        setError(null);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not reach the calendar.');
      } finally {
        if (removed.length > 0) removedRef.current(removed);
        sweeping.current = false;
      }
    })();
  }, [connected, graph, orphans]);

  return { busy, error };
}
