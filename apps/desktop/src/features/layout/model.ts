import type { AppState } from '../../state/store.js';

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface ModelBadge {
  /** Short text for the badge. */
  label: string;
  /** Longer explanation for the tooltip: provider, prose model, where the key came from. */
  detail: string;
  tone: 'ready' | 'scripted' | 'none' | 'offline';
}

const KEY_SOURCES = new Set(['keychain', 'env', 'env-file', 'none', 'unknown', 'scripted', 'replay', 'custom']);

/** One description of the model situation, shared by the top bar, the status bar and Welcome. */
export function describeModel(connection: AppState['connection'], t: Translate): ModelBadge {
  if (connection.status === 'error') return { label: t('layout.model.offline'), detail: t('app.disconnected'), tone: 'offline' };
  if (connection.status !== 'ready') return { label: t('layout.model.connecting'), detail: t('app.connecting'), tone: 'offline' };
  const model = connection.model;
  const source = connection.keySource && connection.keySource !== 'unknown' ? connection.keySource : (model?.key_source ?? 'unknown');
  const keyText = t(KEY_SOURCES.has(source) ? `layout.key.${source}` : 'layout.key.unknown');
  if (!model) return { label: t('layout.model.noKey'), detail: `${t('app.model.none')} (${keyText})`, tone: 'none' };
  if (model.scripted) return { label: t('layout.model.scripted'), detail: t('app.model.scripted'), tone: 'scripted' };
  if (model.provider === 'replay') return { label: t('layout.model.replay'), detail: t('app.model.replay'), tone: 'scripted' };
  if (!model.has_model) return { label: t('layout.model.noKey'), detail: `${t('app.model.none')} (${keyText})`, tone: 'none' };
  const label = model.provider === 'anthropic' ? t('layout.model.claude') : t('layout.model.custom');
  const prose = model.models?.prose ? t('layout.model.prose', { model: model.models.prose }) : '';
  return { label, detail: [label, prose, keyText].filter(Boolean).join(' · '), tone: 'ready' };
}
