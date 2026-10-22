import { useState } from 'react';
import { useStore } from '../../state/store.js';
import { useT } from '../../i18n/index.js';

/** Placeholder until the wizard lands: title, language and folder are enough for a working project. */
export function Wizard({ mode }: { mode: 'first-run' | 'new-story' }) {
  const t = useT();
  const createProject = useStore((s) => s.createProject);
  const setWizard = useStore((s) => s.setWizard);
  const [title, setTitle] = useState('');
  const [path, setPath] = useState('');
  const [language, setLanguage] = useState<'ru' | 'en'>('ru');
  return (
    <div className="empty">
      <form
        className="stack"
        style={{ width: '28rem', textAlign: 'left' }}
        onSubmit={(e) => {
          e.preventDefault();
          void createProject({ path, title, language }).catch(() => undefined);
        }}
      >
        <h2>{mode === 'first-run' ? t('app.name') : t('app.newProject')}</h2>
        <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input className="input" placeholder="/path/to/folder" value={path} onChange={(e) => setPath(e.target.value)} required />
        <select className="select" value={language} onChange={(e) => setLanguage(e.target.value as 'ru' | 'en')}>
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
        <div className="row">
          <button type="button" className="btn" onClick={() => setWizard('none')}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary">
            {t('common.finish')}
          </button>
        </div>
      </form>
    </div>
  );
}
