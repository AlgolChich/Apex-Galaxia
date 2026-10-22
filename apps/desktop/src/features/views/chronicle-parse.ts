export interface ChronicleSection {
  chapter: number;
  heading: string;
  text: string;
}

const HEADING = /^##\s+(?:Глава|Chapter)\s+(\d+)\s*$/u;

/**
 * `chronicle/chronicle.md`: a title and a note, then one `## Глава N` / `## Chapter N` block per
 * chapter (packages/core/src/chronicle/chronicle.ts, `appendLog`). Sections come back in file
 * order; the view shows them newest first.
 */
export function parseChronicleLog(log: string): { intro: string; sections: ChronicleSection[] } {
  const introLines: string[] = [];
  const sections: ChronicleSection[] = [];
  let current: ChronicleSection | undefined;
  for (const raw of log.split(/\r?\n/)) {
    const match = HEADING.exec(raw.trim());
    if (match) {
      if (current) current.text = current.text.trim();
      current = { chapter: Number(match[1]), heading: raw.trim().replace(/^##\s+/, ''), text: '' };
      sections.push(current);
      continue;
    }
    if (current) current.text += `${raw}\n`;
    else introLines.push(raw);
  }
  if (current) current.text = current.text.trim();
  return { intro: introLines.join('\n').trim(), sections };
}
