/**
 * Serves the built board app and a two-call sync API.
 *
 * The whole board is one JSON blob in KV, which is all a single-user planner
 * needs. Writes carry the revision they were based on, so a device that has
 * been offline (or is just a stale tab) is told its base is old rather than
 * silently flattening the newer board.
 *
 * Who gets in is decided in two places. Cloudflare Access does the login at
 * the edge and this Worker re-checks its signature (see `access.ts`), so the
 * board is only served to someone your Access policy let through. A shared
 * `BOARD_TOKEN` remains for callers that are not a browser — a backup script,
 * or a `wrangler dev` run with no Access in front of it.
 */

import { emailAllowed, teamHost, verifyAccess, type AccessIdentity, type AccessResult } from './access';

export interface Env {
  BOARD: KVNamespace;
  /** Shared secret for non-browser callers, and the only guard when Access is off. */
  BOARD_TOKEN?: string;
  /** Lets one namespace hold several boards if you ever want a second. */
  BOARD_KEY?: string;
  /** Your Zero Trust team, e.g. `myteam` or `myteam.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Application Audience tag of the Access application on this domain. */
  ACCESS_AUD?: string;
  /** Optional extra gate: only these emails, whatever the Access policy says. */
  ACCESS_EMAILS?: string;
  ASSETS: Fetcher;
}

interface StoredBoard {
  rev: number;
  updatedAt: string;
  board: unknown;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });

/** Access is on only when both halves are set; one alone can't verify anything. */
const accessConfigured = (env: Env): boolean => Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);

/** Compares without leaking where two secrets first differ. */
function secretsMatch(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  return scheme.toLowerCase() === 'bearer' && rest.length > 0 ? rest.join(' ') : null;
}

/**
 * Runs the Access check, and applies the optional email allow list on top.
 *
 * An email that Access let through but the allow list doesn't want is reported
 * as `invalid` rather than as a pass, so the caller treats it exactly like a
 * token signed by the wrong team.
 */
async function checkAccess(request: Request, env: Env): Promise<AccessResult | null> {
  if (!accessConfigured(env)) return null;
  const result = await verifyAccess(request, env.ACCESS_TEAM_DOMAIN!, env.ACCESS_AUD!);
  if (result.ok && !emailAllowed(result.identity.email, env.ACCESS_EMAILS)) {
    return { ok: false, reason: 'invalid' };
  }
  return result;
}

/**
 * Decides whether an API call may proceed, and returns who is asking.
 *
 * Either credential is enough: the Access login a browser arrives with, or the
 * shared token a script carries. 503 when neither is configured, so a
 * half-finished setup reads as "not set up" rather than "wrong password".
 */
function authorise(
  request: Request,
  env: Env,
  access: AccessResult | null,
): { identity: AccessIdentity | null } | Response {
  if (access?.ok) return { identity: access.identity };

  if (env.BOARD_TOKEN) {
    const supplied = bearer(request);
    if (supplied && secretsMatch(supplied, env.BOARD_TOKEN)) return { identity: null };
  }

  if (!env.BOARD_TOKEN && !accessConfigured(env)) {
    return json(
      {
        error: 'not-configured',
        message: 'This Worker has no login configured yet: set up Cloudflare Access, or a BOARD_TOKEN secret.',
      },
      503,
    );
  }

  // A JWT that merely ran out is a different problem from a wrong one: the
  // browser only needs to visit Access again, which the app can offer to do.
  if (access && !access.ok && access.reason === 'expired') {
    return json({ error: 'signed-out', message: 'Your Cloudflare Access session has expired.' }, 401);
  }

  return json({ error: 'unauthorised', message: 'Wrong or missing credentials.' }, 401);
}

async function readBoard(env: Env): Promise<StoredBoard | null> {
  return env.BOARD.get<StoredBoard>(env.BOARD_KEY || 'board', 'json');
}

async function handleApi(
  request: Request,
  env: Env,
  path: string,
  access: AccessResult | null,
): Promise<Response> {
  // Deliberately open: it answers whether the Worker is up and what it expects
  // you to log in with, and nothing about the board or about you. It is what
  // you curl when the login itself is the thing that isn't working.
  if (path === '/api/health') {
    return json({
      ok: true,
      configured: Boolean(env.BOARD_TOKEN) || accessConfigured(env),
      access: accessConfigured(env),
    });
  }

  // Who the app is talking to, so it can say so and stop asking for a token
  // it no longer needs. Only ever reports an identity that just verified.
  if (path === '/api/session') {
    return json({
      access: accessConfigured(env),
      signedIn: Boolean(access?.ok),
      email: access?.ok ? access.identity.email : null,
      tokenRequired: !access?.ok && Boolean(env.BOARD_TOKEN),
      configured: Boolean(env.BOARD_TOKEN) || accessConfigured(env),
    });
  }

  if (path !== '/api/board') return json({ error: 'not-found' }, 404);

  const allowed = authorise(request, env, access);
  if (allowed instanceof Response) return allowed;

  if (request.method === 'GET') {
    const stored = await readBoard(env);
    // 204 means "authorised, but nothing saved yet" — the client then pushes
    // whatever it has locally instead of wiping itself.
    return stored ? json(stored) : new Response(null, { status: 204 });
  }

  if (request.method === 'PUT') {
    let payload: { rev?: number; board?: unknown; force?: boolean };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return json({ error: 'bad-json' }, 400);
    }
    if (!payload || typeof payload.board !== 'object' || payload.board === null) {
      return json({ error: 'bad-board' }, 400);
    }

    const stored = await readBoard(env);
    const currentRev = stored?.rev ?? 0;
    const baseRev = Number.isFinite(payload.rev) ? Number(payload.rev) : 0;

    if (!payload.force && currentRev !== baseRev) {
      return json({ error: 'conflict', ...(stored as StoredBoard) }, 409);
    }

    const next: StoredBoard = {
      rev: currentRev + 1,
      updatedAt: new Date().toISOString(),
      board: payload.board,
    };
    await env.BOARD.put(env.BOARD_KEY || 'board', JSON.stringify(next));
    return json({ rev: next.rev, updatedAt: next.updatedAt });
  }

  return json({ error: 'method-not-allowed' }, 405, { allow: 'GET, PUT' });
}

/**
 * The page shown when the app itself is asked for without an Access login.
 *
 * Access normally challenges before the request ever gets here, so reaching
 * this page means the request arrived by a route the Access application does
 * not cover. Sending it to the login would only loop, so it says what is
 * actually wrong instead.
 */
function deniedPage(reason: 'missing' | 'expired' | 'invalid'): Response {
  const heading = reason === 'expired' ? 'Your session has expired' : 'Sign-in required';
  const detail =
    reason === 'expired'
      ? 'Reload this page and Cloudflare Access will sign you back in.'
      : reason === 'invalid'
        ? 'Your login was not accepted for this board. If it is yours, check the Access policy and the ACCESS_AUD value on the Worker.'
        : 'This request did not come through Cloudflare Access. Open the board on its usual address — the one the Access application protects.';

  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading} — T-Card Planner</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
         background:#eef1f5; color:#1e2430; }
  main { max-width:34rem; }
  h1 { font-size:1.3rem; margin:0 0 .6em; }
  p { margin:0 0 1em; color:#4a5568; }
  @media (prefers-color-scheme: dark) { body { background:#161a20; color:#e6e9ee; } p { color:#9aa4b2; } }
</style>
<main><h1>${heading}</h1><p>${detail}</p></main>`,
    { status: reason === 'expired' ? 401 : 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    // Cloudflare handles /cdn-cgi/access/* at the edge, so this only runs if
    // the request somehow got past it. Sending sign-out on to the team domain
    // means the button in the app works either way.
    if (path === '/cdn-cgi/access/logout' && env.ACCESS_TEAM_DOMAIN) {
      return Response.redirect(`https://${teamHost(env.ACCESS_TEAM_DOMAIN)}/cdn-cgi/access/logout`, 302);
    }

    const access = await checkAccess(request, env);

    if (path.startsWith('/api/')) {
      const response = await handleApi(request, env, path, access);
      // Same-origin only: the app is served by this very Worker, so there is
      // no reason to hand the API to another site. The reply depends on both
      // credentials, so neither may be cached across callers.
      response.headers.set('vary', 'authorization, cookie');
      return response;
    }

    // The app itself. With Access configured nothing is served without a valid
    // login — not even the shell — so a Worker reachable on some address the
    // Access application misses is a closed door rather than an open one.
    if (access && !access.ok) return deniedPage(access.reason);

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
