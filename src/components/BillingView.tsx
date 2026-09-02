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
import type { BillingMonth } from '../store';
import type { BillingBucket, Client, Project } from '../types';
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

/** Droppable ids carry the month so the drop can read it straight back off,
 *  including the null one — `month:` with nothing after it is "not yet". */
const dropId = (key: string | null) => `month:${key ?? ''}`;

function Row({ project, bucket, children }: { project: Project; bucket: BillingBucket | null; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: project.id,
    data: { month: project.invoiceMonth },
  });
  return (
    <li
      ref={setNodeRef}
      className={bucket ? `billing-row is-${bucket}` : 'billing-row is-lost'}
      style={isDragging ? { opacity: 0.35 } : undefined}
    >
      {/* A grip rather than the whole row: the row holds a button and a select,
          and a drag that starts on a dropdown is a dropdown that never opens. */}
      <span
        {...attributes}
        {...listeners}
        className="billing-grip"
        aria-label={`Move ${project.title || 'this project'} to another month`}
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
 * Grouped by the month a project is to be invoiced in rather than by when its
 * work finished, because those are routinely different months and only the
 * first one is a question anybody asks.
 */
export default function BillingView({ months, clients, onMonth, onOpenProject }: Props) {
  // Every month, the unassigned group included: work that is delivered and not
  // yet billed is exactly what this number is for, and a job still waiting to be
  // given a month is the most in need of the attention, not the least.
  const billable = months.reduce((sum, month) => sum + month.byBucket.due.value, 0);
  const [dragging, setDragging] = useState<Project | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const find = (id: string) =>
    months.flatMap((month) => month.rows).find((row) => row.project.id === id)?.project ?? null;

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;
    const to = (over.data.current as { month?: string | null } | undefined)?.month ?? null;
    const from = (active.data.current as { month?: string | null } | undefined)?.month ?? null;
    // Dropping a job back where it already was is not an edit.
    if (to === from) return;
    onMonth(String(active.id), to);
  };

  return (
    <DndContext
      sensors={sensors}
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
          Nothing to bill yet. A project picks up an invoice month the first time you mark it Delivered.
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
                <Row key={project.id} project={project} bucket={bucket}>
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
                </Row>
              );
            })}
          </ul>
        </MonthDrop>
      ))}

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
        {dragging ? (
          <span className="billing-ghost">
            {dragging.title || 'Untitled project'}
            <strong>{dragging.value > 0 ? formatMoney(dragging.value) : '—'}</strong>
          </span>
        ) : null}
      </DragOverlay>
    </div>
    </DndContext>
  );
}
