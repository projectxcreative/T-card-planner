import { useState } from 'react';
import { CLIENT_NAME_MAX } from '../../types';
import { useBoard, useBoardActions, useClientList } from '../../store/boardStore';

export default function ClientsTab() {
  const clients = useClientList();
  const clientCounts = useBoard((b) => {
    const counts: Record<string, number> = {};
    for (const card of Object.values(b.cards)) {
      for (const id of card.clients) counts[id] = (counts[id] ?? 0) + 1;
    }
    for (const project of Object.values(b.projects)) {
      if (project.clientId) counts[project.clientId] = (counts[project.clientId] ?? 0) + 1;
    }
    return counts;
  });

  const { addClient, patchClient, deleteClient } = useBoardActions();
  const [newClient, setNewClient] = useState('');

  const handleAdd = () => {
    const name = newClient.trim();
    if (!name) return;
    addClient(name.slice(0, CLIENT_NAME_MAX));
    setNewClient('');
  };

  return (
    <section className="settings-section">
      <h3 className="settings-title">Clients</h3>
      <p className="settings-note">
        Client tags say who the work is for. A card or a project can wear several, and they're separate
        from categories — the category is what kind of work it is, the client is who it's for.
      </p>

      <ul className="cat-list">
        {clients.map((client) => {
          const used = clientCounts[client.id] ?? 0;
          return (
            <li key={client.id} className="cat-row" style={{ '--c': client.colour } as React.CSSProperties}>
              <input
                type="color"
                className="cat-colour"
                value={client.colour}
                aria-label={`Colour for ${client.name}`}
                onChange={(event) => patchClient(client.id, { colour: event.target.value })}
              />
              <input
                type="text"
                className="cat-label"
                value={client.name}
                maxLength={CLIENT_NAME_MAX}
                aria-label={`Name for ${client.name}`}
                onChange={(event) =>
                  patchClient(client.id, { name: event.target.value.slice(0, CLIENT_NAME_MAX) })
                }
                onBlur={(event) => {
                  if (!event.target.value.trim()) patchClient(client.id, { name: client.name || 'Client' });
                }}
              />
              <span className="cat-count" title={`${used} card${used === 1 ? '' : 's'} and projects tagged`}>
                {used}
              </span>
              <button
                type="button"
                className="ghost danger cat-remove"
                title={`Remove ${client.name}`}
                aria-label={`Remove ${client.name}`}
                onClick={() => {
                  const warning =
                    used > 0
                      ? ` It is on ${used} card${used === 1 ? '' : 's'} and project${used === 1 ? '' : 's'}.`
                      : '';
                  if (window.confirm(`Remove the client “${client.name}”?${warning}`)) {
                    deleteClient(client.id);
                  }
                }}
              >
                ✕
              </button>
            </li>
          );
        })}
        {clients.length === 0 && <li className="settings-note">No clients yet.</li>}
      </ul>

      <div className="settings-actions">
        <input
          className="cat-label"
          value={newClient}
          maxLength={CLIENT_NAME_MAX}
          placeholder="Add a client"
          aria-label="New client name"
          onChange={(event) => setNewClient(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleAdd();
            }
          }}
        />
        <button type="button" className="ghost" onClick={handleAdd} disabled={!newClient.trim()}>
          Add
        </button>
      </div>
    </section>
  );
}
