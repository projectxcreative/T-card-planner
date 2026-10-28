import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { BillingMonth, BillingRow } from '../store';
import type { BillingBucket, Client } from '../types';
import {
  BILLING_BUCKETS,
  BILLING_LABELS,
  STAGE_GROUP,
  STAGE_LABELS,
  chargeableExpenses,
  formatMoney,
} from '../types';
import { formatMonthKey, monthChoices } from '../dates';

interface Props {
  months: BillingMonth[];
  clients: Record<string, Client>;
  /** Twelve months either side of this one, plus "not yet". */
  onMonth: (projectId: string, month: string | null) => void;
  onMilestoneMonth?: (projectId: string, milestoneId: string, month: string | null) => void;
  onMilestoneStatus?: (projectId: string, milestoneId: string, status: BillingBucket) => void;
  onOpenProject: (id: string) => void;
  /** The server can't be reached: moving a project to another month is paused. */
  locked?: boolean;
}

const CHOICES = monthChoices(12, 12);

/** Droppable ids carry the month so the drop can read it straight back off,
 *  including the null one — `month:` with nothing after it is "not yet". */
const dropId = (key: string | null) => `month:${key ?? ''}`;

function Row({
  row,
  children,
}: {
  row: BillingRow;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: row.rowId,
    data: {
      month: row.invoiceMonth,
      projectId: row.project.id,
      milestoneId: row.milestone?.id ?? null,
    },
  });
  return (
    <li
      ref={setNodeRef}
      className={row.bucket ? `billing-row is-${row.bucket}` : 'billing-row is-lost'}
      style={isDragging ? { opacity: 0.35 } : undefined}
    >
      {/* A grip rather than the whole row: the row holds a button and a select,
          and a drag that starts on a dropdown is a dropdown that never opens. */}
      <span
        {...attributes}
        {...listeners}
        className="billing-grip"
        aria-label={`Move ${row.project.title || 'this item'} to another month`}
        title="Drag to another month"
      />
      {children}
    </li>
  );
}

function MonthDrop({ month, children }: { month: BillingMonth; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(month.key), data: { month: month.key } });
  const classes = ['billing-month'];
  if (!month.key) classes.push('is-unset');
  if (isOver) classes.push('is-over');
  return (
    <section ref={setNodeRef} className={classes.join(' ')}>
      {children}
    </section>
  );
}

/**
 * What is billable, month by month.
 *
 * Grouped by the month a project or milestone is to be invoiced in rather than
 * by when its work finished, because those are routinely different months and
 * only the first one is a question anybody asks.
 */
export default function BillingView({
  months,
  clients,
  onMonth,
  onMilestoneMonth,
  onMilestoneStatus,
  onOpenProject,
  locked,
}: Props) {
  const billable = months.reduce((sum, month) => sum + month.byBucket.due.value, 0);
  const [dragging, setDragging] = useState<BillingRow | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const find = (rowId: string) =>
    months.flatMap((month) => month.rows).find((row) => row.rowId === rowId) ?? null;

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;
    const to = (over.data.current as { month?: string | null } | undefined)?.month ?? null;
    const activeData = active.data.current as
      | { month?: string | null; projectId?: string; milestoneId?: string | null }
      | undefined;
    const from = activeData?.month ?? null;
    if (to === from) return;
    if (activeData?.milestoneId && activeData.projectId && onMilestoneMonth) {
      onMilestoneMonth(activeData.projectId, activeData.milestoneId, to);
    } else if (activeData?.projectId) {
      onMonth(activeData.projectId, to);
    } else {
      onMonth(String(active.id), to);
    }
  };

  return (
    <DndContext
      sensors={locked ? [] : sensors}
      onDragStart={(event: DragStartEvent) => setDragging(find(String(event.active.id)))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="billing">
        <header className="billing-head">
          <h2 className="split-heading">Billing</h2>
          <span className="split-total" title="Delivered and not yet invoiced, across every month including the unassigned">
            {formatMoney(billable)} to invoice
          </span>
        </header>

        {months.length === 0 && (
          <p className="split-empty">
            Nothing to bill yet. A project picks up an invoice month the first time you mark it Delivered, or when you add billing milestones.
          </p>
        )}

        {months.map((month) => (
          <MonthDrop key={month.key ?? 'none'} month={month}>
            <header className="billing-month-head">
              <h3 className="billing-month-name">
                {month.key ? formatMonthKey(month.key) : 'No invoice month yet'}
              </h3>
              <span className="billing-month-count">{month.rows.length}</span>
              <span className="billing-month-total">{formatMoney(month.total)}</span>
            </header>

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
              {month.rows.map((row) => {
                const { project, milestone, amount, invoiceMonth } = row;
                const client = project.clientId ? clients[project.clientId] : undefined;
                return (
                  <Row key={row.rowId} row={row}>
                    <button type="button" className="billing-row-open" onClick={() => onOpenProject(project.id)}>
                      <span className="billing-row-title">
                        {project.title || 'Untitled project'}
                        {milestone && (
                          <span className="billing-milestone-tag">
                            {milestone.label || 'Milestone'}
                          </span>
                        )}
                      </span>
                      {client && (
                        <span className="chip is-compact" style={{ '--chip': client.colour } as React.CSSProperties}>
                          {client.name}
                        </span>
                      )}
                      {!milestone && (
                        <span className={`stage s-stage-${STAGE_GROUP[project.stage]}`}>
                          {STAGE_LABELS[project.stage]}
                        </span>
                      )}
                      <span
                        className="billing-row-value"
                        title={
                          !milestone && chargeableExpenses(project) > 0
                            ? `${formatMoney(project.value)} value plus ${formatMoney(chargeableExpenses(project))} chargeable to the client`
                            : undefined
                        }
                      >
                        {amount > 0 ? formatMoney(amount) : '—'}
                      </span>
                    </button>

                    {milestone && onMilestoneStatus && (
                      <select
                        className={`stage-select s-stage-${milestone.status} billing-ms-status`}
                        value={milestone.status}
                        disabled={locked}
                        aria-label={`Billing status for ${milestone.label || 'milestone'}`}
                        onChange={(event) =>
                          onMilestoneStatus(project.id, milestone.id, event.target.value as BillingBucket)
                        }
                      >
                        {BILLING_BUCKETS.map((b) => (
                          <option key={b} value={b}>
                            {BILLING_LABELS[b]}
                          </option>
                        ))}
                      </select>
                    )}

                    <select
                      className="billing-row-month"
                      value={invoiceMonth ?? ''}
                      disabled={locked}
                      aria-label={`Invoice month for ${project.title || 'this project'}`}
                      onChange={(event) => {
                        const nextMonth = event.target.value || null;
                        if (milestone && onMilestoneMonth) {
                          onMilestoneMonth(project.id, milestone.id, nextMonth);
                        } else {
                          onMonth(project.id, nextMonth);
                        }
                      }}
                    >
                      <option value="">Not yet</option>
                      {CHOICES.map((key) => (
                        <option key={key} value={key}>
                          {formatMonthKey(key)}
                        </option>
                      ))}
                      {invoiceMonth && !CHOICES.includes(invoiceMonth) && (
                        <option value={invoiceMonth}>{formatMonthKey(invoiceMonth)}</option>
                      )}
                    </select>
                  </Row>
                );
              })}
            </ul>
          </MonthDrop>
        ))}

        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {dragging ? (
            <span className="billing-ghost">
              {dragging.project.title || 'Untitled project'}
              {dragging.milestone ? ` · ${dragging.milestone.label}` : ''}
              <strong>{dragging.amount > 0 ? formatMoney(dragging.amount) : '—'}</strong>
            </span>
          ) : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
