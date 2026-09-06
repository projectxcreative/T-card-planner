/**
 * Verifies the session token Clerk's frontend SDK attaches to API calls.
 *
 * Clerk does the actual sign-in, sign-up-by-invitation, and password reset —
 * all in the browser, talking to Clerk's own servers, never touching this
 * Worker. All this Worker needs to know is *who* is asking, which the
 * frontend proves by sending Clerk's own short-lived session token as a
 * bearer token. Verifying it here is a plain RS256/JWKS check, the same
 * shape as `access.ts` next door — no Clerk SDK, no secret key, nothing to
 * keep in step beyond the one issuer URL.
 */

export interface ClerkIdentity {
  /** Clerk's stable id for the signed-in user — what the board is keyed on. */
  sub: string;
}

export type ClerkResult =
  | { ok: true; identity: ClerkIdentity }
  /** No bearer token at all: the frontend isn't sending one, or isn't signed in. */
  | { ok: false; reason: 'missing' }
  /** A token that is past its expiry — Clerk's session tokens live ~60 seconds
   *  and the SDK is meant to refetch one before every call, so this usually
   *  means the frontend's own refresh has stopped working. */
  | { ok: false; reason: 'expired' }
  /** Signed by the wrong key, for another Clerk instance, or malformed. */
  | { ok: false; reason: 'invalid' };

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
}

interface Claims {
  iss?: string;
  sub?: string;
  /** "Authorized party" — the origin the token was issued to use from. */
  azp?: string;
  exp?: number;
  nbf?: number;
}

/** Clerk rotates signing keys slowly; an hour is well inside that. */
const JWKS_TTL_MS = 60 * 60 * 1000;
/** Tolerate a little clock drift either side rather than bouncing a live session. */
const CLOCK_SKEW_S = 60;

interface KeyCache {
  expires: number;
  keys: Map<string, CryptoKey>;
}

/** Per-isolate, so it is a saving rather than a guarantee. */
const jwks = new Map<string, KeyCache>();

/** `https://your-app.clerk.accounts.dev/` or a custom domain, however it was
 *  pasted in — trailing slash and all — folded to the bare issuer string
 *  Clerk actually signs into `iss`. */
export function normaliseIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson<T>(segment: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
  } catch {
    return null;
  }
}

async function loadKeys(issuer: string, force = false): Promise<Map<string, CryptoKey>> {
  const cached = jwks.get(issuer);
  if (!force && cached && cached.expires > Date.now()) return cached.keys;

  const response = await fetch(`${issuer}/.well-known/jwks.json`);
  if (!response.ok) throw new Error(`jwks ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };

  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue;
    keys.set(
      jwk.kid,
      await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    );
  }

  jwks.set(issuer, { expires: Date.now() + JWKS_TTL_MS, keys });
  return keys;
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  return scheme.toLowerCase() === 'bearer' && rest.length > 0 ? rest.join(' ') : null;
}

/**
 * Checks the Clerk session token on a request, sent as a bearer token by the
 * frontend's `getToken()` call — see `src/main.tsx`.
 */
export async function verifyClerkSession(request: Request, issuer: string): Promise<ClerkResult> {
  const token = bearer(request);
  if (!token) return { ok: false, reason: 'missing' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'invalid' };

  const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
  const claims = decodeJson<Claims>(parts[1]);
  if (!header || !claims) return { ok: false, reason: 'invalid' };
  // Pin the algorithm: an unpinned verifier can be talked into `none`.
  if (header.alg !== 'RS256' || !header.kid) return { ok: false, reason: 'invalid' };

  const normalisedIssuer = normaliseIssuer(issuer);

  let keys: Map<string, CryptoKey>;
  try {
    keys = await loadKeys(normalisedIssuer);
    // An unknown `kid` usually means the keys rotated since we last looked.
    if (!keys.has(header.kid)) keys = await loadKeys(normalisedIssuer, true);
  } catch {
    // The JWKS endpoint is unreachable. Refusing is the only safe answer: we
    // cannot tell a real session from a forged one without the keys.
    return { ok: false, reason: 'invalid' };
  }

  const key = keys.get(header.kid);
  if (!key) return { ok: false, reason: 'invalid' };

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]) as BufferSource,
    signed as BufferSource,
  );
  if (!valid) return { ok: false, reason: 'invalid' };

  if (claims.iss !== normalisedIssuer) return { ok: false, reason: 'invalid' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) {
    return { ok: false, reason: 'expired' };
  }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > now) {
    return { ok: false, reason: 'invalid' };
  }

  // `azp` is one of Clerk's own default claims, naming the origin the token
  // was issued for. Checked only when present — lenient rather than strict,
  // since Clerk has had its own bugs around this claim going missing — but a
  // mismatched one is refused outright.
  if (claims.azp && claims.azp !== new URL(request.url).origin) {
    return { ok: false, reason: 'invalid' };
  }

  if (!claims.sub) return { ok: false, reason: 'invalid' };

  return { ok: true, identity: { sub: claims.sub } };
}
