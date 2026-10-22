/**
 * Deterministic Russian dialogue typography (Section 7.4), applied to generated prose before
 * a suggestion is shown. It touches punctuation only: dialogue dashes, quotation marks around
 * speech, spacing. Word choice and paragraphing stay as they are. Every change is reported so
 * the inspector can show what was normalized.
 */
export interface NormalizeResult {
  text: string;
  changes: string[];
}

const EM = '—';

function isSpeechLine(line: string): boolean {
  return /^\s*(?:["“„«])[^"“”„«»]+(?:["”“»])(?:[,.!?…]*\s*[—–-]\s*[^"“”„«»]*)?\s*$/u.test(line);
}

export function normalizeRussianDialogue(input: string): NormalizeResult {
  const changes: string[] = [];
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const out = lines.map((line, index) => {
    let next = line;
    const where = `line ${index + 1}`;

    // "- Реплика" or "– Реплика" at the start of a paragraph → "— Реплика"
    if (/^\s*[-–]\s+\S/u.test(next)) {
      next = next.replace(/^(\s*)[-–]\s+/u, `$1${EM} `);
      changes.push(`${where}: dialogue dash normalized to «—»`);
    }
    // "—Реплика" → "— Реплика"
    if (/^\s*—\S/u.test(next)) {
      next = next.replace(/^(\s*)—(?=\S)/u, `$1${EM} `);
      changes.push(`${where}: space after the dialogue dash`);
    }
    // "Реплика", — сказал он.  →  — Реплика, — сказал он.
    if (isSpeechLine(next)) {
      const m = /^(\s*)["“„«]([^"“”„«»]+)["”“»]([,.!?…]*)\s*(?:[—–-]\s*(.*))?$/u.exec(next);
      if (m) {
        const lead = m[1] ?? '';
        let speech = `${(m[2] ?? '').trim()}${m[3] ?? ''}`;
        const tail = (m[4] ?? '').trim();
        if (tail) {
          // Before attribution a full stop becomes a comma; ? ! … stay; a bare line gets a comma.
          if (speech.endsWith('.')) speech = `${speech.slice(0, -1)},`;
          else if (!/[?!…,]$/u.test(speech)) speech = `${speech},`;
          next = `${lead}${EM} ${speech} ${EM} ${tail}`;
        } else {
          next = `${lead}${EM} ${speech}`;
        }
        changes.push(`${where}: quoted speech set with a dialogue dash`);
      }
    }
    // "— Реплика. — сказал он." → "— Реплика, — сказал он." (attribution verbs only)
    const attributed = next.replace(
      /\.\s—\s(сказал|сказала|спросил|спросила|ответил|ответила|произнёс|произнесла|добавил|добавила|повторил|повторила|заметил|заметила)(?![\p{L}])/gu,
      (_whole, verb: string) => {
        changes.push(`${where}: comma before «${verb}»`);
        return `, ${EM} ${verb}`;
      },
    );
    next = attributed;
    // Double spaces around dashes inside a line
    const spaced = next.replace(/\s{2,}—\s*|\s*—\s{2,}/gu, ` ${EM} `);
    if (spaced !== next) {
      next = spaced;
      changes.push(`${where}: spacing around a dash`);
    }
    return next;
  });
  return { text: out.join('\n'), changes };
}
