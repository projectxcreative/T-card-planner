import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingMonths,
  emptyBoard,
  newCard,
  newCardUpdate,
  newProject,
  normalise,
  pastUnfinishedCards,
  reducer,
  syncTimelineUpdates,
} from '../src/store.ts';
import { cardLoggedHours, projectNet, projectTotal } from '../src/types.ts';

test('rolloverPast moves unfinished cards from past days into Today above done cards', () => {
  let state = emptyBoard();
  const pastCard = newCard('Unfinished yesterday', { id: 'c1', status: 'doing' });
  const pastDone = newCard('Finished yesterday', { id: 'c2', status: 'done' });
  const todayTodo = newCard('Today task', { id: 'c3', status: 'todo' });
  const todayDone = newCard('Today finished', { id: 'c4', status: 'done' });

  state = reducer(state, { type: 'add', lane: '2026-04-10', card: pastCard });
  state = reducer(state, { type: 'add', lane: '2026-04-10', card: pastDone });
  state = reducer(state, { type: 'add', lane: '2026-04-12', card: todayTodo });
  state = reducer(state, { type: 'add', lane: '2026-04-12', card: todayDone });

  const unfinished = pastUnfinishedCards(state, '2026-04-12');
  assert.equal(unfinished.length, 1);
  assert.equal(unfinished[0].card.id, 'c1');

  const rolled = reducer(state, { type: 'rolloverPast', today: '2026-04-12' });
  assert.deepEqual(rolled.lanes['2026-04-10'], ['c2']);
  assert.deepEqual(rolled.lanes['2026-04-12'], ['c3', 'c1', 'c4']);
});

test('cardLoggedHours prefers logged CardUpdate minutes, timeline placement, and falls back to estimate when done', () => {
  const c1 = newCard('With updates', {
    status: 'doing',
    estimate: 4,
    updates: [newCardUpdate('build', 90, 'Morning session', '2026-04-12')],
  });
  assert.equal(cardLoggedHours(c1), 1.5);

  const c2 = newCard('Done without updates', {
    status: 'done',
    estimate: 2.5,
  });
  assert.equal(cardLoggedHours(c2), 2.5);

  const c3 = newCard('Placed on timeline', {
    status: 'todo',
    start: 600,
    estimate: 1.25,
  });
  assert.equal(cardLoggedHours(c3), 1.25);

  const synced = syncTimelineUpdates(c3, 105, '2026-04-12', 'capture');
  assert.equal(synced.length, 1);
  assert.equal(synced[0].minutes, 105);
  assert.equal(cardLoggedHours({ ...c3, updates: synced }), 1.75);
});

test('staged billing milestones split projects across invoice months in billingMonths', () => {
  let state = emptyBoard();
  const proj = newProject('Website Rebuild', {
    id: 'p1',
    value: 5000,
    budgetHours: 50,
    stage: 'active',
    milestones: [
      { id: 'm1', label: '50% Deposit', amount: 2500, invoiceMonth: '2026-04', status: 'paid' },
      { id: 'm2', label: '50% Launch', amount: 2500, invoiceMonth: '2026-05', status: 'due' },
    ],
    expenses: [
      { id: 'e1', label: 'Font licence', amount: 150, chargeable: true },
      { id: 'e2', label: 'Subcontractor', amount: 400, chargeable: false },
    ],
  });
  state = reducer(state, { type: 'addProject', project: proj });

  assert.equal(projectTotal(proj), 5150);
  assert.equal(projectNet(proj), 4600);

  const months = billingMonths(state);
  assert.equal(months.length, 2);
  const may = months.find((m) => m.key === '2026-05');
  const apr = months.find((m) => m.key === '2026-04');
  assert.ok(may);
  assert.ok(apr);
  assert.equal(apr.byBucket.paid.value, 2650);
  assert.equal(may.byBucket.due.value, 2500);
});

test('normalise preserves dueDate, assigneeId, budgetHours, milestones, and update dates', () => {
  const raw = {
    cards: {
      c1: {
        id: 'c1',
        title: 'Design system',
        dueDate: '2026-04-20',
        assigneeId: 'user-1',
        updates: [{ id: 'u1', categoryId: 'design', minutes: 45, note: 'Wireframes', date: '2026-04-14' }],
      },
    },
    projects: {
      p1: {
        id: 'p1',
        title: 'Brand identity',
        value: 3000,
        budgetHours: 30,
        milestones: [{ id: 'ms1', label: 'Deposit', amount: 1500, invoiceMonth: '2026-04', status: 'sent' }],
      },
    },
  };

  const state = normalise(raw);
  assert.equal(state.cards.c1.dueDate, '2026-04-20');
  assert.equal(state.cards.c1.assigneeId, 'user-1');
  assert.equal(state.cards.c1.updates[0].date, '2026-04-14');
  assert.equal(state.projects.p1.budgetHours, 30);
  assert.equal(state.projects.p1.milestones.length, 1);
  assert.equal(state.projects.p1.milestones[0].status, 'sent');
});
