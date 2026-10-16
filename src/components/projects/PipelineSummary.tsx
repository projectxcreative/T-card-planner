import {
  STAGE_GROUP_LABELS,
  formatMoney,
  type StageGroup,
} from '../../types';
import { formatEstimate } from '../../cardText';

interface PipelineSummaryProps {
  pipeline: Record<StageGroup, number>;
  workload: { logged: number; hours: number };
}

export default function PipelineSummary({ pipeline, workload }: PipelineSummaryProps) {
  return (
    <ul className="totals is-tight">
      {(['prospect', 'committed', 'owed', 'banked'] as StageGroup[]).map((group) => (
        <li key={group}>
          <span className="totals-label">{STAGE_GROUP_LABELS[group]}</span>
          <span className={group === 'banked' ? 'totals-value is-done' : 'totals-value'}>
            {formatMoney(pipeline[group])}
          </span>
        </li>
      ))}
      <li className="is-hours" title="Hours logged, of every hour on a live project's cards">
        <span className="totals-label">Hours</span>
        <span className="totals-value">
          {formatEstimate(workload.logged) || '0h'}
          <span className="totals-of"> of {formatEstimate(workload.hours) || '0h'}</span>
        </span>
      </li>
    </ul>
  );
}
