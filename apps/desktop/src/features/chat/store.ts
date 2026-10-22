import { create } from 'zustand';
import { getClient } from '../../api/index.js';
import { ToolError } from '../../api/mcp.js';
import type {
  ChatTurn as HistoryTurn,
  CommandMatch,
  Direction,
  NarratorOptions,
} from '../../api/types.js';
import { translate } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { loadNarratorOptions } from '../wizard/narrator-options.js';
import {
  SETTING_VALUES,
  harshnessLabel,
  isSettingCommand,
  parseSettingArgument,
  type ParsedSetting,
} from './settings.js';

/**
 * The narrator's chat outside the story. The conversation lives here, per project, persisted
 * in localStorage (`apex.chat.<project root>`, capped at 200 turns). Every command the server
 * reports (`action`) becomes a card the Author confirms before anything runs; the handlers
 * below execute it through the global store and the client. The global store stays untouched.
 */
export type Attachment =
  | { kind: 'handover'; handover: string; hidden: string }
  | { kind: 'directions'; options: Direction[] }
  | { kind: 'brief'; text: string };

export type ActionStatus = 'pending' | 'done' | 'dismissed';

export interface ChatAction extends CommandMatch {
  status: ActionStatus;
  /** For the setting commands: the parsed value the card shows and `Do it` applies. */
  setting?: ParsedSetting;
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Unix milliseconds. */
  at: number;
  /** Model replies carry the model name (null when the server answered without one); local lines have no model. */
  model?: string | null;
  costUsd?: number;
  streaming?: boolean;
  /** A muted line relaying what the core said when a call failed. */
  muted?: boolean;
  action?: ChatAction;
  attachment?: Attachment;
}

export interface ChatState {
  /** The project the turns belong to; undefined before a project is open. */
  root: string | undefined;
  turns: ChatTurn[];
  /** A chat call is in flight. */
  busy: boolean;
  /** The turn whose action is running (`Do it` pressed), so the card shows it and ignores a second press. */
  acting: string | undefined;
  draft: string;

  load(root: string | undefined): void;
  setDraft(draft: string): void;
  send(message: string): Promise<void>;
  clear(): void;
  runAction(turnId: string): Promise<void>;
  dismissAction(turnId: string): void;
  /** Append a line in Gwen's voice that no model wrote (an explanation, a confirmation, an attachment). */
  sayLocal(
    text: string,
    extra?: Partial<Pick<ChatTurn, 'action' | 'attachment' | 'muted'>>,
  ): string;
}

export const HISTORY_CAP = 200;
export const HISTORY_WINDOW = 12;

/** Commands the panel answers with an explanation instead of a card: nothing to run. */
const INFORMATIONAL = new Set(['aside', 'rewrite', 'portrait', 'dossier']);

export function storageKey(root: string): string {
  return `apex.chat.${root}`;
}

let counter = 0;
function newId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function readTurns(root: string): ChatTurn[] {
  try {
    const raw = localStorage.getItem(storageKey(root));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { turns?: unknown };
    if (!Array.isArray(parsed.turns)) return [];
    // A turn left streaming by a closed window is finished as it stands; empty ones go.
    return (parsed.turns as ChatTurn[])
      .filter(
        (turn) =>
          turn &&
          typeof turn.id === 'string' &&
          (turn.role === 'user' || turn.role === 'assistant') &&
          typeof turn.text === 'string',
      )
      .map((turn) => {
        const { streaming: _streaming, ...rest } = turn;
        return rest;
      })
      .filter((turn) => turn.text.length > 0 || turn.attachment !== undefined)
      .slice(-HISTORY_CAP);
  } catch {
    return [];
  }
}

function writeTurns(root: string, turns: ChatTurn[]): void {
  try {
    localStorage.setItem(storageKey(root), JSON.stringify({ turns: turns.slice(-HISTORY_CAP) }));
  } catch {
    // private mode or a test environment without storage
  }
}

/** The last turns as the server wants them: text only, no muted lines, no half-written reply. */
export function toHistory(turns: ChatTurn[]): HistoryTurn[] {
  return turns
    .filter((turn) => !turn.muted && !turn.streaming && turn.text.trim().length > 0)
    .slice(-HISTORY_WINDOW)
    .map((turn) => ({ role: turn.role, content: turn.text }));
}

/** The command words of the chips, in the interface language; the server matches both. */
export const CHIP_COMMANDS = ['next', 'directions', 'chronicle', 'plan', 'aside'] as const;

export const useChat = create<ChatState>((set, get) => {
  const commit = (turns: ChatTurn[], persist = true) => {
    const capped = turns.slice(-HISTORY_CAP);
    set({ turns: capped });
    const root = get().root;
    if (root && persist) writeTurns(root, capped);
  };
  const push = (turn: Omit<ChatTurn, 'id' | 'at'>): string => {
    const id = newId();
    commit([...get().turns, { id, at: Date.now(), ...turn }]);
    return id;
  };
  // Streaming deltas update the screen only; the finished reply is what reaches storage.
  const patch = (id: string, change: Partial<ChatTurn>, persist = true) => {
    commit(
      get().turns.map((turn) => (turn.id === id ? { ...turn, ...change } : turn)),
      persist,
    );
  };
  const setActionStatus = (id: string, status: ActionStatus) => {
    const turn = get().turns.find((item) => item.id === id);
    if (turn?.action) patch(id, { action: { ...turn.action, status } });
  };
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(useStore.getState().ui.language, key, vars);
  const relayError = (error: unknown) => {
    const text = errorText(error);
    get().sayLocal(t('chat.core', { error: text }), { muted: true });
    useStore.getState().toast('error', text);
  };

  return {
    root: undefined,
    turns: [],
    busy: false,
    acting: undefined,
    draft: '',

    load(root) {
      if (root === get().root) return;
      set({ root, turns: root ? readTurns(root) : [], busy: false, acting: undefined, draft: '' });
    },

    setDraft(draft) {
      set({ draft });
    },

    async send(message) {
      const text = message.trim();
      const { root, busy } = get();
      if (!text || !root || busy) return;
      const app = useStore.getState();
      const history = toHistory(get().turns);
      push({ role: 'user', text });
      const replyId = push({ role: 'assistant', text: '', streaming: true });
      set({ busy: true, draft: '' });
      try {
        const result = await getClient().narratorChat(
          text,
          { history, ui_language: app.ui.language },
          (delta) => {
            const turn = get().turns.find((item) => item.id === replyId);
            if (turn) patch(replyId, { text: turn.text + delta }, false);
          },
        );
        const action = result.action ? await prepareAction(result.action, t) : undefined;
        patch(replyId, {
          text: result.reply,
          model: result.model,
          costUsd: result.costUsd,
          streaming: false,
          ...(action && action.card ? { action: action.card } : {}),
        });
        if (action) {
          for (const line of action.lines) get().sayLocal(line.text, line.extra);
        }
      } catch (error) {
        const turn = get().turns.find((item) => item.id === replyId);
        const message = errorText(error);
        if (turn && turn.text.length === 0)
          patch(replyId, {
            text: t('chat.core', { error: message }),
            muted: true,
            streaming: false,
          });
        else {
          patch(replyId, { streaming: false, model: null });
          get().sayLocal(t('chat.core', { error: message }), { muted: true });
        }
        app.toast('error', message);
      } finally {
        set({ busy: false });
      }
    },

    clear() {
      commit([]);
    },

    dismissAction(turnId) {
      setActionStatus(turnId, 'dismissed');
    },

    sayLocal(text, extra = {}) {
      return push({ role: 'assistant', text, ...extra });
    },

    async runAction(turnId) {
      const turn = get().turns.find((item) => item.id === turnId);
      const action = turn?.action;
      if (!action || action.status !== 'pending' || get().acting) return;
      const app = useStore.getState();
      const language = app.ui.language;
      set({ acting: turnId });
      try {
        switch (action.id) {
          case 'next':
          case 'finale':
            app.setView('editor');
            void app.write('chapter');
            get().sayLocal(t(action.id === 'next' ? 'chat.gwen.next' : 'chat.gwen.finale.go'));
            break;
          case 'plan':
            app.setView('plan');
            get().sayLocal(t('chat.gwen.plan'));
            break;
          case 'new':
            app.setWizard('new-story');
            get().sayLocal(t('chat.gwen.new'));
            break;
          case 'chronicle': {
            const full = await getClient().chronicleGet(true);
            get().sayLocal(t('chat.gwen.chronicle'), {
              attachment: {
                kind: 'handover',
                handover: (full.handover ?? '').trim(),
                hidden: (full.hidden ?? '').trim(),
              },
            });
            break;
          }
          case 'directions': {
            const { options } = await getClient().canvasDirections({ count: 3 });
            get().sayLocal(t('chat.gwen.directions'), {
              attachment: { kind: 'directions', options },
            });
            break;
          }
          case 'brief': {
            const options = await loadNarratorOptions();
            get().sayLocal(t('chat.gwen.brief'), {
              attachment: { kind: 'brief', text: options.brief_template },
            });
            break;
          }
          default: {
            if (isSettingCommand(action.id) && action.setting) {
              const { key, value } = action.setting;
              await app.updateSettings({ [key]: value });
              const options = await loadNarratorOptions().catch(() => undefined);
              get().sayLocal(
                t('chat.gwen.settingDone', {
                  setting: t(`chat.setting.${key}`),
                  value: settingValueLabel(action.setting, language, options, t),
                }),
              );
            } else {
              get().sayLocal(t('chat.gwen.unknown', { id: action.id }));
            }
          }
        }
        setActionStatus(turnId, 'done');
      } catch (error) {
        relayError(error);
      } finally {
        set({ acting: undefined });
      }
    },
  };
});

type T = (key: string, vars?: Record<string, string | number>) => string;

/** The label of a parsed setting value in the interface language: «высокий», «5 (Кровь и пыль)». */
export function settingValueLabel(
  setting: ParsedSetting,
  language: 'ru' | 'en',
  options: NarratorOptions | undefined,
  t: T,
): string {
  if (setting.key === 'harshness') return harshnessLabel(Number(setting.value), language, options);
  return setting.labelKey ? t(setting.labelKey) : String(setting.value);
}

interface PreparedAction {
  /** The card to attach to the reply, when the command needs the Author's confirmation. */
  card: ChatAction | undefined;
  /** Lines in Gwen's voice to append after the reply (explanations, a question for a value). */
  lines: Array<{
    text: string;
    extra?: Partial<Pick<ChatTurn, 'action' | 'attachment' | 'muted'>>;
  }>;
}

/** Decide what a server-reported command becomes in the panel: a card, an explanation, or both. */
async function prepareAction(match: CommandMatch, t: T): Promise<PreparedAction> {
  const language = useStore.getState().ui.language;
  if (INFORMATIONAL.has(match.id))
    return { card: undefined, lines: [{ text: t(`chat.gwen.${match.id}`) }] };
  if (match.id === 'finale') {
    return {
      card: undefined,
      lines: [{ text: t('chat.gwen.finale'), extra: { action: { ...match, status: 'pending' } } }],
    };
  }
  if (isSettingCommand(match.id)) {
    const options = await loadNarratorOptions().catch(() => undefined);
    const setting = parseSettingArgument(match.id, match.argument, options);
    if (!setting) {
      const values =
        match.id === 'harshness' && options
          ? options.harshness.map((h) => `${h.level} (${h.name[language]})`)
          : SETTING_VALUES[match.id][language];
      return {
        card: undefined,
        lines: [
          {
            text: t('chat.gwen.needValue', {
              setting: t(`chat.setting.${match.id === 'cliff' ? 'cliffhangers' : match.id}`),
              values: values.join(', '),
            }),
          },
        ],
      };
    }
    return { card: { ...match, status: 'pending', setting }, lines: [] };
  }
  return { card: { ...match, status: 'pending' }, lines: [] };
}

/** What the card says Gwen is about to do, in the interface language. */
export function describeAction(
  action: ChatAction,
  language: 'ru' | 'en',
  options: NarratorOptions | undefined,
  t: T,
): string {
  if (action.setting) {
    return t('chat.action.setting', {
      setting: t(`chat.setting.${action.setting.key}`),
      value: settingValueLabel(action.setting, language, options, t),
    });
  }
  return t(`chat.action.${action.id}`);
}
