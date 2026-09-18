/**
 * The attachment store: the bytes a board's files are made of.
 *
 * The board itself is one JSON value in KV, and files stay firmly out of it —
 * a value that grew by a megabyte every time someone pasted a screenshot would
 * be re-uploaded whole on every edit, and would hit KV's own ceiling inside a
 * month. Each file gets a key of its own instead, named by the id the app
 * minted for it, with its name and type in the key's metadata.
 *
 * Two things here are about safety rather than storage, and neither is
 * optional. Files are served from the same origin as the board — the same
 * origin as the Access cookie — so an uploaded page that ran script would be
 * running it as you. Every reply therefore carries a sandboxing CSP and
 * `nosniff`, and only a short list of plainly inert image types is served
 * inline at all: everything else downloads, whatever it claims to be.
 */

/** What the app is allowed to call a file. It arrives as a URL path segment
 *  and becomes part of a KV key, so nothing else is entertained. */
const FILE_PATH = /^\/api\/files\/([A-Za-z0-9_-]{6,64})$/;

/** Per file. Comfortably under KV's own 25 MB value limit, with room for the
 *  request's overhead — and the same number the app checks before uploading,
 *  so the refusal normally happens where it can be explained. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** How long a name may be, matching the app's own cap. KV gives a key 1 KB of
 *  metadata; a name this length leaves the rest of the record ample room. */
const NAME_MAX = 120;

/**
 * The types served for the browser to draw, rather than to save.
 *
 * Deliberately a list of formats rather than "anything starting with image/":
 * SVG is an image by MIME type and a document by behaviour, and served inline
 * from this origin it would be a script running on the board's own domain.
 */
const INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);

/** What a file's KV key carries besides its bytes. */
export interface FileMeta {
  name: string;
  type: string;
  size: number;
  createdAt: string;
}

/** The id in `/api/files/<id>`, or null for any other path. */
export function fileIdFrom(path: string): string | null {
  const match = FILE_PATH.exec(path);
  return match ? match[1] : null;
}

/** One board's files sit under one prefix, so a second board in the same
 *  namespace keeps its own — and so listing them doesn't walk the board. */
export const filePrefix = (boardKey: string) => `${boardKey}:file:`;
export const fileKey = (boardKey: string, id: string) => `${filePrefix(boardKey)}${id}`;

/**
 * The name to file a byte stream under.
 *
 * It arrives percent-encoded in a header, because a real filename has accents
 * in it and a header cannot. Anything that would let a name escape the quoted
 * string it ends up inside — quotes, backslashes, newlines, path separators —
 * is dropped rather than escaped: the name is a label, not a path.
 */
export function safeName(header: string | null): string {
  try {
    return cleanName(decodeURIComponent(header ?? ''));
  } catch {
    // A header that isn't valid percent-encoding is still a name of sorts.
    return cleanName(header ?? '');
  }
}

/** The same rules, for a name that was never in a header — one read back out
 *  of a key's metadata, where it has been sitting since it was cleaned. */
export function cleanName(value: string): string {
  const cleaned = value
    .replace(/[\\/]+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/["\u0000-\u001f\u007f]+/g, '')
    .trim();
  return cleaned.slice(0, NAME_MAX) || 'file';
}

/** A media type worth repeating back. Anything unrecognised is served as
 *  bytes, which is the honest description of a file nobody has vouched for. */
export function safeType(value: string | null): string {
  const type = (value ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/.test(type)
    ? type
    : 'application/octet-stream';
}

/**
 * How the browser should treat the reply.
 *
 * `filename*` carries the real name, accents and all; the plain `filename` is
 * an ASCII fallback for anything that doesn't read RFC 5987. Both are built
 * from the cleaned name, so neither can end the header early.
 */
export function disposition(name: string, type: string): string {
  const kind = INLINE_TYPES.has(type) ? 'inline' : 'attachment';
  const ascii = name.replace(/[^\x20-\x7e]+/g, '_') || 'file';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * The headers that make a file served from this origin safe to serve from this
 * origin: no sniffing past the type we decided on, and a sandbox that strips
 * the reply of an origin of its own — so even a page that talked its way into
 * the store cannot read the board, the cookies, or anything else that belongs
 * to the domain it was uploaded to.
 */
const GUARDS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
};

/**
 * Serves one file, stores one, or removes one.
 *
 * Bytes are immutable once written: an id is minted per file and never reused,
 * so a reply can be cached for a year and a second device that has fetched a
 * file once never asks again.
 */
export async function handleFile(
  request: Request,
  kv: KVNamespace,
  boardKey: string,
  id: string,
): Promise<Response> {
  const key = fileKey(boardKey, id);

  if (request.method === 'GET' || request.method === 'HEAD') {
    const { value, metadata } = await kv.getWithMetadata<FileMeta>(key, 'arrayBuffer');
    if (!value) return json({ error: 'not-found' }, 404);

    const type = safeType(metadata?.type ?? null);
    const name = cleanName(metadata?.name ?? '');
    const headers: Record<string, string> = {
      ...GUARDS,
      'content-type': type,
      'content-length': String(value.byteLength),
      'content-disposition': disposition(name, type),
      'cache-control': 'private, max-age=31536000, immutable',
      // What the app needs to file the download under, without parsing the
      // disposition back apart.
      'x-file-name': encodeURIComponent(name),
      'x-file-created': metadata?.createdAt ?? '',
    };
    return new Response(request.method === 'HEAD' ? null : value, { headers });
  }

  if (request.method === 'PUT') {
    // The declared length first, so an oversized upload is refused before it
    // is read into memory rather than after.
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
      return json({ error: 'too-large', limit: MAX_FILE_BYTES }, 413);
    }

    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return json({ error: 'empty' }, 400);
    if (body.byteLength > MAX_FILE_BYTES) return json({ error: 'too-large', limit: MAX_FILE_BYTES }, 413);

    const metadata: FileMeta = {
      name: safeName(request.headers.get('x-file-name')),
      type: safeType(request.headers.get('content-type')),
      size: body.byteLength,
      createdAt: new Date().toISOString(),
    };
    await kv.put(key, body, { metadata });
    return json({ id, ...metadata }, 201);
  }

  if (request.method === 'DELETE') {
    await kv.delete(key);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  return json({ error: 'method-not-allowed' }, 405);
}

/**
 * Everything the store holds for this board, so the app can tell which files
 * nothing points at any more and clear them out. Metadata only — the bytes are
 * exactly what a listing shouldn't drag along.
 */
export async function listFiles(kv: KVNamespace, boardKey: string): Promise<Response> {
  const prefix = filePrefix(boardKey);
  const files: ({ id: string } & Partial<FileMeta>)[] = [];

  let cursor: string | undefined;
  // Bounded: a board with more files than this has a bigger problem than an
  // incomplete sweep, and the next sweep picks up where this one stopped.
  for (let page = 0; page < 10; page++) {
    const listed = await kv.list<FileMeta>({ prefix, cursor, limit: 1000 });
    for (const entry of listed.keys) {
      files.push({ id: entry.name.slice(prefix.length), ...(entry.metadata ?? {}) });
    }
    if (listed.list_complete) break;
    cursor = listed.cursor;
  }

  return json({ files });
}
