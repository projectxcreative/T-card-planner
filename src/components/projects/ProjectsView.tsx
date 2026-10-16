import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  PROJECT_STAGES,
  STAGE_GROUP,
  STAGE_LABELS,
  chargeableExpenses,
  formatMoney,
  projectTotal,
  type Card,
  type LaneId,
  type Project,
  type ProjectStage,
  type StageGroup,
} from '../../types';
import { useLookups } from '../../lookups';
import PipelineSummary from './PipelineSummary';
import ProjectGroup, { type Group, type GroupSums } from './ProjectGroup';
import ProjectDetail from './ProjectDetail';
import { tally, type Tally } from './ProjectStats';
import {
  useAttachableCards,
  useBoard,
  useBoardActions,
  useCardsOfProject,
  useProjectList,
} from '../../store/boardStore';
import { useUIActions, useUIStore } from '../../store/uiStore';

type GroupBy = 'stage' | 'client';
const GROUP_LABELS: Record<GroupBy, string> = { stage: 'stage', client: 'client' };
const NO_CLIENT = 'none';
const ARCHIVED = 'archived';
const GROUP_KEY = 'tcard-planner.projects.groupby';

function readGroupBy(): GroupBy {
  try {
    return localStorage.getItem(GROUP_KEY) === 'client' ? 'client' : 'stage';
  } catch {
    return 'stage';
  }
}

export interface ProjectsViewProps {
  projects?: Project[];
  cardsOf?: (projectId: string) => { card: Card; lane: LaneId }[];
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onCreate?: (title: string) => void;
  onPatch?: (id: string, patch: Partial<Project>) => void;
  onDelete?: (id: string) => void;
  onOpenCard?: (id: string) => void;
  onAddCard?: (projectId: string, title: string, day: LaneId) => void;
  onMoveCard?: (id: string, lane: LaneId) => void;
  attachable?: (projectId: string) => { card: Card; lane: LaneId }[];
  onAttachCard?: (cardId: string, projectId: string) => void;
}

export default function ProjectsView(props: ProjectsViewProps) {
  // Direct store hook bindings with fallback to props
  const storeProjects = useProjectList();
  const boardActions = useBoardActions();
  const storeSelected = useUIStore((s) => s.openProjectId);
  const uiActions = useUIActions();

  const projects = props.projects ?? storeProjects;
  const selected = props.selected !== undefined ? props.selected : storeSelected;
  const onSelect = props.onSelect ?? uiActions.setOpenProjectId;
  const onPatch = props.onPatch ?? boardActions.patchProject;
  const onDelete = props.onDelete ?? boardActions.deleteProject;
  const onOpenCard = props.onOpenCard ?? uiActions.setOpenCardId;
  const onAddCard =
    props.onAddCard ??
    ((pId, title, day) => boardActions.addProjectCard(pId, title, day, 'slate'));
  const onMoveCard = props.onMoveCard ?? boardActions.moveCard;
  const onAttachCard = props.onAttachCard ?? boardActions.attachProjectCard;

  const { clients, clientOrder } = useLookups();
  const board = useBoard((b) => b);

  const cardsOf =
    props.cardsOf ??
    ((pId: string) => {
      const found: { card: Card; lane: LaneId }[] = [];
      for (const [lane, ids] of Object.entries(board.lanes)) {
        for (const id of ids) {
          const card = board.cards[id];
          if (card && card.projectId === pId) found.push({ card, lane });
        }
      }
      return found;
    });

  const attachable =
    props.attachable ??
    ((pId: string) => {
      const found: { card: Card; lane: LaneId }[] = [];
      for (const [lane, ids] of Object.entries(board.lanes)) {
        for (const id of ids) {
          const card = board.cards[id];
          if (card && card.projectId !== pId) found.push({ card, lane });
        }
      }
      return found;
    });

  const [newTitle, setNewTitle] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>(readGroupBy);
  const [dragging, setDragging] = useState<Project | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(GROUP_KEY, groupBy);
    } catch {
      // Ignore storage errors
    }
  }, [groupBy]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const active = selected ? projects.find((project) => project.id === selected) ?? null : null;
  const cards = useMemo(() => (active ? cardsOf(active.id) : []), [active, cardsOf]);
  const spare = useMemo(() => (active ? attachable(active.id) : []), [active, attachable]);
  const byId = useMemo(
    () => Object.fromEntries(projects.map((project) => [project.id, project])),
    [projects],
  );

  const tallies = useMemo(() => {
    const out: Record<string, Tally> = {};
    for (const project of projects) out[project.id] = tally(cardsOf(project.id));
    return out;
  }, [projects, cardsOf]);

  const stats = active ? tallies[active.id] ?? tally(cards) : null;

  const workload = useMemo(() => {
    let logged = 0;
    let hours = 0;
    for (const project of projects) {
      if (project.archived) continue;
      const sums = tallies[project.id];
      if (!sums) continue;
      logged += sums.logged;
      hours += sums.hours;
    }
    return { logged, hours };
  }, [projects, tallies]);

  const pipeline = useMemo(() => {
    const sums = { prospect: 0, committed: 0, owed: 0, banked: 0, lost: 0 } as Record<
      StageGroup,
      number
    >;
    for (const project of projects) {
      if (project.archived) continue;
      sums[STAGE_GROUP[project.stage]] += projectTotal(project);
    }
    return sums;
  }, [projects]);

  const groups = useMemo<Group[]>(() => {
    const heads: { key: string; label: string; colour?: string }[] =
      groupBy === 'stage'
        ? PROJECT_STAGES.map((stage) => ({ key: stage, label: STAGE_LABELS[stage] }))
        : [
            ...clientOrder.map((id) => ({
              key: id,
              label: clients[id]?.name ?? 'Client',
              colour: clients[id]?.colour,
            })),
            { key: NO_CLIENT, label: 'No client' },
          ];
    heads.push({ key: ARCHIVED, label: 'Archived' });

    const rows = new Map<string, Project[]>(heads.map((head) => [head.key, []]));
    for (const project of projects) {
      const key = project.archived
        ? ARCHIVED
        : groupBy === 'stage'
          ? project.stage
          : project.clientId && clients[project.clientId]
            ? project.clientId
            : NO_CLIENT;
      rows.get(key)?.push(project);
    }

    return heads.map((head) => {
      const own = rows.get(head.key) ?? [];
      const sums: GroupSums = { count: own.length, value: 0, chargeable: 0, cards: 0, done: 0, hours: 0 };
      for (const project of own) {
        sums.value += projectTotal(project);
        sums.chargeable += chargeableExpenses(project);
        const st = tallies[project.id];
        if (!st) continue;
        sums.cards += st.cards;
        sums.done += st.done;
        sums.hours += st.hours;
      }
      return { ...head, projects: own, sums };
    });
  }, [projects, groupBy, clients, clientOrder, tallies]);

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active: dndActive, over } = event;
    if (!over) return;
    const to = (over.data.current as { group?: string } | undefined)?.group;
    const from = (dndActive.data.current as { group?: string } | undefined)?.group;
    if (!to || to === from) return;

    const id = String(dndActive.id);
    const project = projects.find((row) => row.id === id);
    const patch: Partial<Project> =
      to === ARCHIVED
        ? { archived: true }
        : groupBy === 'stage'
          ? { stage: to as ProjectStage }
          : { clientId: to === NO_CLIENT ? null : to };
    if (to !== ARCHIVED && project?.archived) patch.archived = false;
    onPatch(id, patch);
  };

  const create = () => {
    const title = newTitle.trim();
    if (!title) return;
    if (props.onCreate) {
      props.onCreate(title);
    } else {
      const created = boardActions.createProject(title, 'slate');
      onSelect(created.id);
    }
    setNewTitle('');
  };

  return (
    <div className="proj-page">
      <section className="split-list is-full">
        <header className="split-list-head">
          <h2 className="split-heading">Projects</h2>
          <span
            className="split-total"
            title="Won, delivered and invoiced — everything you are owed or committed to"
          >
            {formatMoney(pipeline.committed + pipeline.owed)}
          </span>
        </header>

        <PipelineSummary pipeline={pipeline} workload={workload} />

        <div className="split-new">
          <input
            className="lane-add-input"
            value={newTitle}
            placeholder="New project, then Enter"
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                create();
              }
            }}
          />
        </div>

        <div className="proj-toolbar">
          <span className="proj-toolbar-label" id="proj-groupby">
            Group by
          </span>
          <div className="segmented proj-groupby" role="group" aria-labelledby="proj-groupby">
            {(['stage', 'client'] as GroupBy[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={groupBy === mode ? 'seg is-on' : 'seg'}
                aria-pressed={groupBy === mode}
                onClick={() => setGroupBy(mode)}
              >
                {mode === 'stage' ? 'Stage' : 'Client'}
              </button>
            ))}
          </div>
          <span className="proj-toolbar-note">
            Drag a row by its grip to move it to another {GROUP_LABELS[groupBy]}.
          </span>
        </div>

        {projects.length === 0 && <p className="split-empty">No projects yet.</p>}

        {projects.length > 0 && (
          <DndContext
            sensors={sensors}
            onDragStart={(event: DragStartEvent) =>
              setDragging(projects.find((project) => project.id === String(event.active.id)) ?? null)
            }
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(null)}
          >
            <div className="proj-table">
              <div className="proj-table-head" aria-hidden="true">
                <span className="proj-cell is-grip" />
                <span className="proj-cell is-title">Project</span>
                <span className="proj-cell is-stage">Stage</span>
                <span className="proj-cell is-client">Client</span>
                <span className="proj-cell is-cards">Cards</span>
                <span className="proj-cell is-hours">Hours</span>
                <span className="proj-cell is-value">Value</span>
              </div>

              {groups.map((group) => (
                <ProjectGroup
                  key={group.key}
                  group={group}
                  tallies={tallies}
                  clients={clients}
                  clientOrder={clientOrder}
                  selectedId={selected}
                  onSelect={onSelect}
                  onPatch={onPatch}
                />
              ))}
            </div>

            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
              {dragging ? (
                <span className="proj-ghost">
                  {dragging.title || 'Untitled project'}
                  <strong>{formatMoney(projectTotal(dragging))}</strong>
                </span>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </section>

      {active && stats && (
        <ProjectDetail
          project={active}
          stats={stats}
          cards={cards}
          spare={spare}
          projectsById={byId}
          onPatch={onPatch}
          onDelete={onDelete}
          onClose={() => onSelect(null)}
          onOpenCard={onOpenCard}
          onAddCard={onAddCard}
          onMoveCard={onMoveCard}
          onAttachCard={onAttachCard}
        />
      )}
    </div>
  );
}
