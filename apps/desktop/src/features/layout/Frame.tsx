import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { PANEL_MAX, PANEL_MIN, useFrame } from './frame-store.js';
import { ResizeHandle } from './ResizeHandle.js';

/**
 * Applies the persisted column widths to the frame App renders: `--tree-width` and
 * `--panel-width` on `.app`, the width of the right aside while a panel is open, and a drag
 * handle on the panel's left edge (the tree carries its own handle). The asides belong to
 * App, so this touches them through the DOM rather than through props.
 */
export function FrameSizing() {
  const t = useT();
  const treeWidth = useFrame((s) => s.treeWidth);
  const panelWidth = useFrame((s) => s.panelWidth);
  const setPanelWidth = useFrame((s) => s.setPanelWidth);
  const panelOpen = useStore((s) => Boolean(s.ui.panel && s.project.root));
  const [aside, setAside] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const app = document.querySelector<HTMLElement>('.app');
    if (!app) return;
    app.style.setProperty('--tree-width', `${treeWidth}px`);
    app.style.setProperty('--panel-width', `${panelWidth}px`);
  }, [treeWidth, panelWidth]);

  useLayoutEffect(() => {
    const tree = document.querySelector<HTMLElement>('.app__tree');
    if (tree) {
      tree.style.minHeight = '0';
      tree.style.overflow = 'hidden';
    }
    const panel = document.querySelector<HTMLElement>('.app__panel');
    setAside(panel);
    if (!panel) return;
    panel.style.minHeight = '0';
    panel.style.overflow = 'hidden';
    panel.style.position = 'relative';
    panel.style.width = panelOpen ? 'var(--panel-width)' : '';
  }, [panelOpen]);

  if (!aside || !panelOpen) return null;
  return createPortal(
    <ResizeHandle side="left" value={panelWidth} min={PANEL_MIN} max={PANEL_MAX} label={t('layout.resize.panel')} onChange={setPanelWidth} />,
    aside,
  );
}
