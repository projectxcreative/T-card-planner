/**
 * Checks on the Access JWT verifier — the one piece of this project where a
 * mistake means the wrong person reads the board, and the one piece you cannot
 * eyeball to be sure of.
 *
 * A real 2048-bit RSA key stands in for the team's signing key, and the JWKS
 * endpoint is stubbed, so these exercise the actual signature check rather than
 * a mock of it. Run with `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';

import { emailAllowed, teamHost, verifyAccess } from './access.ts';

const TEAM = 'myteam';
const HOST = 'myteam.cloudflareaccess.com';
const AUD = 'aud-tag-under-test';
const KID = 'kid-1';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const strangerKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const { n, e } = publicKey.export({ format: 'jwk' });

globalThis.fetch = async (url) =>
  String(url) === `https://${HOST}/cdn-cgi/access/certs`
    ? new Response(JSON.stringify({ keys: [{ kid: KID, kty: 'RSA', alg: 'RS256', use: 'sig', n, e }] }))
    : new Response('not found', { status: 404 });

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function sign(claims, { kid = KID, alg = 'RS256', key = privateKey } = {}) {
  const body = `${b64({ alg, kid, typ: 'JWT' })}.${b64(claims)}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(key).toString('base64url')}`;
}

const now = () => Math.floor(Date.now() / 1000);

const claims = (extra = {}) => ({
  aud: [AUD],
  iss: `https://${HOST}`,
  email: 'Me@Example.com',
  sub: randomUUID(),
  iat: now(),
  exp: now() + 3600,
  ...extra,
});

/** Access sends the JWT as a header; ordinary page loads carry it as a cookie. */
const request = (token, via = 'header') =>
  new Request('https://board.example.com/api/board', {
    headers: !token
      ? {}
      : via === 'cookie'
        ? { cookie: `other=1; CF_Authorization=${token}; another=2` }
        : { 'cf-access-jwt-assertion': token },
  });

const verify = (token, { via, aud = AUD } = {}) => verifyAccess(request(token, via), TEAM, aud);

test('a valid login is accepted, from the header or the cookie', async () => {
  for (const via of ['header', 'cookie']) {
    const result = await verify(sign(claims()), { via });
    assert.equal(result.ok, true, `via the ${via}`);
    // Emails are lower-cased, so an allow list needn't guess at capitals.
    assert.equal(result.identity.email, 'me@example.com');
    assert.equal(result.identity.service, false);
  }
});

test('a service token is accepted, and named by its common name', async () => {
  const result = await verify(sign(claims({ email: undefined, sub: '', common_name: 'backup-script' })));
  assert.equal(result.ok, true);
  assert.equal(result.identity.email, 'backup-script');
  assert.equal(result.identity.service, true);
});

test('a request that never went through Access is told so, not called a forgery', async () => {
  assert.deepEqual(await verify(null), { ok: false, reason: 'missing' });
});

test('an expired session is distinguished from a bad one', async () => {
  // The app offers to sign you back in for one and not the other, so the two
  // must not collapse into a single "no".
  assert.deepEqual(await verify(sign(claims({ exp: now() - 3600 }))), { ok: false, reason: 'expired' });
  assert.deepEqual(await verify(sign(claims({ exp: undefined }))), { ok: false, reason: 'expired' });
});

test('a login is refused unless the signature really is the team’s', async () => {
  const refused = {
    'not a JWT at all': 'garbage',
    'the alg: none trick': sign(claims(), { alg: 'none' }),
    'signed by somebody else’s key': sign(claims(), { key: strangerKey }),
    'signed by a key id the team does not publish': sign(claims(), { kid: 'kid-unknown' }),
    'a payload swapped in after signing': (() => {
      const [header, , signature] = sign(claims()).split('.');
      return `${header}.${b64(claims({ email: 'attacker@evil.com' }))}.${signature}`;
    })(),
  };

  for (const [what, token] of Object.entries(refused)) {
    assert.deepEqual(await verify(token), { ok: false, reason: 'invalid' }, what);
  }
});

test('a login for another team, or another app of your own, is not enough', async () => {
  assert.deepEqual(
    await verify(sign(claims({ iss: 'https://someone-else.cloudflareaccess.com' }))),
    { ok: false, reason: 'invalid' },
  );
  assert.deepEqual(await verify(sign(claims({ aud: ['a-different-app'] }))), { ok: false, reason: 'invalid' });
  assert.deepEqual(await verify(sign(claims()), { aud: 'a-different-app' }), { ok: false, reason: 'invalid' });
});

test('a token that is not valid yet is refused', async () => {
  assert.deepEqual(await verify(sign(claims({ nbf: now() + 600 }))), { ok: false, reason: 'invalid' });
});

test('the team domain is understood however it was written down', () => {
  for (const written of ['myteam', 'myteam.cloudflareaccess.com', 'https://myteam.cloudflareaccess.com/', ' MyTeam ']) {
    assert.equal(teamHost(written), HOST, written);
  }
});

test('an unset email allow list lets through whoever the Access policy did', () => {
  assert.equal(emailAllowed('me@example.com', undefined), true);
  assert.equal(emailAllowed('me@example.com', '   '), true);
});

test('a set email allow list is the last word', () => {
  const list = 'me@example.com, you@example.com';
  assert.equal(emailAllowed('Me@Example.com', list), true);
  assert.equal(emailAllowed('you@example.com', list), true);
  assert.equal(emailAllowed('someone@else.com', list), false);
  // Newlines and stray spacing are how a list actually gets pasted in.
  assert.equal(emailAllowed('me@example.com', '  me@example.com \n you@example.com '), true);
});
