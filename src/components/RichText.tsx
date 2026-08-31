import { useEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

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

export default function RichText({ value, onChange, placeholder = 'Add detail…' }: Props) {
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
    ],
    content: value,
    onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
    editorProps: { attributes: { class: 'rt-content', spellcheck: 'true' } },
  });

  // Reflect a card switch (or an import) without clobbering in-flight typing.
  useEffect(() => {
    if (editor && !editor.isDestroyed && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value]);

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
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
