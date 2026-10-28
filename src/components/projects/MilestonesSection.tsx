import { useEffect, useState } from 'react';
import { formatMonthKey, monthChoices, thisMonthKey } from '../../dates';
import { uid } from '../../store';
import {
  BILLING_BUCKETS,
  BILLING_LABELS,
  MILESTONE_LABEL_MAX,
  formatMoney,
  type BillingBucket,
  type Project,
  type ProjectMilestone,
} from '../../types';

const MONTH_CHOICES = monthChoices(12, 12);

interface MilestoneRowProps {
  milestone: ProjectMilestone;
  onChange: (id: string, patch: Partial<ProjectMilestone>) => void;
  onRemove: (id: string) => void;
}

function MilestoneRow({ milestone, onChange, onRemove }: MilestoneRowProps) {
  const [amountDraft, setAmountDraft] = useState(String(milestone.amount || ''));
  useEffect(() => setAmountDraft(String(milestone.amount || '')), [milestone.id]);

  return (
    <li className="expense-row milestone-row">
      <input
        className="expense-label-input"
        value={milestone.label}
        placeholder="Milestone (e.g. 50% deposit)"
        maxLength={MILESTONE_LABEL_MAX}
        aria-label="Milestone label"
        onChange={(event) => onChange(milestone.id, { label: event.target.value })}
      />
      <select
        className="billing-month-pick"
        aria-label="Milestone invoice month"
        value={milestone.invoiceMonth ?? ''}
        onChange={(event) => onChange(milestone.id, { invoiceMonth: event.target.value || null })}
      >
        <option value="">Month…</option>
        {MONTH_CHOICES.map((key) => (
          <option key={key} value={key}>
            {formatMonthKey(key)}
          </option>
        ))}
        {milestone.invoiceMonth && !MONTH_CHOICES.includes(milestone.invoiceMonth) && (
          <option value={milestone.invoiceMonth}>{formatMonthKey(milestone.invoiceMonth)}</option>
        )}
      </select>
      <select
        className={`stage-select s-stage-${milestone.status}`}
        aria-label="Milestone billing status"
        value={milestone.status}
        onChange={(event) => onChange(milestone.id, { status: event.target.value as BillingBucket })}
      >
        {BILLING_BUCKETS.map((b) => (
          <option key={b} value={b}>
            {BILLING_LABELS[b]}
          </option>
        ))}
      </select>
      <span className="money expense-money">
        <span className="money-sign" aria-hidden="true">
          £
        </span>
        <input
          type="number"
          min={0}
          step={1}
          className="money-input"
          value={amountDraft}
          aria-label="Milestone amount"
          onChange={(event) => {
            setAmountDraft(event.target.value);
            onChange(milestone.id, { amount: Math.max(0, Number(event.target.value) || 0) });
          }}
        />
      </span>
      <button
        type="button"
        className="ghost icon"
        onClick={() => onRemove(milestone.id)}
        title={`Remove ${milestone.label || 'milestone'}`}
        aria-label={`Remove ${milestone.label || 'milestone'}`}
      >
        ✕
      </button>
    </li>
  );
}

export default function MilestonesSection({
  project,
  onPatch,
}: {
  project: Project;
  onPatch: (id: string, patch: Partial<Project>) => void;
}) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [invoiceMonth, setInvoiceMonth] = useState<string>(project.invoiceMonth ?? thisMonthKey());

  const add = () => {
    const text = label.trim();
    const val = Math.max(0, Number(amount) || 0);
    if (!text || val <= 0) return;
    const next: ProjectMilestone = {
      id: uid(),
      label: text,
      amount: val,
      invoiceMonth: invoiceMonth || null,
      status: 'todo',
    };
    onPatch(project.id, { milestones: [...project.milestones, next] });
    setLabel('');
    setAmount('');
  };

  const splitFiftyFifty = () => {
    const half = Math.round((project.value / 2) * 100) / 100;
    const rest = Math.max(0, Math.round((project.value - half) * 100) / 100);
    const startMonth = project.invoiceMonth ?? thisMonthKey();
    onPatch(project.id, {
      milestones: [
        {
          id: uid(),
          label: '50% Deposit',
          amount: half,
          invoiceMonth: startMonth,
          status: 'due',
        },
        {
          id: uid(),
          label: '50% Completion',
          amount: rest,
          invoiceMonth: project.invoiceMonth,
          status: 'todo',
        },
      ],
    });
  };

  const update = (id: string, patch: Partial<ProjectMilestone>) =>
    onPatch(project.id, {
      milestones: project.milestones.map((ms) => (ms.id === id ? { ...ms, ...patch } : ms)),
    });

  const remove = (id: string) =>
    onPatch(project.id, {
      milestones: project.milestones.filter((ms) => ms.id !== id),
    });

  const milestonesTotal = project.milestones.reduce((s, ms) => s + ms.amount, 0);

  return (
    <div className="field">
      <div className="field-label-row">
        <span className="field-label">Staged billing / milestones</span>
        {project.milestones.length === 0 && project.value > 0 && (
          <button
            type="button"
            className="ghost accent timer-start-btn"
            onClick={splitFiftyFifty}
            title="Split project value into 50% Deposit and 50% Completion milestones"
          >
            Split 50/50
          </button>
        )}
      </div>
      <p className="field-note">
        Split a project across multiple invoices or months (e.g. deposit + final balance). Each milestone appears in its own month on the Billing view.
      </p>

      {project.milestones.length > 0 && (
        <ul className="expense-list">
          {project.milestones.map((ms) => (
            <MilestoneRow key={ms.id} milestone={ms} onChange={update} onRemove={remove} />
          ))}
        </ul>
      )}

      <div className="split-addcard">
        <input
          className="lane-add-input"
          value={label}
          placeholder="Milestone, e.g. 50% deposit, Phase 1"
          maxLength={MILESTONE_LABEL_MAX}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <select
          className="billing-month-pick"
          aria-label="New milestone month"
          value={invoiceMonth}
          onChange={(e) => setInvoiceMonth(e.target.value)}
        >
          <option value="">Month…</option>
          {MONTH_CHOICES.map((key) => (
            <option key={key} value={key}>
              {formatMonthKey(key)}
            </option>
          ))}
        </select>
        <span className="money expense-money">
          <span className="money-sign" aria-hidden="true">
            £
          </span>
          <input
            type="number"
            min={0}
            step={1}
            className="money-input"
            value={amount}
            placeholder="0"
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </span>
        <button type="button" className="ghost" onClick={add}>
          Add
        </button>
      </div>

      {project.milestones.length > 0 && (
        <p className="field-note">
          {formatMoney(milestonesTotal)} scheduled across {project.milestones.length} milestone
          {project.milestones.length === 1 ? '' : 's'}
          {project.value > 0 && milestonesTotal !== project.value
            ? ` (project base value is ${formatMoney(project.value)})`
            : ''}
        </p>
      )}
    </div>
  );
}
