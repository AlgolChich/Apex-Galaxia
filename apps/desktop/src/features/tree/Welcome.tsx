import { useState, type FormEvent } from 'react';
import { getClient } from '../../api/index.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { describeModel } from '../layout/index.js';

function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** The screen without a project: the name, one sentence, open or create, recent projects, the model state. */
export function Welcome() {
  const t = useT();
  const recent = useStore((s) => s.ui.recent);
  const connection = useStore((s) => s.connection);
  const openProject = useStore((s) => s.openProject);
  const setWizard = useStore((s) => s.setWizard);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const shell = getClient().transport.shell;

  const open = async (target?: string) => {
    let chosen = target;
    if (!chosen) chosen = shell ? await shell.pickFolder({ title: t('app.openProject') }) : path.trim();
    if (!chosen) return;
    setBusy(true);
    try {
      await openProject(chosen);
    } catch {
      // the store already showed the error as a toast
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void open();
  };

  const badge = describeModel(connection, t);

  return (
    <div className="welcome">
      <div className="welcome__inner">
        <h1 className="welcome__name">
          <span>Apex</span> <span className="welcome__accent">Galaxia</span>
        </h1>
        <p className="welcome__tagline">{t('welcome.tagline')}</p>
        <form className="welcome__open" onSubmit={onSubmit}>
          {shell ? null : (
            <label className="welcome__field">
              <span className="sr-only">{t('welcome.pathLabel')}</span>
              <input className="input" placeholder={t('welcome.pathPlaceholder')} value={path} onChange={(event) => setPath(event.target.value)} autoComplete="off" spellCheck={false} />
            </label>
          )}
          <div className="welcome__actions">
            <button type="submit" className="btn" disabled={busy || (!shell && !path.trim())}>
              {t('app.openProject')}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setWizard('new-story')}>
              {t('app.newProject')}
            </button>
            <button type="button" className="btn" onClick={() => window.dispatchEvent(new CustomEvent('apex:import', { detail: { kind: 'manuscript' } }))}>
              {t('welcome.import')}
            </button>
          </div>
        </form>
        {recent.length > 0 ? (
          <section className="welcome__recent" aria-labelledby="welcome-recent">
            <h2 id="welcome-recent" className="welcome__heading">
              {t('app.recent')}
            </h2>
            <ul className="welcome__list" role="list">
              {recent.map((item) => (
                <li key={item}>
                  <button type="button" className="welcome__recent-item" onClick={() => void open(item)} disabled={busy} aria-label={t('welcome.recentOpen', { name: basename(item) })} title={item}>
                    <span className="welcome__recent-name">{basename(item)}</span>
                    <span className="welcome__recent-path">{item}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="welcome__status" title={badge.detail}>
          <span className={`welcome__dot welcome__dot--${badge.tone}`} aria-hidden="true" />
          <span className="welcome__status-label">{t('welcome.connection')}:</span> {badge.label}
          <span className="welcome__status-detail"> · {badge.detail}</span>
        </p>
      </div>
    </div>
  );
}
