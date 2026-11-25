// Run with: node --test src/backend/boardRows.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardToRows, diffRows, emptyRows, indexRows, isEmptyChange, rowsToBoard } from './boardRows.ts';

// The import fixture, with the gaps the store's normalise() would fill in.
const fixture = () => {
  const board = JSON.parse(readFileSync(new URL('../../supabase/tests/fixtures/board.json', import.meta.url), 'utf8'));
  board.projects.pr1.milestones[0].id = 'm1';
  for (const card of Object.values(board.cards) as Record<string, unknown>[]) {
    card.description ??= '';
    card.estimate ??= 0;
    card.start ??= null;
    card.dueDate ??= null;
    card.projectId ??= null;
    card.publish ??= false;
    card.eventId ??= null;
    card.updates ??= [];
    card.attachments ??= [];
    card.createdAt ??= '2026-11-01T00:00:00Z';
    card.updatedAt ??= '2026-11-01T00:00:00Z';
  }
  return board;
};

test('a fresh board turns into rows for every table it uses', () => {
  const rows = boardToRows(fixture());
  assert.equal(rows.cards.size, 3);
  assert.equal(rows.clients.size, 2);
  assert.equal(rows.cards.get('k1')!.client_id, 'cl2', 'first existing client owns the card');
  assert.equal(rows.cards.get('k1')!.lane, '2026-11-25');
  assert.equal(rows.cards.get('k3')!.lane, 'backlog', 'a card in no valid lane lands in the backlog');
  assert.equal(rows.card_tags.size, 1);
  assert.equal(rows.cards.get('k1')!.client_visible, false, 'nothing is shared by default');
});

test('rows -> board -> rows is stable, so a load followed by a save writes nothing', () => {
  const first = boardToRows(fixture());
  const board = rowsToBoard(first);
  const again = boardToRows(board, first);
  assert.ok(isEmptyChange(diffRows(first, again)), JSON.stringify(diffRows(first, again)));
});

test('moving one card writes only that card', () => {
  const before = boardToRows(fixture());
  const board = rowsToBoard(before);
  board.lanes['2026-11-25'] = [];
  board.lanes.backlog = ['k1', ...board.lanes.backlog];
  const changes = diffRows(before, boardToRows(board, before));
  const cardWrites = changes.upserts.find((u) => u.table === 'cards')!.rows.map((r) => r.id).sort();
  // k1 moved; the backlog cards after it shift down one place.
  assert.deepEqual(cardWrites, ['k1', 'k2', 'k3']);
  assert.equal(changes.deletes.length, 0);
});

test('deleting a card deletes its row and keeps everything else', () => {
  const before = boardToRows(fixture());
  const board = rowsToBoard(before);
  delete board.cards.k2;
  board.lanes.backlog = board.lanes.backlog.filter((id) => id !== 'k2');
  const changes = diffRows(before, boardToRows(board, before));
  assert.deepEqual(changes.deletes, [{ table: 'cards', keys: ['k2'] }]);
});

test('sharing set in the database survives a save from the board', () => {
  const loaded = boardToRows(fixture());
  loaded.cards.set('k1', { ...loaded.cards.get('k1')!, client_visible: true });
  const attachment = loaded.attachments.get('att_0001')!;
  loaded.attachments.set('att_0001', { ...attachment, storage_path: 'kept/path.pdf', client_visible: true });
  const board = rowsToBoard(loaded);
  board.cards.k1.title = 'Renamed';
  const next = boardToRows(board, loaded);
  assert.equal(next.cards.get('k1')!.client_visible, true);
  assert.equal(next.attachments.get('att_0001')!.storage_path, 'kept/path.pdf');
  const changes = diffRows(loaded, next);
  assert.deepEqual(changes.upserts.map((u) => u.table), ['cards']);
});

test('a card that loses its last client stops being shared', () => {
  const loaded = boardToRows(fixture());
  loaded.cards.set('k3', { ...loaded.cards.get('k3')!, client_visible: false });
  const board = rowsToBoard(loaded);
  board.cards.k1.clients = [];
  board.cards.k1.projectId = null;
  const next = boardToRows(board, loaded);
  assert.equal(next.cards.get('k1')!.client_id, null);
  assert.equal(next.cards.get('k1')!.client_visible, false);
});

test('indexRows groups fetched rows by primary key', () => {
  const rows = indexRows({ card_tags: [{ card_id: 'a', client_id: 'b' }], cards: [{ id: 'a' }] });
  assert.ok(rows.card_tags.has('a:b'));
  assert.ok(rows.cards.has('a'));
  assert.equal(emptyRows().cards.size, 0);
});
