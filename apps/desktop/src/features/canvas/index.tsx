import { useT } from '../../i18n/index.js';

/** Placeholder until the canvas board lands. */
export function CanvasView() {
  const t = useT();
  return <div className="empty">{t('common.nothing')}</div>;
}
