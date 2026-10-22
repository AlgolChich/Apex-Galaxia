import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '../../i18n/index.js';
import './dialog.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Extra class on the panel, for width and layout. */
  className?: string;
  /** Small print under the title. */
  subtitle?: ReactNode;
  /** Whether Escape and the backdrop close the dialog (off while a call must not be interrupted). */
  dismissable?: boolean;
  /** For tests and the palette: a different aria role. */
  role?: 'dialog' | 'alertdialog';
  /** No header: the content carries its own labels (the palette's search box). */
  bare?: boolean;
}

/**
 * A modal with a focus trap: focus moves inside on open (the first `[data-autofocus]` or the
 * first focusable control), Tab cycles, Escape closes, focus returns to where it was.
 */
export function Dialog({ title, onClose, children, className, subtitle, dismissable = true, role = 'dialog', bare = false }: DialogProps) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    if (node) {
      const first = node.querySelector<HTMLElement>('[data-autofocus]') ?? node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus();
    }
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  // When focus has left the panel (a control was removed, the Author clicked the backdrop),
  // Escape still closes and Tab brings focus back inside.
  useEffect(() => {
    const onWindowKey = (event: globalThis.KeyboardEvent) => {
      const node = panel.current;
      if (!node || event.defaultPrevented || node.contains(document.activeElement)) return;
      if (event.key === 'Escape' && dismissable) {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        (node.querySelector<HTMLElement>('[data-autofocus]') ?? node.querySelector<HTMLElement>(FOCUSABLE) ?? node).focus();
      }
    };
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  }, [dismissable, onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (!dismissable) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const current = document.activeElement;
    if (event.shiftKey && (current === first || !panel.current.contains(current))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dlg-backdrop" onMouseDown={(event) => dismissable && event.target === event.currentTarget && onClose()}>
      <div ref={panel} className={`dlg${className ? ` ${className}` : ''}`} role={role} aria-modal="true" {...(bare ? { 'aria-label': title } : { 'aria-labelledby': titleId })} tabIndex={-1} onKeyDown={onKeyDown}>
        {bare ? null : (
        <header className="dlg__head">
          <div className="grow">
            <h2 id={titleId} className="dlg__title">
              {title}
            </h2>
            {subtitle ? <div className="small muted">{subtitle}</div> : null}
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose} aria-label={t('common.close')} disabled={!dismissable}>
            {t('common.close')}
          </button>
        </header>
        )}
        {bare ? children : <div className="dlg__body">{children}</div>}
      </div>
    </div>
  );
}
