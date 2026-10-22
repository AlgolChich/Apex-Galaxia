import type { ReactNode } from 'react';

/** The shared frame of a view: a small header with actions, a scrolling body. */
export function ViewFrame({ id, title, actions, children }: { id: string; title: string; actions?: ReactNode; children: ReactNode }) {
  const headingId = `${id}-title`;
  return (
    <section className="view" aria-labelledby={headingId} data-view-id={id}>
      <header className="view__header">
        <h1 id={headingId} className="view__title">
          {title}
        </h1>
        {actions ? <div className="view__actions">{actions}</div> : null}
      </header>
      <div className="view__body">{children}</div>
    </section>
  );
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
