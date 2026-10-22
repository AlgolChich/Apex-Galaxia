import { useEffect, useState } from 'react';
import { getClient } from '../../api/index.js';
import type { NarratorOptions } from '../../api/types.js';

let cached: NarratorOptions | undefined;
let inflight: Promise<NarratorOptions> | undefined;

/** `narrator_options` once per session: the profile is data shipped with the app and never changes at runtime. */
export function loadNarratorOptions(): Promise<NarratorOptions> {
  if (cached) return Promise.resolve(cached);
  inflight ??= getClient()
    .narratorOptions()
    .then(
      (options) => {
        cached = options;
        inflight = undefined;
        return options;
      },
      (error: unknown) => {
        inflight = undefined;
        throw error;
      },
    );
  return inflight;
}

/** For tests and after a sidecar reset: forget the cached profile. */
export function resetNarratorOptions(): void {
  cached = undefined;
  inflight = undefined;
}

export function useNarratorOptions(): { options: NarratorOptions | undefined; error: string | undefined } {
  const [options, setOptions] = useState<NarratorOptions | undefined>(cached);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadNarratorOptions().then(
      (loaded) => {
        if (live) setOptions(loaded);
      },
      (failure: unknown) => {
        if (live) setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return { options, error };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
