import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  PROJECT_STAGES,
  STAGE_GROUP,
  STAGE_LABELS,
  categoryLabel,
  type Attachment,
  type Card,
  type CategoryId,
  type LaneId,
  type Project,
  type ProjectStage,
} from '../../types';
import { formatMonthKey, monthChoices } from '../../dates';
import Attachments, { useAttachmentActions } from '../Attachments';
import { useCategories } from '../../categories';
import { useLookups } from '../../lookups';
import ValueField from './ValueField';
import ExpensesSection from './ExpensesSection';
import ProjectCardsSection from './ProjectCardsSection';
import ProjectStats, { type Tally } from './ProjectStats';

const RichText = lazy(() => import('../RichText'));
const DESCRIPTION_DEBOUNCE_MS = 300;
const MONTH_CHOICES = monthChoices(12, 12);

interface ProjectDetailProps {
  project: Project;
  stats: Tally;
  cards: { card: Card; lane: LaneId }[];
  spare: { card: Card; lane: LaneId }[];
  projectsById: Record<string, Project>;
  onPatch: (id: string, patch: Partial<Project>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onOpenCard: (id: string) => void;
  onAddCard: (projectId: string, title: string, day: LaneId) => void;
  onMoveCard: (id: string, lane: LaneId) => void;
  onAttachCard: (cardId: string, projectId: string) => void;
}

function ProjectDescription({
  project,
  onPatch,
}: {
  project: Project;
  onPatch: (id: string, patch: Partial<Project>) => void;
}) {
  const [html, setHtml] = useState(project.description);
  const { add } = useAttachmentActions(project.attachments, (next: Attachment[]) =>
    onPatch(project.id, { attachments: next }),
  );
  const patchRef = useRef(onPatch);
  patchRef.current = onPatch;

  useEffect(() => setHtml(project.description), [project.id]);

  useEffect(() => {
    if (html === project.description) return;
    const timer = setTimeout(
      () => patchRef.current(project.id, { description: html }),
      DESCRIPTION_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [html, project.id, project.description]);

  return (
    <Suspense fallback={<div className="rt rt-loading" />}>
      <RichText value={html} onChange={setHtml} onAttach={(files) => void add(files)} />
    </Suspense>
  );
}

export default function ProjectDetail({
  project,
  stats,
  cards,
  spare,
  projectsById,
  onPatch,
  onDelete,
  onClose,
  onOpenCard,
  onAddCard,
  onMoveCard,
  onAttachCard,
}: ProjectDetailProps) {
  const categories = useCategories();
  const { clients, clientOrder, categoryOrder } = useLookups();
  const activeClient = project.clientId ? clients[project.clientId] : undefined;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal is-project"
        role="dialog"
        aria-modal="true"
        aria-label="Project details"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          onClose();
        }}
      >
        <header className="split-detail-head">
          <input
            className="drawer-title"
            value={project.title}
            placeholder="Project title"
            onChange={(event) => onPatch(project.id, { title: event.target.value })}
          />
          <div className="drawer-head-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => onPatch(project.id, { archived: !project.archived })}
              title={project.archived ? 'Put this project back in the list' : 'Hide it from the card pickers'}
            >
              {project.archived ? 'Unarchive' : 'Archive'}
            </button>
            <button
              type="button"
              className="ghost danger"
              onClick={() => {
                if (window.confirm(`Delete “${project.title || 'Untitled project'}”? Its cards stay on the board.`)) {
                  onDelete(project.id);
                  onClose();
                }
              }}
            >
              Delete
            </button>
            <button type="button" className="ghost" onClick={onClose} title="Close (Esc)" aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        <div className="split-detail-body">
          <ProjectStats project={project} stats={stats} />

          <div className="field-row">
            <label className="field">
              <span className="field-label">Stage</span>
              <select
                className={`stage-select s-stage-${STAGE_GROUP[project.stage]}`}
                value={project.stage}
                onChange={(event) => onPatch(project.id, { stage: event.target.value as ProjectStage })}
              >
                {PROJECT_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
            </label>

            <ValueField project={project} onPatch={onPatch} />

            <label className="field">
              <span className="field-label">Invoice month</span>
              <select
                value={project.invoiceMonth ?? ''}
                onChange={(event) => onPatch(project.id, { invoiceMonth: event.target.value || null })}
              >
                <option value="">Not yet</option>
                {MONTH_CHOICES.map((key) => (
                  <option key={key} value={key}>
                    {formatMonthKey(key)}
                  </option>
                ))}
                {project.invoiceMonth && !MONTH_CHOICES.includes(project.invoiceMonth) && (
                  <option value={project.invoiceMonth}>{formatMonthKey(project.invoiceMonth)}</option>
                )}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span className="field-label">Category</span>
              <span className={`picker c-${project.colour}`}>
                <span className="picker-dot" aria-hidden="true" />
                <select
                  className="picker-select"
                  value={project.colour}
                  onChange={(event) => onPatch(project.id, { colour: event.target.value as CategoryId })}
                >
                  {categoryOrder.map((id) => (
                    <option key={id} value={id}>
                      {categoryLabel(categories, id)}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>

          <label className="field">
            <span className="field-label">Client</span>
            {clientOrder.length === 0 ? (
              <p className="field-note">No clients yet — add them in the Clients view, or under Settings.</p>
            ) : (
              <span
                className="picker"
                style={activeClient ? ({ '--c': activeClient.colour } as React.CSSProperties) : undefined}
              >
                {activeClient && <span className="picker-dot" aria-hidden="true" />}
                <select
                  className={activeClient ? 'picker-select' : undefined}
                  value={project.clientId ?? ''}
                  onChange={(event) => onPatch(project.id, { clientId: event.target.value || null })}
                >
                  <option value="">No client</option>
                  {clientOrder.map((id) => (
                    <option key={id} value={id}>
                      {clients[id].name}
                    </option>
                  ))}
                </select>
              </span>
            )}
          </label>

          <ExpensesSection project={project} onPatch={onPatch} />

          <div className="field">
            <span className="field-label">Description</span>
            <ProjectDescription key={project.id} project={project} onPatch={onPatch} />
          </div>

          <div className="field">
            <span className="field-label">Files</span>
            <Attachments
              attachments={project.attachments}
              onChange={(next: Attachment[]) => onPatch(project.id, { attachments: next })}
            />
          </div>

          <ProjectCardsSection
            project={project}
            cards={cards}
            spare={spare}
            projectsById={projectsById}
            onOpenCard={onOpenCard}
            onAddCard={onAddCard}
            onMoveCard={onMoveCard}
            onAttachCard={onAttachCard}
          />
        </div>
      </section>
    </div>
  );
}
