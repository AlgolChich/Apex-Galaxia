/**
 * Error type for everything the core reports to a client (CLI, MCP server, app).
 * The `code` is stable and machine-readable; the message is for humans.
 */
export type ApexErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_EXISTS'
  | 'INVALID_FILE'
  | 'MIGRATION_REQUIRED'
  | 'UNSUPPORTED_FORMAT_VERSION'
  | 'CHAPTER_NOT_FOUND'
  | 'ENTRY_NOT_FOUND'
  | 'TEMPLATE_NOT_FOUND'
  | 'NARRATOR_NOT_FOUND'
  | 'CONTRACT_VIOLATION'
  | 'BUDGET_EXCEEDED'
  | 'ADAPTER_ERROR'
  | 'HARD_LIMIT'
  | 'INVALID_ARGUMENT';

export class ApexError extends Error {
  readonly code: ApexErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ApexErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApexError';
    this.code = code;
    this.details = details;
  }
}

export function isApexError(value: unknown): value is ApexError {
  return value instanceof ApexError;
}
