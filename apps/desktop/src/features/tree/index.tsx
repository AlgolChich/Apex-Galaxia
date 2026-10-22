import { useState } from 'react';
import { getClient } from '../../api/index.js';
import { useStore } from '../../state/store.js';
import { useT } from '../../i18n/index.js';

function ProjectTreeBase() {
  const t = useT();
  const chapters = useStore((s) => s.project.chapters);
  const current = useStore((s) => s.editor.front?.number);
  const loadChapter = useStore((s) => s.loadChapter);
  const setView = useStore((s) => s.setView);
  return (
    <nav className="stack" style={{ width: '16rem', padding: '0.75rem', borderRight: '1px solid var(--border)', height: '100%', overflow: 'auto' }}>
      <div className="small muted">{t('common.chapters')}</div>
      {chapters.map((c) => (
        <button key={c.number} className={`btn btn--ghost${c.number === current ? ' btn--primary' : ''}`} style={{ justifyContent: 'flex-start' }} onClick={() => void (setView('editor'), loadChapter(c.number))}>
          {c.number}. {c.title}
        </button>
      ))}
    </nav>
  );
}

/** The screen without a project: open a folder or start the wizard. Placeholder until the tree feature lands. */
function Welcome() {
  const t = useT();
  const recent = useStore((s) => s.ui.recent);
  const openProject = useStore((s) => s.openProject);
  const setWizard = useStore((s) => s.setWizard);
  const [path, setPath] = useState('');
  const pick = async () => {
    const shell = getClient().transport.shell;
    const chosen = shell ? await shell.pickFolder() : path;
    if (chosen) await openProject(chosen).catch(() => undefined);
  };
  return (
    <div className="empty">
      <div className="stack" style={{ width: '28rem' }}>
        <h1 className="empty__accent">{t('app.name')}</h1>
        <div className="muted">{t('app.noProject')}</div>
        {getClient().transport.shell ? null : <input className="input" placeholder="/path/to/story" value={path} onChange={(e) => setPath(e.target.value)} />}
        <div className="row">
          <button className="btn" onClick={() => void pick()}>
            {t('app.openProject')}
          </button>
          <button className="btn btn--primary" onClick={() => setWizard('new-story')}>
            {t('app.newProject')}
          </button>
        </div>
        {recent.length > 0 ? (
          <div className="stack">
            <div className="small muted">{t('app.recent')}</div>
            {recent.map((r) => (
              <button key={r} className="btn btn--ghost small" style={{ justifyContent: 'flex-start' }} onClick={() => void openProject(r).catch(() => undefined)}>
                {r}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const ProjectTree = Object.assign(ProjectTreeBase, { Welcome });
