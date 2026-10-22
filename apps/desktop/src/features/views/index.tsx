import { useT } from '../../i18n/index.js';

/** Placeholders until the views (Bible cards, chronicle timeline, plan outline, run progress) land. */
export function BibleView() {
  const t = useT();
  return <div className="empty">{t('common.nothing')}</div>;
}
export function ChronicleView() {
  const t = useT();
  return <div className="empty">{t('common.nothing')}</div>;
}
export function PlanView() {
  const t = useT();
  return <div className="empty">{t('common.nothing')}</div>;
}
export function RunView() {
  const t = useT();
  return <div className="empty">{t('common.nothing')}</div>;
}
