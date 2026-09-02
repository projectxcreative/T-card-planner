import type { BillingMonth } from '../store';
import type { Client } from '../types';
import { BILLING_BUCKETS, BILLING_LABELS, STAGE_GROUP, STAGE_LABELS, formatMoney } from '../types';
import { formatMonthKey, monthChoices } from '../dates';

interface Props {
  months: BillingMonth[];
  clients: Record<string, Client>;
  /** Twelve months either side of this one, plus "not yet". */
  onMonth: (projectId: string, month: string | null) => void;
  onOpenProject: (id: string) => void;
}

const CHOICES = monthChoices(12, 12);

/**
 * What is billable, month by month.
 *
 * Grouped by the month a project is to be invoiced in rather than by when its
 * work finished, because those are routinely different months and only the
 * first one is a question anybody asks.
 */
export default function BillingView({ months, clients, onMonth, onOpenProject }: Props) {
  const billable = months.reduce((sum, month) => sum + (month.key ? month.byBucket.due.value : 0), 0);

  return (
    <div className="billing">
      <header className="billing-head">
        <h2 className="split-heading">Billing</h2>
        <span className="split-total" title="Delivered and not yet invoiced, across every month">
          {formatMoney(billable)} to invoice
        </span>
      </header>

      {months.length === 0 && (
        <p className="split-empty">
          Nothing to bill yet. A project picks up an invoice month the first time you mark it Delivered.
        </p>
      )}

      {months.map((month) => (
        <section key={month.key ?? 'none'} className={month.key ? 'billing-month' : 'billing-month is-unset'}>
          <header className="billing-month-head">
            <h3 className="billing-month-name">
              {month.key ? formatMonthKey(month.key) : 'No invoice month yet'}
            </h3>
            <span className="billing-month-count">{month.rows.length}</span>
            <span className="billing-month-total">{formatMoney(month.total)}</span>
          </header>

          {/* The month's own split. Only the buckets that have anything in
              them, so a quiet month is one line rather than four empty ones. */}
          <ul className="billing-split">
            {BILLING_BUCKETS.filter((bucket) => month.byBucket[bucket].count > 0).map((bucket) => (
              <li key={bucket} className={`billing-split-item is-${bucket}`}>
                <span className="billing-split-label">{BILLING_LABELS[bucket]}</span>
                <span className="billing-split-value">{formatMoney(month.byBucket[bucket].value)}</span>
                <span className="billing-split-count">{month.byBucket[bucket].count}</span>
              </li>
            ))}
          </ul>

          <ul className="billing-rows">
            {month.rows.map(({ project, bucket }) => {
              const client = project.clientId ? clients[project.clientId] : undefined;
              return (
                <li key={project.id} className={bucket ? `billing-row is-${bucket}` : 'billing-row is-lost'}>
                  <button type="button" className="billing-row-open" onClick={() => onOpenProject(project.id)}>
                    <span className="billing-row-title">{project.title || 'Untitled project'}</span>
                    {client && (
                      <span className="chip is-compact" style={{ '--chip': client.colour } as React.CSSProperties}>
                        {client.name}
                      </span>
                    )}
                    <span className={`stage s-stage-${STAGE_GROUP[project.stage]}`}>{STAGE_LABELS[project.stage]}</span>
                    <span className="billing-row-value">{project.value > 0 ? formatMoney(project.value) : '—'}</span>
                  </button>

                  {/* Moving a job to another month is the edit this view exists
                      for, so it happens here rather than two clicks away. */}
                  <select
                    className="billing-row-month"
                    value={project.invoiceMonth ?? ''}
                    aria-label={`Invoice month for ${project.title || 'this project'}`}
                    onChange={(event) => onMonth(project.id, event.target.value || null)}
                  >
                    <option value="">Not yet</option>
                    {CHOICES.map((key) => (
                      <option key={key} value={key}>
                        {formatMonthKey(key)}
                      </option>
                    ))}
                    {/* A month outside the window still has to show its own value. */}
                    {project.invoiceMonth && !CHOICES.includes(project.invoiceMonth) && (
                      <option value={project.invoiceMonth}>{formatMonthKey(project.invoiceMonth)}</option>
                    )}
                  </select>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
