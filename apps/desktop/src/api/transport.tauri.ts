import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import type { JsonRpcMessage, ShellServices, SidecarStatus, Transport } from './transport.js';

/**
 * The desktop transport (ADR 0010). Rust commands and events this file relies on, all
 * implemented in `src-tauri/src`:
 *
 * - `apex_send { message: string }`: write one JSON line to the sidecar's stdin.
 * - event `apex://message` with a string payload: one JSON line from the sidecar's stdout.
 * - event `apex://reset` with a SidecarStatus payload: the sidecar died or was restarted.
 * - `sidecar_status() -> SidecarStatus`, `sidecar_restart() -> SidecarStatus`.
 * - `key_set { key }`, `key_exists() -> bool`, `key_delete()`: the OS keychain.
 * - `app_paths() -> { resources, userDir, appData }`.
 */
export class TauriTransport implements Transport {
  readonly kind = 'tauri' as const;
  private readonly handlers = new Set<(message: JsonRpcMessage) => void>();
  private readonly resetHandlers = new Set<(status: SidecarStatus) => void>();
  private listening: Promise<void> | undefined;

  readonly shell: ShellServices = {
    keySet: (key) => invoke<void>('key_set', { key }),
    keyExists: () => invoke<boolean>('key_exists'),
    keyDelete: () => invoke<void>('key_delete'),
    pickFolder: async (options) => {
      const picked = await open({ directory: true, multiple: false, ...(options?.title ? { title: options.title } : {}), ...(options?.defaultPath ? { defaultPath: options.defaultPath } : {}) });
      return typeof picked === 'string' ? picked : undefined;
    },
    pickFile: async (options) => {
      const picked = await open({ directory: false, multiple: false, ...(options?.title ? { title: options.title } : {}), ...(options?.filters ? { filters: options.filters } : {}) });
      return typeof picked === 'string' ? picked : undefined;
    },
    openPath: (path) => openPath(path),
    paths: () => invoke<{ resources: string; userDir: string; appData: string }>('app_paths'),
  };

  private ensureListening(): Promise<void> {
    this.listening ??= (async () => {
      await listen<string>('apex://message', (event) => {
        try {
          const message = JSON.parse(event.payload) as JsonRpcMessage;
          for (const handler of this.handlers) handler(message);
        } catch {
          // a non-JSON line (a stray console.log in the sidecar) is ignored
        }
      });
      await listen<SidecarStatus>('apex://reset', (event) => {
        for (const handler of this.resetHandlers) handler(event.payload);
      });
    })();
    return this.listening;
  }

  async send(message: JsonRpcMessage): Promise<void> {
    await this.ensureListening();
    await invoke<void>('apex_send', { message: JSON.stringify(message) });
  }

  onMessage(handler: (message: JsonRpcMessage) => void): () => void {
    void this.ensureListening();
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onReset(handler: (status: SidecarStatus) => void): () => void {
    void this.ensureListening();
    this.resetHandlers.add(handler);
    return () => this.resetHandlers.delete(handler);
  }

  status(): Promise<SidecarStatus> {
    return invoke<SidecarStatus>('sidecar_status');
  }

  restart(): Promise<SidecarStatus> {
    return invoke<SidecarStatus>('sidecar_restart');
  }
}
