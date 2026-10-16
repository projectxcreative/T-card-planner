import { useDroppable } from '@dnd-kit/core';
import { formatMoney, type Client, type Project } from '../../types';
import { formatEstimate } from '../../cardText';
import ProjectRow from './ProjectRow';
import type { Tally } from './ProjectStats';

export interface GroupSums {
  count: number;
  value: number;
  chargeable: number;
  cards: number;
  done: number;
  hours: number;
}

export interface Group {
  key: string;
  label: string;
  colour?: string;
  projects: Project[];
  sums: GroupSums;
}

interface ProjectGroupProps {
  group: Group;
  tallies: Record<string, Tally>;
  clients: Record<string, Client>;
  clientOrder: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<Project>) => void;
}

export default function ProjectGroup({
  group,
  tallies,
  clients,
  clientOrder,
  selectedId,
  onSelect,
  onPatch,
}: ProjectGroupProps) {
  const dropId = `group:${group.key}`;
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: { group: group.key },
  });

  const classes = ['proj-group'];
  if (group.key === 'archived') classes.push('is-put-away');
  if (isOver) classes.push('is-over');

  return (
    <section ref={setNodeRef} className={classes.join(' ')}>
      <header className="proj-group-head">
        {group.colour && (
          <span className="proj-group-dot" style={{ '--chip': group.colour } as React.CSSProperties} />
        )}
        <h3 className="proj-group-name">{group.label}</h3>
        <span className="proj-group-count">
          {group.sums.count} project{group.sums.count === 1 ? '' : 's'}
        </span>
      </header>

      <ul className="proj-rows">
        {group.sums.count === 0 && <li className="proj-drop-hint">Drop a project here</li>}
        {group.projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            group={group.key}
            stats={tallies[project.id]}
            clients={clients}
            clientOrder={clientOrder}
            selected={project.id === selectedId}
            onSelect={onSelect}
            onPatch={onPatch}
          />
        ))}
      </ul>

      {group.sums.count > 0 && (
        <div className="proj-group-foot">
          <span className="proj-cell is-grip" />
          <span className="proj-cell is-title">{group.label} subtotal</span>
          <span className="proj-cell is-stage" />
          <span className="proj-cell is-client" />
          <span
            className="proj-cell is-cards proj-num"
            title={`${group.sums.done} of ${group.sums.cards} cards finished`}
          >
            {group.sums.cards > 0 ? (
              <>
                {group.sums.done}
                <span className="proj-of">/{group.sums.cards}</span>
              </>
            ) : (
              '—'
            )}
          </span>
          <span className="proj-cell is-hours proj-num">{formatEstimate(group.sums.hours) || '—'}</span>
          <span
            className="proj-cell is-value proj-num"
            title={
              group.sums.chargeable > 0
                ? `${formatMoney(group.sums.value - group.sums.chargeable)} of value plus ${formatMoney(group.sums.chargeable)} chargeable to the client`
                : undefined
            }
          >
            {formatMoney(group.sums.value)}
          </span>
        </div>
      )}
    </section>
  );
}
