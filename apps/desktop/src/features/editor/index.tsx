import { useStore } from '../../state/store.js';
import { useT } from '../../i18n/index.js';

/** Placeholder until the CodeMirror editor lands: a plain textarea bound to the store. */
export function Editor() {
  const t = useT();
  const body = useStore((s) => s.editor.body);
  const stem = useStore((s) => s.editor.stem);
  const setBody = useStore((s) => s.setBody);
  const setCursor = useStore((s) => s.setCursor);
  const save = useStore((s) => s.saveChapter);
  if (!stem) return <div className="empty">{t('common.nothing')}</div>;
  return (
    <textarea
      className="textarea prose"
      style={{ height: '100%', border: 0, borderRadius: 0, padding: '2rem', resize: 'none' }}
      value={body}
      onChange={(e) => setBody(e.target.value)}
      onSelect={(e) => setCursor(e.currentTarget.selectionEnd, { from: e.currentTarget.selectionStart, to: e.currentTarget.selectionEnd })}
      onBlur={() => void save()}
      aria-label={t('common.chapter')}
    />
  );
}
