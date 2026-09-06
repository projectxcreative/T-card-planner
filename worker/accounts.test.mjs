/**
 * Checks on native accounts: hashing, invites, sessions, resets and the
 * 10-seat cap — the pieces with no UI in front of them to catch a mistake by
 * eye. Run with `npm test`.
 *
 * KV is faked in memory rather than mocked call-by-call, so these exercise
 * the real read-modify-write logic in accounts.ts against something that
 * behaves like the store it will actually run against.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, isValidEmail, passwordProblem, randomToken, verifyPassword } from './auth.ts';
import {
  MAX_ACCOUNTS,
  acceptInvite,
  accountBoardKey,
  createInvite,
  createPasswordReset,
  createSession,
  destroySession,
  getAccountByEmail,
  getInvite,
  listAccounts,
  listInvites,
  needsSetup,
  resetPassword,
  resolveSession,
  setRole,
  setStatus,
  setupAdmin,
  verifyLogin,
} from './accounts.ts';

class FakeKV {
  constructor() {
    this.store = new Map();
  }
  async get(key, type) {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value) {
    this.store.set(key, value);
  }
  async delete(key) {
    this.store.delete(key);
  }
  async list({ prefix = '', limit } = {}) {
    const names = [...this.store.keys()].filter((key) => key.startsWith(prefix)).sort();
    const page = typeof limit === 'number' ? names.slice(0, limit) : names;
    return { keys: page.map((name) => ({ name })), list_complete: true, cursor: '' };
  }
}

const freshHash = () => hashPassword('correct horse battery staple');

test('a password hashes differently each time and verifies only against itself', async () => {
  const a = await hashPassword('hunter22');
  const b = await hashPassword('hunter22');
  assert.notEqual(a, b, 'a fresh salt should change the stored hash');
  assert.equal(await verifyPassword('hunter22', a), true);
  assert.equal(await verifyPassword('hunter22', b), true);
  assert.equal(await verifyPassword('wrong-password', a), false);
});

test('verifyPassword refuses garbage instead of throwing', async () => {
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
  assert.equal(await verifyPassword('anything', 'pbkdf2$abc$not-base64!!$also-not'), false);
});

test('randomToken is URL-safe and does not repeat', () => {
  const a = randomToken();
  const b = randomToken();
  assert.notEqual(a, b);
  assert.equal(/^[A-Za-z0-9_-]+$/.test(a), true);
});

test('email and password validators reject the obvious junk', () => {
  assert.equal(isValidEmail('me@example.com'), true);
  assert.equal(isValidEmail('not an email'), false);
  assert.equal(isValidEmail(''), false);
  assert.ok(passwordProblem('short'));
  assert.equal(passwordProblem('long enough password'), null);
});

test('the first account bootstraps as admin, and only once', async () => {
  const kv = new FakeKV();
  assert.equal(await needsSetup(kv), true);

  const admin = await setupAdmin(kv, undefined, { email: 'Owner@Example.com', name: 'Owner', passwordHash: await freshHash() });
  assert.equal(admin.role, 'admin');
  assert.equal(admin.email, 'owner@example.com', 'emails are folded to lower case');
  assert.equal(await needsSetup(kv), false);

  const second = await setupAdmin(kv, undefined, { email: 'someone@else.com', name: 'Someone', passwordHash: await freshHash() });
  assert.equal(second, 'exists');
});

test('a configured ADMIN_EMAIL is the only email setup will accept', async () => {
  const kv = new FakeKV();
  const wrong = await setupAdmin(kv, 'boss@example.com', { email: 'intruder@example.com', name: 'X', passwordHash: await freshHash() });
  assert.equal(wrong, 'wrong-email');
  assert.equal(await needsSetup(kv), true, 'a rejected setup must not consume the bootstrap window');

  const right = await setupAdmin(kv, 'Boss@Example.com', { email: 'boss@example.com', name: 'Boss', passwordHash: await freshHash() });
  assert.equal(right.role, 'admin');
});

test('an invite becomes an account with the invited role, and can only be used once', async () => {
  const kv = new FakeKV();
  const admin = await setupAdmin(kv, undefined, { email: 'admin@example.com', name: 'Admin', passwordHash: await freshHash() });

  const invite = await createInvite(kv, admin.id, 'Beta@Example.com', 'member');
  assert.equal(invite.email, 'beta@example.com');
  assert.equal(invite.role, 'member');
  assert.ok(await getInvite(kv, invite.token));

  const account = await acceptInvite(kv, invite.token, { name: 'Beta Tester', passwordHash: await freshHash() });
  assert.equal(account.role, 'member');
  assert.equal(account.status, 'active');
  assert.equal(await getInvite(kv, invite.token), null, 'the invite is spent');

  const replay = await acceptInvite(kv, invite.token, { name: 'Again', passwordHash: await freshHash() });
  assert.equal(replay, 'invalid');
});

test('an invite is refused for an email that already has an account, or already has one pending', async () => {
  const kv = new FakeKV();
  const admin = await setupAdmin(kv, undefined, { email: 'admin@example.com', name: 'Admin', passwordHash: await freshHash() });

  assert.equal(await createInvite(kv, admin.id, 'admin@example.com', 'member'), 'exists');

  const first = await createInvite(kv, admin.id, 'new@example.com', 'member');
  assert.ok(first.token);
  assert.equal(await createInvite(kv, admin.id, 'new@example.com', 'member'), 'pending');
});

test('the beta cannot grow past its cap, counting pending invites too', async () => {
  const kv = new FakeKV();
  const admin = await setupAdmin(kv, undefined, { email: 'admin@example.com', name: 'Admin', passwordHash: await freshHash() });

  // The admin fills 1 seat; MAX_ACCOUNTS - 1 more invites exactly fill the rest.
  for (let i = 0; i < MAX_ACCOUNTS - 1; i++) {
    const result = await createInvite(kv, admin.id, `person${i}@example.com`, 'member');
    assert.ok(result.token, `invite ${i} should succeed`);
  }

  const overflow = await createInvite(kv, admin.id, 'one-too-many@example.com', 'member');
  assert.equal(overflow, 'full');

  const accounts = await listAccounts(kv);
  const invites = await listInvites(kv);
  assert.equal(accounts.length + invites.length, MAX_ACCOUNTS);
});

test('a session round-trips to its account, and logging out ends it', async () => {
  const kv = new FakeKV();
  const admin = await setupAdmin(kv, undefined, { email: 'admin@example.com', name: 'Admin', passwordHash: await freshHash() });

  const token = await createSession(kv, admin.id);
  const resolved = await resolveSession(kv, token);
  assert.equal(resolved?.id, admin.id);

  await destroySession(kv, token);
  assert.equal(await resolveSession(kv, token), null);
});

test('a disabled account cannot use an existing session', async () => {
  const kv = new FakeKV();
  const admin = await setupAdmin(kv, undefined, { email: 'admin@example.com', name: 'Admin', passwordHash: await freshHash() });
  const invite = await createInvite(kv, admin.id, 'member@example.com', 'member');
  const member = await acceptInvite(kv, invite.token, { name: 'Member', passwordHash: await freshHash() });

  const token = await createSession(kv, member.id);
  assert.ok(await resolveSession(kv, token));

  await setStatus(kv, member, 'disabled');
  assert.equal(await resolveSession(kv, token), null);
});

test('a password reset link changes the password and then cannot be reused', async () => {
  const kv = new FakeKV();
  const admin = await setupAdmin(kv, undefined, { email: 'admin@example.com', name: 'Admin', passwordHash: await hashPassword('old-password') });

  const token = await createPasswordReset(kv, admin.id);
  const updated = await resetPassword(kv, token, await hashPassword('new-password'));
  assert.equal(updated.id, admin.id);

  assert.equal(await verifyLogin(kv, admin.email, 'old-password'), null);
  assert.ok(await verifyLogin(kv, admin.email, 'new-password'));

  const replay = await resetPassword(kv, token, await hashPassword('another-password'));
  assert.equal(replay, 'invalid');
});

test('an unknown reset token is refused, not treated as anyone', async () => {
  const kv = new FakeKV();
  assert.equal(await resetPassword(kv, 'not-a-real-token', await freshHash()), 'invalid');
});

test('the sole admin cannot be demoted or disabled, so the beta is never left without one', async () => {
  const kv = new FakeKV();
  const admin = await setupAdmin(kv, undefined, { email: 'admin@example.com', name: 'Admin', passwordHash: await freshHash() });

  assert.equal(await setRole(kv, admin, 'member'), 'last-admin');
  assert.equal(await setStatus(kv, admin, 'disabled'), 'last-admin');

  const invite = await createInvite(kv, admin.id, 'second@example.com', 'admin');
  const secondAdmin = await acceptInvite(kv, invite.token, { name: 'Second', passwordHash: await freshHash() });

  // With two admins, stepping one down is fine.
  const demoted = await setRole(kv, admin, 'member');
  assert.equal(demoted.role, 'member');
  assert.notEqual(secondAdmin.id, demoted.id);
});

test('each account gets a distinct board key', async () => {
  const kv = new FakeKV();
  const a = await setupAdmin(kv, undefined, { email: 'a@example.com', name: 'A', passwordHash: await freshHash() });
  const invite = await createInvite(kv, a.id, 'b@example.com', 'member');
  const b = await acceptInvite(kv, invite.token, { name: 'B', passwordHash: await freshHash() });

  assert.notEqual(accountBoardKey(a.id), accountBoardKey(b.id));
});

test('logging in checks the password and returns the stored account either way', async () => {
  const kv = new FakeKV();
  await setupAdmin(kv, undefined, { email: 'admin@example.com', name: 'Admin', passwordHash: await hashPassword('right-password') });

  assert.ok(await verifyLogin(kv, 'admin@example.com', 'right-password'));
  assert.equal(await verifyLogin(kv, 'admin@example.com', 'wrong-password'), null);
  assert.equal(await verifyLogin(kv, 'nobody@example.com', 'right-password'), null);
  // Case in the email shouldn't matter — accounts are stored lower-cased.
  assert.ok(await getAccountByEmail(kv, 'ADMIN@EXAMPLE.COM'));
});
