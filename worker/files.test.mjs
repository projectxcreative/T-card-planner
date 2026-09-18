/**
 * Checks on the attachment store.
 *
 * Most of this is about what a file is allowed to be once it has been uploaded
 * by one person and is being handed back to a browser as that same person: a
 * name that can't break out of the header it sits in, a type that can't talk
 * the browser into running it, and a size that was refused before it was read.
 * None of that is visible by looking at a downloaded file, which is exactly
 * why it is worth a test. Run with `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanName, disposition, fileIdFrom, fileKey, filePrefix, handleFile, listFiles, safeName, safeType } from './files.ts';

/** Enough of a KV namespace for the handlers: values with metadata, and a
 *  listing that pages the way the real one does. */
function fakeKv(entries = []) {
  const store = new Map(entries);
  return {
    store,
    async put(key, value, options) {
      store.set(key, { value, metadata: options?.metadata });
    },
    async getWithMetadata(key) {
      const held = store.get(key);
      return held ? { value: held.value, metadata: held.metadata } : { value: null, metadata: null };
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix }) {
      const keys = [...store.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, held]) => ({ name: key, metadata: held.metadata }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

const put = (id, body, headers = {}) =>
  handleFile(new Request(`https://board.example/api/files/${id}`, { method: 'PUT', body, headers }), fakeKv(), 'board', id);

test('only an id-shaped path is a file path', () => {
  assert.equal(fileIdFrom('/api/files/abc123xyz'), 'abc123xyz');
  assert.equal(fileIdFrom('/api/files/short'), null);
  assert.equal(fileIdFrom('/api/files/has spaces'), null);
  assert.equal(fileIdFrom('/api/files/../../board'), null);
  assert.equal(fileIdFrom('/api/files/abc123/more'), null);
  assert.equal(fileIdFrom('/api/board'), null);
});

test('a board keeps its files under its own prefix', () => {
  assert.equal(filePrefix('board'), 'board:file:');
  assert.equal(fileKey('second', 'abc123xyz'), 'second:file:abc123xyz');
  // The feed's key must not fall inside the files listing.
  assert.equal('board:feed'.startsWith(filePrefix('board')), false);
});

test('a name arrives encoded and leaves harmless', () => {
  assert.equal(safeName(encodeURIComponent('Brief — v2.pdf')), 'Brief — v2.pdf');
  // A quote would end the filename= parameter early; a newline would end the
  // header. Neither survives.
  assert.equal(safeName(encodeURIComponent('a"b\nc.pdf')), 'abc.pdf');
  assert.equal(safeName(encodeURIComponent('../../etc/passwd')), '.. .. etc passwd');
  assert.equal(safeName('%E0%A4%A'), '%E0%A4%A'); // Not valid encoding; kept as typed.
  assert.equal(safeName(null), 'file');
  assert.equal(safeName(encodeURIComponent('   ')), 'file');
  assert.equal(cleanName('x'.repeat(400)).length, 120);
});

test('a type is repeated back only if it looks like one', () => {
  assert.equal(safeType('image/png'), 'image/png');
  assert.equal(safeType('text/plain; charset=utf-8'), 'text/plain');
  assert.equal(safeType('IMAGE/PNG'), 'image/png');
  assert.equal(safeType('nonsense'), 'application/octet-stream');
  assert.equal(safeType(null), 'application/octet-stream');
});

test('inert images show, everything else downloads', () => {
  assert.match(disposition('shot.png', 'image/png'), /^inline; /);
  assert.match(disposition('brief.pdf', 'application/pdf'), /^attachment; /);
  // An SVG is an image by type and a document by behaviour. It downloads.
  assert.match(disposition('logo.svg', 'image/svg+xml'), /^attachment; /);
  assert.match(disposition('page.html', 'text/html'), /^attachment; /);
});

test('a name with accents travels in both filename forms', () => {
  const header = disposition('Résumé.pdf', 'application/pdf');
  assert.match(header, /filename="R_sum_\.pdf"/);
  assert.match(header, /filename\*=UTF-8''R%C3%A9sum%C3%A9\.pdf/);
});

test('a file goes in and comes back with what it went in as', async () => {
  const kv = fakeKv();
  const stored = await handleFile(
    new Request('https://board.example/api/files/abc123xyz', {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3, 4]),
      headers: { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('shot.png') },
    }),
    kv,
    'board',
    'abc123xyz',
  );
  assert.equal(stored.status, 201);
  assert.deepEqual(kv.store.get('board:file:abc123xyz').metadata.name, 'shot.png');

  const read = await handleFile(new Request('https://board.example/api/files/abc123xyz'), kv, 'board', 'abc123xyz');
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('content-type'), 'image/png');
  assert.equal(read.headers.get('content-length'), '4');
  assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
  assert.match(read.headers.get('content-security-policy'), /sandbox/);
  assert.equal(new Uint8Array(await read.arrayBuffer()).length, 4);
});

test('an uploaded page is served as bytes, not as a page', async () => {
  const kv = fakeKv();
  await handleFile(
    new Request('https://board.example/api/files/abc123xyz', {
      method: 'PUT',
      body: '<script>alert(document.cookie)</script>',
      headers: { 'content-type': 'text/html', 'x-file-name': encodeURIComponent('sneaky.html') },
    }),
    kv,
    'board',
    'abc123xyz',
  );
  const read = await handleFile(new Request('https://board.example/api/files/abc123xyz'), kv, 'board', 'abc123xyz');
  assert.equal(read.headers.get('content-type'), 'text/html');
  assert.match(read.headers.get('content-disposition'), /^attachment; /);
  assert.match(read.headers.get('content-security-policy'), /sandbox/);
});

test('an oversized upload is refused on what it says about itself', async () => {
  const refused = await put('abc123xyz', 'x', { 'content-length': String(64 * 1024 * 1024) });
  assert.equal(refused.status, 413);
});

test('an empty upload is not a file', async () => {
  const refused = await put('abc123xyz', '');
  assert.equal(refused.status, 400);
});

test('a missing file is a 404, and a deleted one goes back to being missing', async () => {
  const kv = fakeKv();
  const missing = await handleFile(new Request('https://board.example/api/files/abc123xyz'), kv, 'board', 'abc123xyz');
  assert.equal(missing.status, 404);

  await handleFile(
    new Request('https://board.example/api/files/abc123xyz', { method: 'PUT', body: 'hello' }),
    kv,
    'board',
    'abc123xyz',
  );
  const gone = await handleFile(
    new Request('https://board.example/api/files/abc123xyz', { method: 'DELETE' }),
    kv,
    'board',
    'abc123xyz',
  );
  assert.equal(gone.status, 204);
  assert.equal(kv.store.size, 0);
});

test('a listing is metadata, and only this board’s', async () => {
  const kv = fakeKv([
    ['board:file:aaaaaaaaa', { value: new ArrayBuffer(4), metadata: { name: 'a.png', type: 'image/png', size: 4, createdAt: '2026-09-01T00:00:00.000Z' } }],
    ['second:file:bbbbbbbbb', { value: new ArrayBuffer(4), metadata: { name: 'b.png' } }],
    ['board', { value: '{}', metadata: undefined }],
    ['board:feed', { value: '{}', metadata: undefined }],
  ]);
  const listed = await listFiles(kv, 'board');
  const { files } = await listed.json();
  assert.deepEqual(files, [{ id: 'aaaaaaaaa', name: 'a.png', type: 'image/png', size: 4, createdAt: '2026-09-01T00:00:00.000Z' }]);
});
