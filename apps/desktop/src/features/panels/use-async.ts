import { useCallback, useEffect, useState } from 'react';
import { ToolError } from '../../api/mcp.js';

export function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export interface AsyncState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

/** Run an async loader on mount and whenever `key` changes; `reload` runs it again. */
export function useAsync<T>(load: () => Promise<T>, key: string | number): AsyncState<T> {
  const [state, setState] = useState<{ data: T | undefined; error: string | undefined; loading: boolean }>({ data: undefined, error: undefined, loading: true });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    load().then(
      (data) => {
        if (alive) setState({ data, error: undefined, loading: false });
      },
      (error: unknown) => {
        if (alive) setState((s) => ({ ...s, error: errorText(error), loading: false }));
      },
    );
    return () => {
      alive = false;
    };
    // `load` is a fresh closure each render; `key` names what it depends on.
  }, [nonce, key]);
  return { ...state, reload };
}
