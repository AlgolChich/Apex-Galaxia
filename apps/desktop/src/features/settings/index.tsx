import { useT } from '../../i18n/index.js';

/** Placeholder until the settings view lands. */
export function SettingsView() {
  const t = useT();
  return <div className="empty">{t('common.nothing')}</div>;
}
