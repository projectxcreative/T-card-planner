import { useEffect, useState } from 'react';
import type { Project } from '../../types';

interface ValueFieldProps {
  project: Project;
  onPatch: (id: string, patch: Partial<Project>) => void;
}

export default function ValueField({ project, onPatch }: ValueFieldProps) {
  const [draft, setDraft] = useState(String(project.value || ''));
  useEffect(() => setDraft(String(project.value || '')), [project.id]);

  return (
    <label className="field">
      <span className="field-label">Value</span>
      <span className="money">
        <span className="money-sign" aria-hidden="true">
          £
        </span>
        <input
          type="number"
          min={0}
          step={50}
          className="money-input"
          value={draft}
          placeholder="0"
          onChange={(event) => {
            setDraft(event.target.value);
            onPatch(project.id, { value: Math.max(0, Number(event.target.value) || 0) });
          }}
        />
      </span>
    </label>
  );
}
