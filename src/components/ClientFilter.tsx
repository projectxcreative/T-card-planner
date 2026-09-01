import { useEffect, useRef, useState } from 'react';
import type { Client } from '../types';

interface Props {
  clients: Client[];
  /** Client ids being filtered to. Empty means "everything", not "nothing". */
  value: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Narrows the board to one or more clients.
 *
 * A popover rather than a row of chips: the toolbar is already full, and the
 * list grows with every client you take on. Filtering dims what doesn't match
 * rather than hiding it — same as search, and for the same reason, which is
 * that the shape of the week is worth keeping while you look at part of it.
 */
export default function ClientFilter({ clients, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Nothing to filter by until there is a client to filter by.
  if (clients.length === 0) return null;

  const chosen = clients.filter((client) => value.includes(client.id));
  const label =
    chosen.length === 0 ? 'All clients' : chosen.length === 1 ? chosen[0].name : `${chosen.length} clients`;

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="clientfilter" ref={box}>
      <button
        type="button"
        className={chosen.length > 0 ? 'ghost accent' : 'ghost'}
        aria-expanded={open}
        aria-haspopup="true"
        title="Show only certain clients' work"
        onClick={() => setOpen((current) => !current)}
      >
        {chosen.length > 0 && (
          <span className="clientfilter-dot" style={{ background: chosen[0].colour }} aria-hidden="true" />
        )}
        {label} ▾
      </button>

      {open && (
        <div className="sync-pop clientfilter-pop" role="group" aria-label="Filter by client">
          {clients.map((client) => {
            const on = value.includes(client.id);
            return (
              <label key={client.id} className="clientfilter-row">
                <input type="checkbox" checked={on} onChange={() => toggle(client.id)} />
                <span className="clientfilter-dot" style={{ background: client.colour }} aria-hidden="true" />
                <span className="clientfilter-name">{client.name}</span>
              </label>
            );
          })}
          <div className="sync-actions">
            <button type="button" className="ghost" onClick={() => onChange([])} disabled={chosen.length === 0}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
