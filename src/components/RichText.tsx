import { useEffect, useRef } from 'react';
import { EditorContent, mergeAttributes, Node, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { AttachmentError, attachmentUrl, fileEndpoint, saveAttachment } from '../attachments';
import { isImageType } from '../types';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /**
   * Where a dropped file that isn't an image goes. A PDF in the middle of a
   * paragraph would be a broken image; on the attachment list beside it, it is
   * the brief. Without this the editor says so rather than swallowing the drop.
   */
  onAttach?: (files: File[]) => void;
}

/**
 * An image in a description.
 *
 * What is stored is the id of a file, not the file: `<img src="/api/files/ID"
 * data-file-id="ID">`. That is the address the Worker serves it from, so the
 * HTML is meaningful on its own — in the calendar feed, in an export, on
 * another device — while the editor itself draws from whatever copy this
 * browser can get at soonest, which is usually the local one and needs no
 * network at all. The node view below is the whole of that difference.
 *
 * An `<img>` pasted in from elsewhere on the web keeps its own `src` and no
 * id: nothing was uploaded, so there is nothing to point at, and a remote
 * image that still loads is better than one silently dropped.
 */
const FileImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      fileId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-file-id'),
        renderHTML: (attributes) =>
          attributes.fileId ? { 'data-file-id': attributes.fileId as string } : {},
      },
      src: { default: null },
      alt: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const fileId = node.attrs.fileId as string | null;
    return ['img', mergeAttributes(HTMLAttributes, fileId ? { src: fileEndpoint(fileId) } : {})];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('img');
      dom.className = 'rt-image';
      dom.draggable = false;
      const alt = node.attrs.alt as string | null;
      if (alt) {
        dom.alt = alt;
        dom.title = alt;
      }

      const fileId = node.attrs.fileId as string | null;
      if (fileId) {
        void attachmentUrl(fileId).then((url) => {
          if (url) dom.src = url;
          // Nothing to draw: the file is on another device and there is no
          // Worker between them. Left as an empty frame rather than a broken
          // image icon, because it is not broken — it is elsewhere.
          else dom.classList.add('is-missing');
        });
      } else if (typeof node.attrs.src === 'string') {
        dom.src = node.attrs.src;
      }

      return { dom };
    };
  },
});

interface ToolButton {
  label: string;
  title: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const BUTTONS: ToolButton[] = [
  { label: 'B', title: 'Bold  (⌘B)', isActive: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { label: 'I', title: 'Italic  (⌘I)', isActive: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  { label: 'S', title: 'Strikethrough', isActive: (e) => e.isActive('strike'), run: (e) => e.chain().focus().toggleStrike().run() },
  { label: 'H', title: 'Heading', isActive: (e) => e.isActive('heading', { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: '•', title: 'Bullet list', isActive: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: '1.', title: 'Numbered list', isActive: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: '☑', title: 'Checklist', isActive: (e) => e.isActive('taskList'), run: (e) => e.chain().focus().toggleTaskList().run() },
  { label: '❝', title: 'Quote', isActive: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: '‹›', title: 'Code', isActive: (e) => e.isActive('code'), run: (e) => e.chain().focus().toggleCode().run() },
];

/**
 * Pulls a data-URI image out of the document and into the file store.
 *
 * Pasting from some editors hands over an image as several megabytes of base64
 * inside the HTML itself. Left alone that lands in the board blob, is pushed to
 * the server whole on every subsequent edit, and is sent to every device that
 * syncs — which is exactly what keeping files out of the board is meant to
 * prevent. The node is found again by its own `src` rather than by the position
 * it had before the upload, because the cursor doesn't stop for us.
 */
async function absorbDataImages(editor: Editor): Promise<void> {
  const sources = new Set<string>();
  editor.state.doc.descendants((node) => {
    const src = node.attrs.src;
    if (node.type.name === 'image' && !node.attrs.fileId && typeof src === 'string' && src.startsWith('data:')) {
      sources.add(src);
    }
  });

  for (const src of sources) {
    try {
      const blob = await (await fetch(src)).blob();
      const name = `pasted-image.${(blob.type.split('/')[1] || 'png').replace(/\W.*$/, '')}`;
      const attachment = await saveAttachment(new File([blob], name, { type: blob.type || 'image/png' }));
      if (editor.isDestroyed) return;

      const transaction = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'image' || node.attrs.src !== src) return;
        transaction.setNodeMarkup(pos, undefined, { ...node.attrs, fileId: attachment.id, src: null });
      });
      if (transaction.docChanged) editor.view.dispatch(transaction);
    } catch {
      // The image stays as it pasted. Bulky, but nobody loses anything.
    }
  }
}

export default function RichText({ value, onChange, placeholder = 'Add detail…', onAttach }: Props) {
  // The paste and drop handlers below are built once, when the editor is
  // created, and go on being called for as long as the card is open. Anything
  // they need that changes between renders — the editor itself, which does not
  // exist yet on the first one, and the caller's handler — is reached through a
  // ref rather than closed over, or they would be working from the props the
  // card opened with.
  const attachRef = useRef(onAttach);
  attachRef.current = onAttach;
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
      }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      FileImage,
    ],
    content: value,
    onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
    editorProps: {
      attributes: { class: 'rt-content', spellcheck: 'true' },

      /**
       * Files on the clipboard: a screenshot, an image copied from a page, a
       * file copied in Finder or Explorer.
       *
       * Only when there is no text to paste as well. Copying from Word or
       * Excel puts both a picture and the text on the clipboard, and pasting a
       * bitmap of a table nobody asked for is a worse answer than pasting the
       * table — so anything carrying real text is left to the normal path.
       */
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (files.length === 0 || text.trim()) {
          // Pasted HTML can still carry an image inline in the markup itself;
          // that is dealt with once the paste has landed.
          if (event.clipboardData?.types.includes('text/html')) {
            setTimeout(() => {
              const instance = editorRef.current;
              if (instance && !instance.isDestroyed) void absorbDataImages(instance);
            }, 0);
          }
          return false;
        }
        event.preventDefault();
        void take(files);
        return true;
      },

      handleDrop: (view, event, _slice, moved) => {
        // A drag that started inside the editor is the editor's own business.
        if (moved) return false;
        const files = [...((event as DragEvent).dataTransfer?.files ?? [])];
        if (files.length === 0) return false;
        event.preventDefault();
        void take(files, view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos);
        return true;
      },
    },
  });

  /** Images go in the description; everything else goes to the caller, who
   *  has an attachment list to put it on. */
  async function take(files: File[], at?: number): Promise<void> {
    const images = files.filter((file) => isImageType(file.type));
    const rest = files.filter((file) => !isImageType(file.type));

    let where = at;
    for (const file of images) {
      try {
        const attachment = await saveAttachment(file);
        const instance = editorRef.current;
        if (!instance || instance.isDestroyed) return;
        const content = { type: 'image', attrs: { fileId: attachment.id, alt: attachment.name } };
        if (where === undefined) instance.chain().focus().insertContent(content).run();
        else instance.chain().focus().insertContentAt(where, content).run();
        // Anything after the first goes below it rather than on top of it.
        where = where === undefined ? undefined : instance.state.selection.to;
      } catch (error) {
        window.alert(error instanceof AttachmentError ? error.message : `“${file.name}” could not be added.`);
      }
    }

    if (rest.length === 0) return;
    if (attachRef.current) attachRef.current(rest);
    else window.alert('Only images can go in a description.');
  }

  editorRef.current = editor;

  // Reflect a card switch (or an import) without clobbering in-flight typing.
  useEffect(() => {
    if (editor && !editor.isDestroyed && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value]);

  const picker = useRef<HTMLInputElement>(null);

  if (!editor) return <div className="rt" />;

  const setLink = () => {
    const previous = editor.getAttributes('link').href ?? '';
    const url = window.prompt('Link URL', previous);
    if (url === null) return;
    if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="rt">
      <div className="rt-toolbar" role="toolbar" aria-label="Text formatting">
        {BUTTONS.map((button) => (
          <button
            key={button.label}
            type="button"
            title={button.title}
            aria-label={button.title}
            aria-pressed={button.isActive(editor)}
            className={button.isActive(editor) ? 'rt-btn is-active' : 'rt-btn'}
            onClick={() => button.run(editor)}
          >
            {button.label}
          </button>
        ))}
        <button
          type="button"
          title="Link"
          aria-label="Link"
          aria-pressed={editor.isActive('link')}
          className={editor.isActive('link') ? 'rt-btn is-active' : 'rt-btn'}
          onClick={setLink}
        >
          ⛓
        </button>
        <button
          type="button"
          title="Image — or just paste one"
          aria-label="Image"
          className="rt-btn"
          onClick={() => picker.current?.click()}
        >
          ▣
        </button>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void take([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
