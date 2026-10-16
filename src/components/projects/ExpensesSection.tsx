import { useEffect, useState } from 'react';
import { uid } from '../../store';
import {
  EXPENSE_LABEL_MAX,
  chargeableExpenses,
  formatMoney,
  projectCosts,
  type Expense,
  type Project,
} from '../../types';

interface ExpenseRowProps {
  expense: Expense;
  onChange: (id: string, patch: Partial<Expense>) => void;
  onRemove: (id: string) => void;
}

export function ExpenseRow({ expense, onChange, onRemove }: ExpenseRowProps) {
  const [amountDraft, setAmountDraft] = useState(String(expense.amount || ''));
  useEffect(() => setAmountDraft(String(expense.amount || '')), [expense.id]);

  return (
    <li className="expense-row">
      <input
        className="expense-label-input"
        value={expense.label}
        placeholder="Expense"
        maxLength={EXPENSE_LABEL_MAX}
        aria-label="Expense label"
        onChange={(event) => onChange(expense.id, { label: event.target.value })}
      />
      <label className="expense-toggle" title="Billed on to the client and recovered in full">
        <input
          type="checkbox"
          checked={expense.chargeable}
          onChange={(event) => onChange(expense.id, { chargeable: event.target.checked })}
        />
        Chargeable
      </label>
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
          aria-label="Expense amount"
          onChange={(event) => {
            setAmountDraft(event.target.value);
            onChange(expense.id, { amount: Math.max(0, Number(event.target.value) || 0) });
          }}
        />
      </span>
      <button
        type="button"
        className="ghost icon"
        onClick={() => onRemove(expense.id)}
        title={`Remove ${expense.label || 'this expense'}`}
        aria-label={`Remove ${expense.label || 'this expense'}`}
      >
        ✕
      </button>
    </li>
  );
}

interface ExpensesSectionProps {
  project: Project;
  onPatch: (id: string, patch: Partial<Project>) => void;
}

export default function ExpensesSection({ project, onPatch }: ExpensesSectionProps) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [chargeable, setChargeable] = useState(false);

  const add = () => {
    const text = label.trim();
    const value = Math.max(0, Number(amount) || 0);
    if (!text || value <= 0) return;
    onPatch(project.id, {
      expenses: [...project.expenses, { id: uid(), label: text, amount: value, chargeable }],
    });
    setLabel('');
    setAmount('');
    setChargeable(false);
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    add();
  };

  const update = (id: string, patch: Partial<Expense>) =>
    onPatch(project.id, {
      expenses: project.expenses.map((expense) => (expense.id === id ? { ...expense, ...patch } : expense)),
    });

  const remove = (id: string) =>
    onPatch(project.id, {
      expenses: project.expenses.filter((expense) => expense.id !== id),
    });

  const costs = projectCosts(project);
  const chargeableTotal = chargeableExpenses(project);
  const summary = [
    costs > 0 && `${formatMoney(costs)} in project costs`,
    chargeableTotal > 0 && `${formatMoney(chargeableTotal)} chargeable to the client`,
    (costs > 0 || chargeableTotal > 0) && `${formatMoney(project.value - costs)} net`,
  ].filter(Boolean);

  return (
    <div className="field">
      <span className="field-label">Expenses</span>
      <p className="field-note">
        Tick “Chargeable” for a cost billed on to the client and recovered in full — leave it unticked for a project
        cost, which comes off the project's net.
      </p>

      <ul className="expense-list">
        {project.expenses.length === 0 && <li className="split-empty">No expenses on this project yet.</li>}
        {project.expenses.map((expense) => (
          <ExpenseRow key={expense.id} expense={expense} onChange={update} onRemove={remove} />
        ))}
      </ul>

      <div className="split-addcard">
        <input
          className="lane-add-input"
          value={label}
          placeholder="Expense, e.g. props, travel, freelancer"
          maxLength={EXPENSE_LABEL_MAX}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={onKey}
        />
        <label className="expense-toggle" title="Billed on to the client and recovered in full">
          <input type="checkbox" checked={chargeable} onChange={(event) => setChargeable(event.target.checked)} />
          Chargeable
        </label>
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
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={onKey}
          />
        </span>
        <button type="button" className="ghost" onClick={add}>
          Add
        </button>
      </div>

      {summary.length > 0 && <p className="field-note">{summary.join(' · ')}</p>}
    </div>
  );
}
