import { BACKLOG, chargeableExpenses, formatMoney, projectCosts, projectTotal, type Card, type LaneId, type Project } from '../../types';
import { formatEstimate } from '../../cardText';
import { formatDayNumber } from '../../dates';

export interface Tally {
  cards: number;
  done: number;
  planned: number;
  logged: number;
  hours: number;
  unsized: number;
  first: LaneId | null;
  last: LaneId | null;
}

export function tally(entries: { card: Card; lane: LaneId }[]): Tally {
  const sums: Tally = {
    cards: entries.length,
    done: 0,
    planned: 0,
    logged: 0,
    hours: 0,
    unsized: 0,
    first: null,
    last: null,
  };
  for (const { card, lane } of entries) {
    if (card.status === 'done') {
      sums.done += 1;
      sums.logged += card.estimate;
    } else {
      sums.planned += card.estimate;
    }
    sums.hours += card.estimate;
    if (card.estimate === 0) sums.unsized += 1;
    if (lane !== BACKLOG) {
      if (!sums.first || lane < sums.first) sums.first = lane;
      if (!sums.last || lane > sums.last) sums.last = lane;
    }
  }
  return sums;
}

export default function ProjectStats({ project, stats }: { project: Project; stats: Tally }) {
  const costs = projectCosts(project);
  const chargeable = chargeableExpenses(project);
  const rate = stats.hours > 0 && project.value > 0 ? project.value / stats.hours : null;
  const progress =
    stats.hours > 0 ? stats.logged / stats.hours : stats.cards > 0 ? stats.done / stats.cards : 0;

  return (
    <div className="projstats">
      <ul className="projstats-grid">
        <li className="projstat" title={`${stats.done} of ${stats.cards} cards finished`}>
          <span className="projstat-label">Cards</span>
          <span className="projstat-value">
            {stats.done}
            <span className="projstat-of">/{stats.cards}</span>
          </span>
          <span className="projstat-note">done</span>
        </li>

        <li className="projstat" title="Hours on the cards still open">
          <span className="projstat-label">To do</span>
          <span className="projstat-value">{formatEstimate(stats.planned) || '—'}</span>
          <span className="projstat-note">{stats.cards - stats.done} open</span>
        </li>

        <li className="projstat" title="Hours on the cards already finished">
          <span className="projstat-label">Logged</span>
          <span className={stats.logged > 0 ? 'projstat-value is-on' : 'projstat-value'}>
            {formatEstimate(stats.logged) || '—'}
          </span>
          <span className="projstat-note">done</span>
        </li>

        <li className="projstat" title="Every hour on this project's cards, finished or not">
          <span className="projstat-label">Total</span>
          <span className="projstat-value">{formatEstimate(stats.hours) || '—'}</span>
          <span className="projstat-note">{stats.unsized > 0 ? `${stats.unsized} unsized` : 'estimated'}</span>
        </li>

        <li
          className="projstat"
          title={
            rate
              ? `${formatMoney(project.value)} over ${formatEstimate(stats.hours)} of work`
              : 'Give the project a value and its cards an estimate to see what it pays an hour'
          }
        >
          <span className="projstat-label">Rate</span>
          <span className="projstat-value">{rate ? `${formatMoney(Math.round(rate))}` : '—'}</span>
          <span className="projstat-note">per hour</span>
        </li>

        {costs > 0 && (
          <li
            className="projstat"
            title={`${formatMoney(project.value)} minus ${formatMoney(costs)} of project costs — chargeable expenses aren't counted, since they're recovered in full`}
          >
            <span className="projstat-label">Net</span>
            <span className="projstat-value">{formatMoney(project.value - costs)}</span>
            <span className="projstat-note">after {formatMoney(costs)} costs</span>
          </li>
        )}

        {chargeable > 0 && (
          <li
            className="projstat"
            title={`Expenses billed on to the client, recovered in full — the list totals this project at ${formatMoney(projectTotal(project))}`}
          >
            <span className="projstat-label">Billed on</span>
            <span className="projstat-value">{formatMoney(chargeable)}</span>
            <span className="projstat-note">{formatMoney(projectTotal(project))} total</span>
          </li>
        )}

        <li
          className="projstat"
          title={stats.first ? 'The first and last day this project has a card on' : 'Nothing scheduled yet'}
        >
          <span className="projstat-label">Runs</span>
          <span className="projstat-value is-small">
            {stats.first ? formatDayNumber(stats.first) : '—'}
            {stats.last && stats.last !== stats.first ? ` – ${formatDayNumber(stats.last)}` : ''}
          </span>
          <span className="projstat-note">{stats.first ? 'scheduled' : 'unscheduled'}</span>
        </li>
      </ul>

      <div className="projstats-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(progress, 1) * 100}%` }} />
      </div>
    </div>
  );
}
