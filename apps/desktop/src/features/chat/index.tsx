import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { getClient } from '../../api/index.js';
import type { Direction } from '../../api/types.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { useNarratorOptions } from '../wizard/narrator-options.js';
import { CHIP_COMMANDS, describeAction, useChat, type Attachment, type ChatTurn } from './store.js';
import './chat.css';

export { useChat, toHistory, describeAction, storageKey } from './store.js';
export type { ChatTurn, ChatAction, Attachment } from './store.js';
export { parseSettingArgument } from './settings.js';

/**
 * The narrator's chat panel (Section 5.1): Gwen outside the story. Author on the right, Gwen on
 * the left in the prose face, command chips over the composer, an action card under every reply
 * that names a command. Gwen never reaches the writing surface from here: every command runs
 * through the global store and the client, and prose stays a suggestion.
 */
export function NarratorPanel() {
  const root = useStore((s) => s.project.root);
  const load = useChat((s) => s.load);
  useEffect(() => {
    load(root);
  }, [root, load]);
  return root ? <ChatPanel /> : <NoProject />;
}

function hhmm(at: number, language: 'ru' | 'en'): string {
  try {
    return new Date(at).toLocaleTimeString(language === 'ru' ? 'ru-RU' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function PanelHeader({ onClear }: { onClear?: (() => void) | undefined }) {
  const t = useT();
  const model = useStore((s) => s.connection.model);
  const togglePanel = useStore((s) => s.togglePanel);
  const [confirming, setConfirming] = useState(false);
  const presence =
    !model || (!model.has_model && !model.scripted)
      ? t('chat.presence.noModel')
      : model.scripted
        ? t('chat.presence.scripted')
        : t('chat.presence');
  return (
    <header className="chat__head">
      <div className="grow">
        <div className="chat__name">{t('chat.name')}</div>
        <div className="chat__presence small">{presence}</div>
      </div>
      {onClear ? (
        confirming ? (
          <div className="row chat__confirm" role="group" aria-label={t('chat.clear.confirm')}>
            <span className="small">{t('chat.clear.confirm')}</span>
            <button
              type="button"
              className="btn small btn--danger"
              onClick={() => {
                onClear();
                setConfirming(false);
              }}
            >
              {t('chat.clear.yes')}
            </button>
            <button
              type="button"
              className="btn small btn--ghost"
              onClick={() => setConfirming(false)}
              data-autofocus
            >
              {t('chat.clear.no')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--ghost small"
            onClick={() => setConfirming(true)}
          >
            {t('chat.clear')}
          </button>
        )
      ) : null}
      <button
        type="button"
        className="chat__close"
        onClick={() => togglePanel('narrator')}
        aria-label={t('chat.close')}
        title={t('chat.close')}
      >
        ×
      </button>
    </header>
  );
}

function ChatPanel() {
  const t = useT();
  const language = useStore((s) => s.ui.language);
  const turns = useChat((s) => s.turns);
  const busy = useChat((s) => s.busy);
  const draft = useChat((s) => s.draft);
  const setDraft = useChat((s) => s.setDraft);
  const send = useChat((s) => s.send);
  const clear = useChat((s) => s.clear);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const composerId = useId();

  // Follow the conversation while the Author reads the bottom; stay put when they scrolled up.
  useEffect(() => {
    const node = list.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [turns]);
  const onScroll = () => {
    const node = list.current;
    if (node) stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!draft.trim() || busy) return;
    stick.current = true;
    void send(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && draft) {
      event.preventDefault();
      setDraft('');
    }
  };
  const chip = (word: string, event: MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey) {
      setDraft(`${word} `);
      input.current?.focus();
      return;
    }
    stick.current = true;
    void send(word);
  };

  return (
    <aside className="chat" aria-label={t('chat.panel')}>
      <PanelHeader onClear={turns.length > 0 ? clear : undefined} />
      <div
        ref={list}
        className="chat__log"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label={t('chat.log')}
        onScroll={onScroll}
      >
        {turns.length === 0 ? <p className="chat__hint small muted">{t('chat.empty')}</p> : null}
        {turns.map((turn) => (
          <Turn key={turn.id} turn={turn} language={language} />
        ))}
      </div>
      <form className="chat__composer" onSubmit={submit}>
        <div className="chat__chips" role="group" aria-label={t('chat.chips')}>
          {CHIP_COMMANDS.map((id) => {
            const word = t(`chat.chip.${id}`);
            return (
              <button
                key={id}
                type="button"
                className="chat__chip"
                title={t('chat.chip.hint')}
                disabled={busy}
                onClick={(event) => chip(word, event)}
              >
                {word}
              </button>
            );
          })}
        </div>
        <label className="sr-only" htmlFor={composerId}>
          {t('chat.composer')}
        </label>
        <span className="sr-only" id={`${composerId}-keys`}>
          {t('chat.composer.keys')}
        </span>
        <div className="chat__box">
          <textarea
            ref={input}
            id={composerId}
            className="chat__input"
            rows={2}
            value={draft}
            placeholder={t('chat.composer.placeholder')}
            title={t('chat.composer.keys')}
            aria-describedby={`${composerId}-keys`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            spellCheck
          />
          <button
            type="submit"
            className="btn btn--primary chat__send"
            disabled={busy || !draft.trim()}
          >
            {t('chat.send')}
          </button>
        </div>
        {busy ? (
          <div className="small faint chat__status" role="status">
            {t('chat.sending')}
          </div>
        ) : null}
      </form>
    </aside>
  );
}

function Turn({ turn, language }: { turn: ChatTurn; language: 'ru' | 'en' }) {
  const t = useT();
  const scripted = useStore((s) => s.connection.model?.scripted ?? false);
  const who = turn.role === 'user' ? t('chat.you') : t('chat.name');
  const time = hhmm(turn.at, language);
  // While the reply streams the model's trailing `>> action:` line may show up; the server strips it from the final reply.
  const text = turn.streaming ? turn.text.replace(/\n?>>.*$/s, '') : turn.text;
  const meta =
    turn.model === undefined
      ? undefined
      : turn.model === null
        ? t('chat.meta.noModel')
        : t('chat.meta.cost', {
            model: scripted ? t('chat.meta.scripted') : turn.model,
            cost: (turn.costUsd ?? 0).toFixed(4),
          });
  return (
    <article
      className={`chat__turn chat__turn--${turn.role === 'user' ? 'author' : 'gwen'}`}
      aria-label={`${who}, ${time}`}
    >
      <div className="chat__who small faint">
        <span>{who}</span>
        <time dateTime={new Date(turn.at).toISOString()}>{time}</time>
      </div>
      <div className={`chat__bubble${turn.muted ? ' chat__bubble--muted' : ''}`}>
        {text}
        {turn.streaming ? <span className="chat__caret" aria-hidden="true" /> : null}
      </div>
      {meta ? <div className="chat__meta small faint">{meta}</div> : null}
      {turn.action ? <ActionCard turn={turn} /> : null}
      {turn.attachment ? <AttachmentView attachment={turn.attachment} /> : null}
    </article>
  );
}

function ActionCard({ turn }: { turn: ChatTurn }) {
  const t = useT();
  const language = useStore((s) => s.ui.language);
  const acting = useChat((s) => s.acting);
  const runAction = useChat((s) => s.runAction);
  const dismissAction = useChat((s) => s.dismissAction);
  const { options } = useNarratorOptions();
  const action = turn.action!;
  const description = describeAction(action, language, options, t);
  return (
    <div
      className="chat__card"
      role="group"
      aria-label={`${t('chat.action.title')} ${description}`}
    >
      <div className="small">
        <span className="muted">{t('chat.action.title')}</span> {description}
      </div>
      {action.status === 'pending' ? (
        <div className="row chat__card-actions">
          <button
            type="button"
            className="btn btn--primary small"
            onClick={() => void runAction(turn.id)}
            disabled={acting !== undefined}
          >
            {acting === turn.id ? t('common.working') : t('chat.action.do')}
          </button>
          <button
            type="button"
            className="btn btn--ghost small"
            onClick={() => dismissAction(turn.id)}
            disabled={acting === turn.id}
          >
            {t('chat.action.notNow')}
          </button>
        </div>
      ) : (
        <div className="small faint">
          {action.status === 'done' ? t('chat.action.done') : t('chat.action.dismissed')}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('error', t('chat.copy.failed'));
    }
  };
  return (
    <button
      type="button"
      className="btn btn--ghost small"
      onClick={() => void copy()}
      aria-label={label}
      disabled={!text}
    >
      {copied ? t('chat.handover.copied') : t('common.copy')}
    </button>
  );
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  const t = useT();
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const setDraft = useChat((s) => s.setDraft);
  switch (attachment.kind) {
    case 'handover':
      return (
        <section className="chat__attach" aria-label={t('chat.handover.title')}>
          <div className="row chat__attach-head">
            <strong className="small grow">{t('chat.handover.title')}</strong>
            <CopyButton text={attachment.handover} label={t('chat.handover.copy')} />
          </div>
          <pre className="chat__pre">{attachment.handover || t('chat.handover.empty')}</pre>
          <div className="chat__hidden">
            <button
              type="button"
              className="chat__hidden-toggle small"
              aria-expanded={hiddenOpen}
              onClick={() => setHiddenOpen((open) => !open)}
            >
              <strong>{t('chat.handover.hidden')}</strong> · {t('chat.handover.hiddenWarning')} ·{' '}
              {hiddenOpen ? t('chat.handover.hide') : t('chat.handover.show')}
            </button>
            {hiddenOpen ? (
              <pre className="chat__pre">{attachment.hidden || t('chat.handover.empty')}</pre>
            ) : null}
          </div>
        </section>
      );
    case 'directions':
      return (
        <ul className="chat__directions" aria-label={t('chat.action.directions')}>
          {attachment.options.map((option, index) => (
            <DirectionCard
              key={`${index}-${option.title}`}
              option={option}
              onDiscuss={() => setDraft(`${option.title}: ${option.text}\n`)}
            />
          ))}
        </ul>
      );
    case 'brief':
      return (
        <section className="chat__attach" aria-label={t('chat.brief.title')}>
          <div className="row chat__attach-head">
            <strong className="small grow">{t('chat.brief.title')}</strong>
            <CopyButton text={attachment.text} label={t('chat.brief.copy')} />
          </div>
          <pre className="chat__pre">{attachment.text}</pre>
        </section>
      );
    default:
      return null;
  }
}

function DirectionCard({ option, onDiscuss }: { option: Direction; onDiscuss: () => void }) {
  const t = useT();
  return (
    <li className={`chat__direction${option.recommended ? ' chat__direction--recommended' : ''}`}>
      <div className="row">
        <strong className="grow">{option.title}</strong>
        {option.obvious ? <span className="chat__tag">{t('chat.directions.obvious')}</span> : null}
        {option.recommended ? (
          <span className="chat__tag chat__tag--recommended">
            {t('chat.directions.recommended')}
          </span>
        ) : null}
      </div>
      <p className="chat__direction-text">{option.text}</p>
      <button type="button" className="btn btn--ghost small" onClick={onDiscuss}>
        {t('chat.directions.discuss')}
      </button>
    </li>
  );
}

/** Without a project Gwen has no story to talk about: offer to open or start one. */
function NoProject() {
  const t = useT();
  const setWizard = useStore((s) => s.setWizard);
  const openProject = useStore((s) => s.openProject);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const shell = getClient().transport.shell;
  const pathId = useId();

  const open = async () => {
    const chosen = shell ? await shell.pickFolder({ title: t('app.openProject') }) : path.trim();
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

  return (
    <aside className="chat" aria-label={t('chat.panel')}>
      <PanelHeader />
      <div className="chat__log chat__log--empty">
        <article className="chat__turn chat__turn--gwen" aria-label={t('chat.name')}>
          <div className="chat__who small faint">
            <span>{t('chat.name')}</span>
          </div>
          <div className="chat__bubble">
            <strong>{t('chat.noProject.title')}</strong>
            <br />
            {t('chat.noProject.text')}
          </div>
        </article>
        <form
          className="chat__noproject"
          onSubmit={(event) => {
            event.preventDefault();
            void open();
          }}
        >
          {shell ? null : (
            <>
              <label className="sr-only" htmlFor={pathId}>
                {t('chat.noProject.path')}
              </label>
              <input
                id={pathId}
                className="input"
                value={path}
                placeholder={t('chat.noProject.path')}
                onChange={(event) => setPath(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </>
          )}
          <div className="row">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setWizard('new-story')}
            >
              {t('chat.noProject.new')}
            </button>
            <button type="submit" className="btn" disabled={busy || (!shell && !path.trim())}>
              {t('chat.noProject.open')}
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
