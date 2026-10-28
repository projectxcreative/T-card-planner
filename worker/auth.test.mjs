import test from 'node:test';
import assert from 'node:assert/strict';

import {
  accessibleWorkspaces,
  canAccessWorkspace,
  createSession,
  extractSessionToken,
  hashPassword,
  verifyPassword,
  verifySession,
  writeUsers,
} from './auth.ts';
import worker from './index.ts';

function mockKv() {
  const store = new Map();
  return {
    async get(key, type) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '' } = {}) {
      const keys = [];
      for (const k of store.keys()) {
        if (k.startsWith(prefix)) keys.push({ name: k });
      }
      return { keys, list_complete: true };
    },
  };
}

test('PBKDF2 password hashing verifies matching passwords and rejects wrong ones', async () => {
  const { salt, hash } = await hashPassword('CorrectHorseBatteryStaple');
  assert.equal(await verifyPassword('CorrectHorseBatteryStaple', salt, hash), true);
  assert.equal(await verifyPassword('WrongPassword', salt, hash), false);
});

test('sessions can be created and verified via cookie or bearer header', async () => {
  const kv = mockKv();
  const { salt, hash: passwordHash } = await hashPassword('secret123');
  const user = {
    id: 'u1',
    email: 'ben@example.com',
    name: 'Ben',
    role: 'admin',
    colour: '#2179c8',
    salt,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  await writeUsers(kv, { u1: user });
  const session = await createSession(kv, 'u1');

  const reqCookie = new Request('https://planner.example.com/api/session', {
    headers: { cookie: `tcard_session=${session.token}` },
  });
  assert.equal(extractSessionToken(reqCookie), session.token);
  const verifiedCookie = await verifySession(reqCookie, kv);
  assert.equal(verifiedCookie?.user.email, 'ben@example.com');

  const reqBearer = new Request('https://planner.example.com/api/session', {
    headers: { authorization: `Bearer ${session.token}` },
  });
  const verifiedBearer = await verifySession(reqBearer, kv);
  assert.equal(verifiedBearer?.user.id, 'u1');
});

test('end-to-end setup, login, user creation, and workspace isolation on the Worker', async () => {
  const env = {
    BOARD: mockKv(),
    ASSETS: { fetch: async () => new Response('app html', { headers: { 'content-type': 'text/html' } }) },
  };

  // 1. Before setup, /api/session reports setupRequired: true
  const s0 = await (await worker.fetch(new Request('https://app.local/api/session'), env)).json();
  assert.equal(s0.setupRequired, true);
  assert.equal(s0.signedIn, false);

  // 2. Setup first admin user
  const setupRes = await worker.fetch(
    new Request('https://app.local/api/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: 'password123' }),
    }),
    env,
  );
  assert.equal(setupRes.status, 200);
  const setupData = await setupRes.json();
  assert.equal(setupData.user.role, 'admin');
  assert.equal(setupData.workspaces.length, 2); // Team Board + Personal Board

  const adminToken = setupData.sessionToken;
  const personalWs = setupData.workspaces.find((w) => w.kind === 'personal');
  assert.ok(personalWs);

  // 3. Save a board to Team workspace ('default') and a different board to Personal workspace
  await worker.fetch(
    new Request('https://app.local/api/board', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-workspace-id': 'default',
      },
      body: JSON.stringify({ rev: 0, board: { cards: { c1: { id: 'c1', title: 'Team card' } } } }),
    }),
    env,
  );

  await worker.fetch(
    new Request('https://app.local/api/board', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-workspace-id': personalWs.id,
      },
      body: JSON.stringify({ rev: 0, board: { cards: { c2: { id: 'c2', title: 'Personal card' } } } }),
    }),
    env,
  );

  const teamBoard = await (
    await worker.fetch(
      new Request('https://app.local/api/board', {
        headers: { authorization: `Bearer ${adminToken}`, 'x-workspace-id': 'default' },
      }),
      env,
    )
  ).json();
  assert.ok(teamBoard.board.cards.c1);
  assert.equal(teamBoard.board.cards.c2, undefined);

  const personalBoard = await (
    await worker.fetch(
      new Request('https://app.local/api/board', {
        headers: { authorization: `Bearer ${adminToken}`, 'x-workspace-id': personalWs.id },
      }),
      env,
    )
  ).json();
  assert.ok(personalBoard.board.cards.c2);
  assert.equal(personalBoard.board.cards.c1, undefined);

  // 4. Admin creates a second member user
  const createMemberRes = await worker.fetch(
    new Request('https://app.local/api/users', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'member@example.com', name: 'Member', password: 'memberpass', role: 'member' }),
    }),
    env,
  );
  assert.equal(createMemberRes.status, 200);

  // 5. Member logs in and cannot read Admin's personal workspace, but can read Team Board
  const loginRes = await worker.fetch(
    new Request('https://app.local/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member@example.com', password: 'memberpass' }),
    }),
    env,
  );
  assert.equal(loginRes.status, 200);
  const memberData = await loginRes.json();
  const memberToken = memberData.sessionToken;

  const forbiddenRes = await worker.fetch(
    new Request('https://app.local/api/board', {
      headers: { authorization: `Bearer ${memberToken}`, 'x-workspace-id': personalWs.id },
    }),
    env,
  );
  assert.equal(forbiddenRes.status, 403);

  const allowedTeamRes = await worker.fetch(
    new Request('https://app.local/api/board', {
      headers: { authorization: `Bearer ${memberToken}`, 'x-workspace-id': 'default' },
    }),
    env,
  );
  assert.equal(allowedTeamRes.status, 200);
});

test('workspace permissions respect roles and ownership', () => {
  const admin = { id: 'u1', email: 'a@b.c', name: 'A', role: 'admin', colour: '#000', createdAt: '' };
  const member = { id: 'u2', email: 'm@b.c', name: 'M', role: 'member', colour: '#000', createdAt: '' };
  const workspaces = {
    default: { id: 'default', name: 'Team', kind: 'team', ownerId: null, memberIds: ['*'], boardKey: 'board', createdAt: '' },
    p1: { id: 'p1', name: 'A Personal', kind: 'personal', ownerId: 'u1', memberIds: ['u1'], boardKey: 'ws:p1', createdAt: '' },
    p2: { id: 'p2', name: 'M Personal', kind: 'personal', ownerId: 'u2', memberIds: ['u2'], boardKey: 'ws:p2', createdAt: '' },
  };
  assert.equal(canAccessWorkspace(member, workspaces.default), true);
  assert.equal(canAccessWorkspace(member, workspaces.p1), false);
  assert.equal(canAccessWorkspace(member, workspaces.p2), true);
  assert.equal(accessibleWorkspaces(member, workspaces).length, 2);
  assert.equal(accessibleWorkspaces(admin, workspaces).length, 3);
});
