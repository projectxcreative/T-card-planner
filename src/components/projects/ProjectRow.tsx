import { useDraggable } from '@dnd-kit/core';
import {
  PROJECT_STAGES,
  STAGE_GROUP,
  STAGE_LABELS,
  chargeableExpenses,
  formatMoney,
  projectTotal,
  type Client,
  type Project,
  type ProjectStage,
} from '../../types';
import { formatEstimate } from '../../cardText';
import type { Tally } from './ProjectStats';

interface ProjectRowProps {
  project: Project;
  group: string;
  stats: Tally;
  clients: Record<string, Client>;
  clientOrder: string[];
  selected: boolean;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<Project>) => void;
}

export default function ProjectRow({
  project,
  group,
  stats,
  clients,
  clientOrder,
  selected,
  onSelect,
  onPatch,
}: ProjectRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: project.id,
    data: { group },
  });
  const client = project.clientId ? clients[project.clientId] : undefined;
  const chargeable = chargeableExpenses(project);
  const total = projectTotal(project);
  const classes = ['proj-row', `c-${project.colour}`];
  if (selected) classes.push('is-on');

  return (
    <li
      ref={setNodeRef}
      className={classes.join(' ')}
      style={isDragging ? { opacity: 0.35 } : undefined}
    >
      <span
        {...attributes}
        {...listeners}
        className="proj-grip"
        aria-label={`Move ${project.title || 'this project'} to another group`}
        title="Drag to another group"
      />

      <button
        type="button"
        className="proj-cell is-title"
        onClick={() => onSelect(project.id)}
        title={project.title || 'Untitled project'}
      >
        {project.title || 'Untitled project'}
      </button>

      <select
        className={`proj-cell is-stage stage-select s-stage-${STAGE_GROUP[project.stage]}`}
        value={project.stage}
        aria-label={`Stage for ${project.title || 'this project'}`}
        onChange={(event) => onPatch(project.id, { stage: event.target.value as ProjectStage })}
      >
        {PROJECT_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {STAGE_LABELS[stage]}
          </option>
        ))}
      </select>

      <select
        className="proj-cell is-client"
        style={client ? ({ '--chip': client.colour } as React.CSSProperties) : undefined}
        value={project.clientId ?? ''}
        aria-label={`Client for ${project.title || 'this project'}`}
        onChange={(event) => onPatch(project.id, { clientId: event.target.value || null })}
      >
        <option value="">No client</option>
        {clientOrder.map((id) => (
          <option key={id} value={id}>
            {clients[id].name}
          </option>
        ))}
        {project.clientId && !client && <option value={project.clientId}>Unknown client</option>}
      </select>

      <span className="proj-cell is-cards proj-num" title={`${stats.done} of ${stats.cards} cards finished`}>
        {stats.cards > 0 ? (
          <>
            {stats.done}
            <span className="proj-of">/{stats.cards}</span>
          </>
        ) : (
          '—'
        )}
      </span>

      <span className="proj-cell is-hours proj-num" title="Every hour on this project's cards, finished or not">
        {formatEstimate(stats.hours) || '—'}
      </span>

      <span
        className="proj-cell is-value proj-num"
        title={
          chargeable > 0
            ? `${formatMoney(project.value)} value plus ${formatMoney(chargeable)} chargeable to the client`
            : undefined
        }
      >
        {formatMoney(total)}
      </span>
    </li>
  );
}
