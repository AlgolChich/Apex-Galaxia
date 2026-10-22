import type { z } from 'zod';
import { ApexError } from '../util/errors.js';
import { schemaByName, type Language } from '../project/schemas.js';
import { STOP_MARKER, chapterHeading } from '../context/assembler.js';

export interface ProseContractOptions {
  stopMarker?: string;
  /** For chapter mode: the heading the first line must carry. */
  heading?: { language: Language; number: number; title: string };
}

export interface ContractCheck<T = string> {
  value: T;
  violations: string[];
}

const PREAMBLE = /^(?:here(?:'s| is)|sure|certainly|of course|okay|ok|вот|конечно|разумеется|ниже|продолжение:|continuation:)/iu;
const SERVICE_LINE = /^(?:note|notes|примечание|комментарий|гвин|gwen|narrator|рассказчик|\[|\*\*note)[:\s]/iu;

/**
 * Enforce the prose output contract (Section 10.5): strip anything after the stop marker,
 * reject a preamble or service lines, allow a heading only when the task asks for one.
 * Violations are returned, not thrown, so the pipeline can retry once with them appended.
 */
export function enforceProseContract(raw: string, options: ProseContractOptions = {}): ContractCheck {
  const marker = options.stopMarker ?? STOP_MARKER;
  let text = raw;
  const markerAt = text.indexOf(marker);
  if (markerAt >= 0) text = text.slice(0, markerAt);
  text = text.replace(/^\s*```[a-z]*\s*\n/iu, '').replace(/\n```\s*$/u, '');
  text = text.replace(/\r\n/g, '\n').trim();
  const violations: string[] = [];
  const lines = text.split('\n');
  const firstLine = lines.find((l) => l.trim().length > 0) ?? '';

  if (PREAMBLE.test(firstLine.trim())) {
    violations.push(`The response starts with a preamble («${firstLine.trim().slice(0, 40)}»); begin directly with the prose.`);
  }
  if (options.heading) {
    const expected = chapterHeading(options.heading.language, options.heading.number, options.heading.title);
    const normalized = firstLine.replace(/^#+\s*/u, '').replace(/[*_]/g, '').trim();
    if (normalized.toLowerCase() !== expected.toLowerCase()) {
      violations.push(`The first line must be the chapter heading «${expected}», got «${firstLine.trim().slice(0, 60)}».`);
    } else {
      lines[lines.indexOf(firstLine)] = expected;
      text = lines.join('\n');
    }
    const extraHeadings = lines.slice(1).filter((l) => /^#{1,6}\s/u.test(l));
    if (extraHeadings.length > 0) violations.push(`Headings inside the prose: ${extraHeadings.length}.`);
  } else {
    const headings = lines.filter((l) => /^#{1,6}\s/u.test(l));
    if (headings.length > 0) violations.push(`The prose contains ${headings.length} heading line(s); prose only.`);
  }
  const service = lines.filter((l) => SERVICE_LINE.test(l.trim()));
  if (service.length > 0) violations.push(`Service lines in the output: «${service[0]!.trim().slice(0, 40)}».`);
  if (text.length === 0) violations.push('Empty response.');
  return { value: text, violations };
}

/** Extract a JSON object from a response that may wrap it in a fence or trailing prose. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(trimmed);
  const candidate = fenced ? fenced[1]! : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new ApexError('CONTRACT_VIOLATION', 'The response is not JSON');
  }
}

/** Validate a JSON response against a named schema; returns violations for a retry. */
export function enforceJsonContract<T = unknown>(raw: string | unknown, schemaName: string): ContractCheck<T | undefined> {
  const schema = schemaByName(schemaName);
  if (!schema) {
    throw new ApexError('INVALID_ARGUMENT', `Unknown output schema ${schemaName}`, { schemaName });
  }
  let value: unknown;
  try {
    value = typeof raw === 'string' ? extractJson(raw) : raw;
  } catch (error) {
    return { value: undefined, violations: [error instanceof Error ? error.message : String(error)] };
  }
  const parsed = (schema as z.ZodType<T>).safeParse(value);
  if (!parsed.success) {
    return {
      value: undefined,
      violations: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  return { value: parsed.data, violations: [] };
}
