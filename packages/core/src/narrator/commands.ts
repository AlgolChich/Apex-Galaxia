import type { NarratorProfile } from './profile.js';

/**
 * The narrator's command vocabulary (Section 5.1): `/дальше`, `next`, `/летопись`… The app
 * and the MCP tool recognize a command deterministically before any model runs, so a plain
 * «дальше» never costs a call and never depends on the model noticing it.
 */
export interface CommandMatch {
  /** The English command name from commands.yaml: new, brief, dossier, plan, next, rating… */
  id: string;
  /** Everything after the command word, trimmed (a value, a request, or empty). */
  argument: string;
}

type Command = NarratorProfile['commands'][number];

function words(command: Command): { ru: string; en: string } {
  const strip = (s: string) => s.replace(/\[.*?\]/g, '').replace(/^\//, '').trim().toLowerCase();
  return { ru: strip(command.ru), en: strip(command.en) };
}

export function matchNarratorCommand(text: string, commands: NarratorProfile['commands']): CommandMatch | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const slash = trimmed.startsWith('/');
  const [head = '', ...rest] = trimmed.replace(/^\//, '').split(/\s+/);
  const key = head.toLowerCase().replace(/[.,!?;:]+$/, '');
  for (const command of commands) {
    const w = words(command);
    if (key === w.ru || key === w.en) {
      const argument = rest.join(' ').trim();
      // Without a slash only the bare word counts: «дальше» yes, «дальше по улице шёл дождь» no.
      if (!slash && argument.length > 0 && !['rating', 'length', 'storyteller', 'harshness', 'cliff', 'rewrite', 'portrait'].includes(w.en)) return undefined;
      return { id: w.en, argument };
    }
  }
  return undefined;
}

/** One line per command for the chat prompt. */
export function renderCommands(commands: NarratorProfile['commands']): string {
  return commands.map((c) => `- ${c.en} (${c.ru}): ${c.meaning.en} / ${c.meaning.ru}`).join('\n');
}

/** Pull a trailing `>> action: <id> <argument>` line out of a chat reply. */
export function parseChatAction(reply: string, commands: NarratorProfile['commands']): { reply: string; action?: CommandMatch } {
  const lines = reply.trimEnd().split('\n');
  const last = lines[lines.length - 1]?.trim() ?? '';
  const m = /^>>\s*action:\s*([a-z]+)\s*(.*)$/i.exec(last);
  if (!m) return { reply: reply.trim() };
  const id = m[1]!.toLowerCase();
  const known = commands.some((c) => words(c).en === id);
  if (!known) return { reply: reply.trim() };
  return { reply: lines.slice(0, -1).join('\n').trim(), action: { id, argument: (m[2] ?? '').trim() } };
}
