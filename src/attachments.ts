/**
 * Where the bytes of an attachment actually live.
 *
 * The board is one JSON blob that every device holds whole and pushes whole, so
 * a file cannot go in it: one pasted screenshot would be a megabyte of base64
 * on every sync, and a week of them would stop the board syncing at all. What
 * travels in the board is the `Attachment` record — a name, a type, a size and
 * an id. The bytes go two other places, both keyed by that id:
 *
 *   - **This device**, in IndexedDB. That is what makes an attachment work with
 *     no server at all, which is a supported way to run the board, and what
 *     makes one show up instantly rather than after a round trip.
 *   - **The Worker**, at `/api/files/<id>`, when there is one to sync to. That
 *     is how the file reaches the other devices, which fetch it on first sight
 *     and keep their own copy from then on.
 *
 * Neither side is authoritative on its own and neither has to be: an id is
 * minted once, the bytes behind it never change, so a copy found anywhere is
 * the right copy. What that buys is that all the awkward states — offline, a
 * file added on the laptop and read on the phone, a browser whose storage was
 * cleared — are the same state: look locally, then ask the Worker.
 */

import { useEffect, useState } from 'react';
import { authHeaders } from './sync';
import { uid } from './store';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_NAME_MAX,
  FILE_ID,
  formatBytes,
  type Attachment,
  type BoardState,
} from './types';

const DB_NAME = 'tcard-planner-files';
const DB_VERSION = 1;
const STORE = 'files';

/** A file, with its bytes. The board's `Attachment` is this minus the blob. */
interface FileRecord extends Attachment {
  blob: Blob;
  /** The Worker hasn't got this one yet. Either there is no Worker, or the
   *  upload hasn't happened — the two are indistinguishable from here, and are
   *  handled the same way: try again later. */
  pending: boolean;
}

export const fileEndpoint = (id: string) => `/api/files/${id}`;

/* ---------- the local store ---------- */

/**
 * IndexedDB, or nothing.
 *
 * A private window, a storage policy or a browser mid-upgrade can all refuse to
 * open a database, and none of them is a reason for the board to stop working:
 * the in-memory fallback below keeps attachments working for the session, and a
 * device that can sync gets them back from the Worker on the next load anyway.
 */
let opening: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

/** Used only when IndexedDB isn't available. Lost on reload, which is the
 *  honest outcome: the file was still uploaded, and comes back from there. */
const memory = new Map<string, FileRecord>();

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return database().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const request = work(db.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

async function readRecord(id: string): Promise<FileRecord | null> {
  const found = await run<FileRecord | undefined>('readonly', (store) => store.get(id));
  return found ?? memory.get(id) ?? null;
}

async function writeRecord(record: FileRecord): Promise<void> {
  const written = await run('readwrite', (store) => store.put(record));
  // `put` resolves to the key, so a null here is a store that isn't working.
  if (written === null) memory.set(record.id, record);
}

async function removeRecord(id: string): Promise<void> {
  memory.delete(id);
  await run('readwrite', (store) => store.delete(id));
}

async function allRecords(): Promise<FileRecord[]> {
  const found = await run<FileRecord[]>('readonly', (store) => store.getAll());
  return found ?? [...memory.values()];
}

/* ---------- urls ---------- */

/**
 * Blob URLs handed out for a file, one per id.
 *
 * Kept for the life of the page rather than revoked when a card closes: the
 * same image is very often looked at again, and a revoked URL in an `<img>` the
 * editor has already drawn is a broken image with no way to notice and retry.
 */
const urls = new Map<string, string>();
const resolving = new Map<string, Promise<string | null>>();

const cachedUrl = (id: string) => urls.get(id) ?? null;

function keep(id: string, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

function forget(id: string): void {
  const url = urls.get(id);
  if (!url) return;
  URL.revokeObjectURL(url);
  urls.delete(id);
}

/**
 * A URL this browser can draw or download, or null if the bytes are nowhere to
 * be found — another device holds them and there is no Worker between you, or
 * the file was swept after the record outlived it.
 */
export function attachmentUrl(id: string): Promise<string | null> {
  const held = urls.get(id);
  if (held) return Promise.resolve(held);

  const already = resolving.get(id);
  if (already) return already;

  const work = (async () => {
    const local = await readRecord(id);
    if (local) return keep(id, local.blob);
    const fetched = await download(id);
    return fetched ? keep(id, fetched.blob) : null;
  })().finally(() => resolving.delete(id));

  resolving.set(id, work);
  return work;
}

/** The URL for an attachment, resolved when it arrives. Null means "not yet",
 *  and then "not here" — which the caller draws as a gap, not as an error. */
export function useAttachmentUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() => (id ? cachedUrl(id) : null));

  useEffect(() => {
    if (!id) {
      setUrl(null);
      return;
    }
    const held = cachedUrl(id);
    setUrl(held);
    if (held) return;

    let live = true;
    void attachmentUrl(id).then((next) => {
      if (live) setUrl(next);
    });
    return () => {
      live = false;
    };
  }, [id]);

  return url;
}

/* ---------- the Worker ---------- */

/**
 * Whether there is anywhere to sync files to.
 *
 * Set from the sync status rather than guessed at: with no Worker in front of
 * it a `vite dev` run answers every path with the app's own HTML and a 200, so
 * "did the upload work" is not a question the response can answer.
 */
let remote = false;

export function setRemoteFiles(enabled: boolean): void {
  const was = remote;
  remote = enabled;
  // Signing in is the moment the queue can finally go somewhere.
  if (!was && enabled) void flushUploads();
}

/** The app's own HTML, handed back for a path the Worker doesn't serve. */
const isAppShell = (response: Response) =>
  response.redirected || (response.headers.get('content-type') ?? '').startsWith('text/html');

async function upload(record: FileRecord): Promise<boolean> {
  if (!remote) return false;
  try {
    const response = await fetch(fileEndpoint(record.id), {
      method: 'PUT',
      headers: authHeaders({
        'content-type': record.type || 'application/octet-stream',
        // Percent-encoded: a header carrying a real filename carries accents,
        // and a raw one would make the whole request unsendable.
        'x-file-name': encodeURIComponent(record.name),
      }),
      body: record.blob,
    });
    if (!response.ok || isAppShell(response)) return false;
    await writeRecord({ ...record, pending: false });
    return true;
  } catch {
    return false;
  }
}

async function download(id: string): Promise<FileRecord | null> {
  if (!remote) return null;
  try {
    const response = await fetch(fileEndpoint(id), { headers: authHeaders(), cache: 'no-store' });
    if (!response.ok || isAppShell(response)) return null;

    const blob = await response.blob();
    const record: FileRecord = {
      id,
      name: decodeURIComponent(response.headers.get('x-file-name') ?? '') || 'File',
      type: blob.type || 'application/octet-stream',
      size: blob.size,
      createdAt: response.headers.get('x-file-created') ?? new Date().toISOString(),
      blob,
      pending: false,
    };
    // Kept, so the second look at it costs nothing and works offline.
    await writeRecord(record);
    return record;
  } catch {
    return null;
  }
}

/** Anything added while offline, or before there was a Worker to add it to. */
export async function flushUploads(): Promise<void> {
  if (!remote) return;
  for (const record of await allRecords()) {
    if (record.pending) await upload(record);
  }
}

/* ---------- adding and removing ---------- */

/** Thrown for a file the board won't take. The message is shown as it is. */
export class AttachmentError extends Error {}

/**
 * Takes a file in: stored here first, sent on in the background.
 *
 * Local first is what makes the paste feel instant and what makes it work with
 * no server, and it is also the safe order — a record in the board pointing at
 * bytes that are already on the device is never wrong, where one pointing at an
 * upload that failed would be.
 */
export async function saveAttachment(file: File): Promise<Attachment> {
  if (file.size > ATTACHMENT_MAX_BYTES) {
    throw new AttachmentError(
      `“${file.name}” is ${formatBytes(file.size)}. Attachments go up to ${formatBytes(ATTACHMENT_MAX_BYTES)}.`,
    );
  }

  const record: FileRecord = {
    id: uid(),
    name: (file.name || 'File').slice(0, ATTACHMENT_NAME_MAX),
    type: file.type || 'application/octet-stream',
    size: file.size,
    createdAt: new Date().toISOString(),
    blob: file,
    pending: true,
  };

  await writeRecord(record);
  keep(record.id, file);
  void upload(record);

  const { blob: _blob, pending: _pending, ...attachment } = record;
  return attachment;
}

/** Hands the file to the browser as a download, under the name it arrived
 *  with. False when the bytes are nowhere this device can reach. */
export async function downloadAttachment(attachment: Attachment): Promise<boolean> {
  const url = await attachmentUrl(attachment.id);
  if (!url) return false;

  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}

/* ---------- sweeping up ---------- */

/**
 * Every file the board still points at: the ones listed on a card or a project,
 * and the ones an editor put in a description.
 *
 * A description holds its images as HTML, so they are read back out of it the
 * same way — by the id the editor writes into every image it inserts. Both the
 * marker attribute and the `src` are matched, so an image that has been through
 * a copy-paste between cards, or an export someone tidied by hand, still counts
 * as a use rather than being swept out from under itself.
 */
const FILE_REFERENCE = /(?:data-file-id="|\/api\/files\/)([A-Za-z0-9_-]{6,64})/g;

export function referencedFileIds(board: BoardState): Set<string> {
  const ids = new Set<string>();
  const take = (entity: { description: string; attachments: Attachment[] }) => {
    for (const file of entity.attachments) ids.add(file.id);
    for (const [, id] of entity.description.matchAll(FILE_REFERENCE)) ids.add(id);
  };
  for (const card of Object.values(board.cards)) take(card);
  for (const project of Object.values(board.projects)) take(project);
  return ids;
}

/**
 * How long a file nothing points at is left alone.
 *
 * The board this device is holding is not the only board there is. A file
 * uploaded from the phone a minute ago belongs to a revision this laptop may
 * not have pulled yet, and to this laptop it looks exactly like litter. A day's
 * grace is far longer than any sync takes and costs nothing but the storage of
 * a file that was going to be deleted tomorrow instead.
 */
const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

const young = (createdAt: string, cutoff: number) => {
  const at = Date.parse(createdAt);
  // A date that won't parse is treated as new. Guessing the other way would
  // make an unreadable timestamp a reason to delete someone's file.
  return !Number.isFinite(at) || at > cutoff;
};

/**
 * Deletes the files nothing refers to any more — a card thrown away, an image
 * deleted from a description. Only ever called with the board in hand, and on
 * the remote side only when this device is in step with the server: sweeping
 * against a board you know to be behind is how you delete someone's afternoon.
 */
export async function sweepAttachments(used: Set<string>, options: { remote: boolean }): Promise<void> {
  const cutoff = Date.now() - SWEEP_GRACE_MS;

  for (const record of await allRecords()) {
    if (used.has(record.id) || record.pending || young(record.createdAt, cutoff)) continue;
    forget(record.id);
    await removeRecord(record.id);
  }

  if (!options.remote) return;

  for (const file of await listRemote()) {
    if (used.has(file.id) || young(file.createdAt, cutoff)) continue;
    try {
      await fetch(fileEndpoint(file.id), { method: 'DELETE', headers: authHeaders() });
    } catch {
      // Next sweep.
    }
  }
}

async function listRemote(): Promise<Attachment[]> {
  try {
    const response = await fetch('/api/files', { headers: authHeaders(), cache: 'no-store' });
    if (!response.ok || isAppShell(response)) return [];
    const body = (await response.json()) as { files?: unknown };
    if (!Array.isArray(body.files)) return [];
    return (body.files as Partial<Attachment>[]).filter(
      (file): file is Attachment => typeof file?.id === 'string' && FILE_ID.test(file.id),
    );
  } catch {
    return [];
  }
}
