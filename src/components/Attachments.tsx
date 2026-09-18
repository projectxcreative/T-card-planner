import { useCallback, useRef, useState } from 'react';
import { ATTACHMENT_MAX_BYTES, formatBytes, isImageType, type Attachment } from '../types';
import { AttachmentError, downloadAttachment, saveAttachment, useAttachmentUrl } from '../attachments';

interface Props {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  /** The server can't be reached, so nothing about the card may change. */
  locked?: boolean;
}

/**
 * Adding and removing files, kept apart from the list that draws them so the
 * description editor can use the same adder: a PDF dropped into the text ends
 * up on this list rather than being refused or, worse, swallowed.
 *
 * Only the record changes here. The bytes were written before this returns —
 * see `attachments.ts` — so a board that has an attachment on it always has the
 * file to go with it, rather than a row pointing at an upload that never
 * happened.
 */
export function useAttachmentActions(attachments: Attachment[], onChange: (next: Attachment[]) => void) {
  const held = useRef(attachments);
  held.current = attachments;

  const add = useCallback(
    async (files: File[]) => {
      const added: Attachment[] = [];
      for (const file of files) {
        try {
          added.push(await saveAttachment(file));
        } catch (error) {
          window.alert(error instanceof AttachmentError ? error.message : `“${file.name}” could not be attached.`);
        }
      }
      if (added.length > 0) onChange([...held.current, ...added]);
    },
    [onChange],
  );

  const remove = useCallback(
    (id: string) => onChange(held.current.filter((file) => file.id !== id)),
    [onChange],
  );

  return { add, remove };
}

/** `brief.final.pdf` → `PDF`. What a file is, when there is no picture of it. */
function extensionOf(attachment: Attachment): string {
  const fromName = /\.([A-Za-z0-9]{1,5})$/.exec(attachment.name)?.[1];
  const fromType = attachment.type.split('/')[1]?.replace(/\W.*$/, '');
  return (fromName || fromType || 'file').slice(0, 4).toUpperCase();
}

function AttachmentRow({
  attachment,
  locked,
  onRemove,
}: {
  attachment: Attachment;
  locked?: boolean;
  onRemove: (id: string) => void;
}) {
  // Only images are worth resolving up front; everything else is fetched when
  // someone actually asks for it.
  const thumbnail = useAttachmentUrl(isImageType(attachment.type) ? attachment.id : null);

  const open = async () => {
    const ok = await downloadAttachment(attachment);
    if (!ok) {
      window.alert(
        `“${attachment.name}” isn't on this device. It was added somewhere else, and needs syncing to be able to reach it.`,
      );
    }
  };

  return (
    <li className="attach-row">
      <span className="attach-thumb" aria-hidden="true">
        {thumbnail ? <img src={thumbnail} alt="" /> : <span className="attach-ext">{extensionOf(attachment)}</span>}
      </span>
      <button type="button" className="attach-name" onClick={open} title={`Download ${attachment.name}`}>
        {attachment.name}
      </button>
      <span className="attach-size">{formatBytes(attachment.size)}</span>
      <button
        type="button"
        className="ghost icon danger"
        disabled={locked}
        title="Remove"
        aria-label={`Remove ${attachment.name}`}
        onClick={() => onRemove(attachment.id)}
      >
        ✕
      </button>
    </li>
  );
}

/**
 * The files on a card or a project.
 *
 * What is listed here is a file kept *with* the thing rather than *in* it: the
 * signed order, the brief, the export you sent. Images pasted into the
 * description stay in the description, where they are read — putting them here
 * as well would turn the list into an inventory of every screenshot anyone ever
 * pasted, which is not a list anybody reads twice.
 */
export default function Attachments({ attachments, onChange, locked }: Props) {
  const { add, remove } = useAttachmentActions(attachments, onChange);
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      className={over ? 'attachments is-over' : 'attachments'}
      onDragOver={(event) => {
        if (locked || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        // A drag crossing a row inside the box is not a drag leaving the box.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(event) => {
        if (locked) return;
        const files = [...event.dataTransfer.files];
        if (files.length === 0) return;
        event.preventDefault();
        setOver(false);
        void add(files);
      }}
    >
      {attachments.length > 0 && (
        <ul className="attach-list">
          {attachments.map((attachment) => (
            <AttachmentRow key={attachment.id} attachment={attachment} locked={locked} onRemove={remove} />
          ))}
        </ul>
      )}

      <div className="attach-add">
        <button type="button" className="ghost" disabled={locked} onClick={() => picker.current?.click()}>
          Add files
        </button>
        <span className="attach-hint">
          {attachments.length === 0 ? 'Or drop them here' : 'Or drop more here'} — up to{' '}
          {formatBytes(ATTACHMENT_MAX_BYTES)} each
        </span>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            void add([...(event.target.files ?? [])]);
            // Same file twice in a row still counts as a change.
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
