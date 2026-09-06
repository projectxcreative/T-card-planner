/**
 * Checks on the Clerk session-token verifier — the one piece of the Clerk
 * integration this app owns any crypto for at all. A real 2048-bit RSA key
 * stands in for Clerk's signing key, and the JWKS endpoint is stubbed, so
 * these exercise the actual signature check rather than a mock of it. Run
 * with `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';

import { normaliseIssuer, verifyClerkSession } from './clerk.ts';

const ISSUER = 'https://verified-cat-12.clerk.accounts.dev';
const KID = 'kid-1';
const ORIGIN = 'https://board.example.com';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const strangerKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const { n, e } = publicKey.export({ format: 'jwk' });

globalThis.fetch = async (url) =>
  String(url) === `${ISSUER}/.well-known/jwks.json`
    ? new Response(JSON.stringify({ keys: [{ kid: KID, kty: 'RSA', alg: 'RS256', use: 'sig', n, e }] }))
    : new Response('not found', { status: 404 });

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function sign(claims, { kid = KID, alg = 'RS256', key = privateKey } = {}) {
  const body = `${b64({ alg, kid, typ: 'JWT' })}.${b64(claims)}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(key).toString('base64url')}`;
}

const now = () => Math.floor(Date.now() / 1000);

const claims = (extra = {}) => ({
  iss: ISSUER,
  sub: `user_${randomUUID()}`,
  azp: ORIGIN,
  iat: now(),
  exp: now() + 60,
  ...extra,
});

const request = (token) =>
  new Request(`${ORIGIN}/api/board`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

const verify = (token) => verifyClerkSession(request(token), ISSUER);

test('a valid session token is accepted, and names its user', async () => {
  const token = sign(claims());
  const result = await verify(token);
  assert.equal(result.ok, true);
  assert.match(result.identity.sub, /^user_/);
});

test('a request with no bearer token is told so, not called a forgery', async () => {
  assert.deepEqual(await verify(null), { ok: false, reason: 'missing' });
});

test('an expired session is distinguished from a bad one', async () => {
  assert.deepEqual(await verify(sign(claims({ exp: now() - 3600 }))), { ok: false, reason: 'expired' });
  assert.deepEqual(await verify(sign(claims({ exp: undefined }))), { ok: false, reason: 'expired' });
});

test('a token is refused unless the signature really is Clerk instance’s own', async () => {
  const refused = {
    'not a JWT at all': 'garbage',
    'the alg: none trick': sign(claims(), { alg: 'none' }),
    'signed by somebody else’s key': sign(claims(), { key: strangerKey }),
    'signed by a key id the instance does not publish': sign(claims(), { kid: 'kid-unknown' }),
    'a payload swapped in after signing': (() => {
      const [header, , signature] = sign(claims()).split('.');
      return `${header}.${b64(claims({ sub: 'user_attacker' }))}.${signature}`;
    })(),
  };

  for (const [what, token] of Object.entries(refused)) {
    assert.deepEqual(await verify(token), { ok: false, reason: 'invalid' }, what);
  }
});

test('a token issued by another Clerk instance is not enough', async () => {
  assert.deepEqual(
    await verify(sign(claims({ iss: 'https://someone-elses-app.clerk.accounts.dev' }))),
    { ok: false, reason: 'invalid' },
  );
});

test('a token is not valid before its nbf', async () => {
  assert.deepEqual(await verify(sign(claims({ nbf: now() + 600 }))), { ok: false, reason: 'invalid' });
});

test('a token issued for a different origin is refused, but a missing azp is tolerated', async () => {
  assert.deepEqual(await verify(sign(claims({ azp: 'https://not-this-app.example.com' }))), {
    ok: false,
    reason: 'invalid',
  });

  const { azp, ...withoutAzp } = claims();
  void azp;
  const result = await verify(sign(withoutAzp));
  assert.equal(result.ok, true);
});

test('a token with no subject at all is refused', async () => {
  const { sub, ...withoutSub } = claims();
  void sub;
  assert.deepEqual(await verify(sign(withoutSub)), { ok: false, reason: 'invalid' });
});

test('the issuer is normalised the way it would actually be pasted in', () => {
  for (const written of [ISSUER, `${ISSUER}/`, `  ${ISSUER}  `, `${ISSUER}///`]) {
    assert.equal(normaliseIssuer(written), ISSUER, written);
  }
});
