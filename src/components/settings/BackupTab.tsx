import { useRef } from 'react';
import { useBoardActions } from '../../store/boardStore';

export default function BackupTab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { exportBoard, importBoard } = useBoardActions();

  return (
    <section className="settings-section">
      <h3 className="settings-title">Backup</h3>
      <p className="settings-note">
        A JSON file of the whole board — cards, days, categories, projects and clients. Importing replaces
        what's here.
      </p>
      <div className="settings-actions">
        <button type="button" className="ghost" onClick={exportBoard}>
          Export a backup
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => fileRef.current?.click()}
        >
          Import a backup
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importBoard(file);
          event.target.value = '';
        }}
      />
    </section>
  );
}
