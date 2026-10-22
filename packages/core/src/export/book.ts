import path from 'node:path';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import JSZip from 'jszip';
import { countWords } from '../util/fs.js';
import { slugify } from '../util/slug.js';
import { chapterHeading } from '../context/assembler.js';
import type { Language } from '../project/schemas.js';
import type { ChapterFile, ProjectStore } from '../project/store.js';
import { writeTextAtomic } from '../util/fs.js';
import fs from 'node:fs/promises';

export type ExportFormat = 'md' | 'docx' | 'epub';

export interface ExportResult {
  file: string;
  format: ExportFormat;
  chapters: number;
  words: number;
}

interface Book {
  title: string;
  language: Language;
  author: string | undefined;
  chapters: ChapterFile[];
}

function paragraphsOf(body: string): string[] {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** Markdown: one file, the title as H1, every chapter as H2 with its heading in the story language. */
export function renderMarkdown(book: Book): string {
  const parts = [`# ${book.title}`, ''];
  for (const ch of book.chapters) {
    parts.push(`## ${chapterHeading(book.language, ch.front.number, ch.front.title)}`, '', ch.body.trim(), '');
  }
  return parts.join('\n') + '\n';
}

/**
 * DOCX through the `docx` library: Title, Heading 1 per chapter, body paragraphs in a serif
 * face with Cyrillic coverage, first-line indents, no blank lines between paragraphs. Opens in
 * Word, LibreOffice and Pages.
 */
export async function renderDocx(book: Book): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: book.title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
  ];
  for (const ch of book.chapters) {
    children.push(new Paragraph({ text: chapterHeading(book.language, ch.front.number, ch.front.title), heading: HeadingLevel.HEADING_1, pageBreakBefore: true }));
    for (const p of paragraphsOf(ch.body)) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: p, font: 'PT Serif', size: 24 })],
          indent: { firstLine: 567 },
          spacing: { after: 0, line: 336 },
        }),
      );
    }
  }
  const doc = new Document({
    creator: book.author ?? 'Apex Galaxia',
    title: book.title,
    description: `Exported by Apex Galaxia (${book.language})`,
    styles: {
      default: { document: { run: { font: 'PT Serif', size: 24 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, font: 'PT Serif' }, paragraph: { spacing: { before: 480, after: 240 } } },
      ],
    },
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}

function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xhtml(title: string, lang: Language, bodyHtml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
  <meta charset="utf-8"/>
  <title>${xmlEscape(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

const EPUB_CSS = `body { font-family: "PT Serif", "Literata", Georgia, serif; line-height: 1.5; margin: 0 5%; }
h1 { font-size: 1.5em; margin: 2em 0 1em; text-align: left; page-break-before: always; }
h1.title { text-align: center; page-break-before: auto; margin-top: 30%; }
p { margin: 0; text-indent: 1.5em; }
p.first { text-indent: 0; }
`;

/**
 * EPUB 3 built with JSZip: the `mimetype` entry first and stored, `META-INF/container.xml`,
 * `OEBPS/content.opf` with metadata, manifest and spine, `nav.xhtml`, one XHTML file per chapter.
 */
export async function renderEpub(book: Book): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`);
  const id = `urn:uuid:${slugify(book.title)}-${Date.now().toString(16)}`;
  const items: string[] = [];
  const spine: string[] = [];
  const navItems: string[] = [];
  zip.file('OEBPS/style.css', EPUB_CSS);
  zip.file('OEBPS/title.xhtml', xhtml(book.title, book.language, `<h1 class="title">${xmlEscape(book.title)}</h1>`));
  items.push('<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>');
  spine.push('<itemref idref="title"/>');
  for (const ch of book.chapters) {
    const name = `chapter-${String(ch.front.number).padStart(2, '0')}.xhtml`;
    const heading = chapterHeading(book.language, ch.front.number, ch.front.title);
    const paragraphs = paragraphsOf(ch.body).map((p, i) => `<p${i === 0 ? ' class="first"' : ''}>${xmlEscape(p)}</p>`).join('\n');
    zip.file(`OEBPS/${name}`, xhtml(heading, book.language, `<h1>${xmlEscape(heading)}</h1>\n${paragraphs}`));
    const itemId = `ch${ch.front.number}`;
    items.push(`<item id="${itemId}" href="${name}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${itemId}"/>`);
    navItems.push(`<li><a href="${name}">${xmlEscape(heading)}</a></li>`);
  }
  zip.file(
    'OEBPS/nav.xhtml',
    xhtml(book.language === 'ru' ? 'Оглавление' : 'Contents', book.language, `<nav epub:type="toc" id="toc"><h1>${book.language === 'ru' ? 'Оглавление' : 'Contents'}</h1><ol>\n${navItems.join('\n')}\n</ol></nav>`),
  );
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${book.language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${id}</dc:identifier>
    <dc:title>${xmlEscape(book.title)}</dc:title>
    <dc:language>${book.language}</dc:language>
    <dc:creator>${xmlEscape(book.author ?? 'Apex Galaxia')}</dc:creator>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${items.join('\n    ')}
  </manifest>
  <spine>
    ${spine.join('\n    ')}
  </spine>
</package>
`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
}

/** Export the manuscript of a project in the requested format into exports/ (or `outFile`). */
export async function exportBook(store: ProjectStore, format: ExportFormat, outFile?: string, author?: string): Promise<ExportResult> {
  const chapters = await store.listChapters();
  const book: Book = { title: store.config.title, language: store.config.language, author, chapters };
  const words = chapters.reduce((n, c) => n + countWords(c.body), 0);
  const file = outFile ?? path.join(store.layout.exports, `${slugify(store.config.title)}.${format}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (format === 'md') {
    await writeTextAtomic(file, renderMarkdown(book));
  } else if (format === 'docx') {
    await fs.writeFile(file, await renderDocx(book));
  } else {
    await fs.writeFile(file, await renderEpub(book));
  }
  return { file, format, chapters: chapters.length, words };
}
