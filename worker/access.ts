/**
 * Verifies the login Cloudflare Access performs in front of this Worker.
 *
 * Access sits at the edge: it challenges the visitor, runs whatever policy you
 * wrote (a one-time code to your email, Google, GitHub…), and only then passes
 * the request on — carrying a signed JWT that says who got through. Verifying
 * that JWT here is what turns "Access is probably in front of me" into
 * something the Worker knows, so a request that reached the origin by another
 * route is refused rather than trusted.
 *
 * The signing keys are the team's public JWKS, so verification is a plain
 * signature check with no secret to share and nothing to keep in step.
 */

export interface AccessIdentity {
  /** The person's email, or a service token's name for machine callers. */
  email: string;
  /** Access's stable id for the user. Empty for service tokens. */
  sub: string;
  /** True when this is a service token rather than a person. */
  service: boolean;
}

export type AccessResult =
  | { ok: true; identity: AccessIdentity }
  /** No JWT at all: the request did not come through Access. */
  | { ok: false; reason: 'missing' }
  /** A JWT that is past its expiry — a stale tab, or a session that ran out. */
  | { ok: false; reason: 'expired' }
  /** Signed by the wrong key, for another application, or malformed. */
  | { ok: false; reason: 'invalid' };

/** The fields of a JWKS entry this verifier needs. */
interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
}

interface Claims {
  aud?: string[] | string;
  iss?: string;
  exp?: number;
  nbf?: number;
  email?: string;
  sub?: string;
  common_name?: string;
}

/** Cloudflare rotates the signing keys slowly; an hour is well inside that. */
const JWKS_TTL_MS = 60 * 60 * 1000;
/** Tolerate a little clock drift either side rather than bouncing a live login. */
const CLOCK_SKEW_S = 60;

interface KeyCache {
  expires: number;
  keys: Map<string, CryptoKey>;
}

/** Per-isolate, so it is a saving rather than a guarantee. */
const jwks = new Map<string, KeyCache>();

/**
 * Turns whatever the team domain was written as into the bare hostname.
 * `myteam`, `myteam.cloudflareaccess.com` and `https://myteam.cloudflareaccess.com/`
 * are all the same team, and all three get pasted into config at some point.
 */
export function teamHost(teamDomain: string): string {
  const bare = teamDomain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  return bare.includes('.') ? bare : `${bare}.cloudflareaccess.com`;
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

async function loadKeys(host: string, force = false): Promise<Map<string, CryptoKey>> {
  const cached = jwks.get(host);
  if (!force && cached && cached.expires > Date.now()) return cached.keys;

  const response = await fetch(`https://${host}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`certs ${response.status}`);
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

  jwks.set(host, { expires: Date.now() + JWKS_TTL_MS, keys });
  return keys;
}

/** Access sends the JWT as a header, and as a cookie on ordinary page loads. */
function readToken(request: Request): string | null {
  const header = request.headers.get('cf-access-jwt-assertion');
  if (header) return header;

  const cookies = request.headers.get('cookie');
  if (!cookies) return null;
  for (const part of cookies.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === 'CF_Authorization' && value.length) return value.join('=');
  }
  return null;
}

/**
 * Checks the Access JWT on a request.
 *
 * `aud` is the Application Audience tag of one specific Access application, so
 * a valid token minted for some *other* application on the same team is not
 * enough — otherwise anyone who can log in to any of your apps could read this
 * board.
 */
export async function verifyAccess(
  request: Request,
  teamDomain: string,
  aud: string,
): Promise<AccessResult> {
  const token = readToken(request);
  if (!token) return { ok: false, reason: 'missing' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'invalid' };

  const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
  const claims = decodeJson<Claims>(parts[1]);
  if (!header || !claims) return { ok: false, reason: 'invalid' };
  // Pin the algorithm: an unpinned verifier can be talked into `none`.
  if (header.alg !== 'RS256' || !header.kid) return { ok: false, reason: 'invalid' };

  const host = teamHost(teamDomain);

  let keys: Map<string, CryptoKey>;
  try {
    keys = await loadKeys(host);
    // An unknown `kid` usually means the keys rotated since we last looked.
    if (!keys.has(header.kid)) keys = await loadKeys(host, true);
  } catch {
    // The certs endpoint is unreachable. Refusing is the only safe answer: we
    // cannot tell a real login from a forged one without the keys.
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

  if (claims.iss !== `https://${host}`) return { ok: false, reason: 'invalid' };

  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audiences.includes(aud)) return { ok: false, reason: 'invalid' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) {
    return { ok: false, reason: 'expired' };
  }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > now) {
    return { ok: false, reason: 'invalid' };
  }

  const email = (claims.email || claims.common_name || '').toLowerCase();
  if (!email) return { ok: false, reason: 'invalid' };

  return {
    ok: true,
    identity: { email, sub: claims.sub || '', service: !claims.email && Boolean(claims.common_name) },
  };
}

/**
 * An optional second gate, on top of the Access policy itself.
 *
 * The policy in the dashboard decides who may log in; this decides who the
 * board answers to. They are usually the same list, and keeping one here means
 * a policy accidentally widened — "any Google account" rather than yours — does
 * not quietly hand over the board. Unset means "whoever the policy let in".
 */
export function emailAllowed(email: string, allowList: string | undefined): boolean {
  if (!allowList || !allowList.trim()) return true;
  return allowList
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}
