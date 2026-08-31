/**
 * Serves the built board app and a two-call sync API.
 *
 * The whole board is one JSON blob in KV, which is all a single-user planner
 * needs. Writes carry the revision they were based on, so a device that has
 * been offline (or is just a stale tab) is told its base is old rather than
 * silently flattening the newer board.
 */

export interface Env {
  BOARD: KVNamespace;
  /** Shared secret. Until it is set the API refuses to serve anything. */
  BOARD_TOKEN?: string;
  /** Lets one namespace hold several boards if you ever want a second. */
  BOARD_KEY?: string;
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

/** 503 when unconfigured, 401 when the token is wrong — the client shows a
 *  different message for each, so setup mistakes are obvious. */
function authorise(request: Request, env: Env): Response | null {
  if (!env.BOARD_TOKEN) {
    return json(
      { error: 'not-configured', message: 'This Worker has no BOARD_TOKEN secret set yet.' },
      503,
    );
  }
  const supplied = bearer(request);
  if (!supplied || !secretsMatch(supplied, env.BOARD_TOKEN)) {
    return json({ error: 'unauthorised', message: 'Wrong or missing sync token.' }, 401);
  }
  return null;
}

async function readBoard(env: Env): Promise<StoredBoard | null> {
  return env.BOARD.get<StoredBoard>(env.BOARD_KEY || 'board', 'json');
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (path === '/api/health') {
    return json({ ok: true, configured: Boolean(env.BOARD_TOKEN) });
  }

  if (path !== '/api/board') return json({ error: 'not-found' }, 404);

  const denied = authorise(request, env);
  if (denied) return denied;

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path.startsWith('/api/')) {
      const response = await handleApi(request, env, path);
      // Same-origin only: the app is served by this very Worker, so there is
      // no reason to hand the API to another site.
      response.headers.set('vary', 'authorization');
      return response;
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
