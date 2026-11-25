/**
 * tauriBridge.ts - Bridge between React JS and the Rust core (Tauri)
 * Auto-detects: in the desktop app it calls the native Rust commands directly.
 * In a web browser it uses a safe fallback.
 */

export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
};

export const getMachineHwid = async (): Promise<string> => {
  try {
    if (isTauri()) {
      // Call the Rust `get_machine_hwid` command registered in src/lib.rs
      const { invoke } = await import('@tauri-apps/api/core');
      const hwid = await invoke<string>('get_machine_hwid');
      if (hwid) {
        localStorage.setItem('viplike_hwid', hwid);
        return hwid;
      }
    }
  } catch (err) {
    console.warn('[Tauri Bridge] Could not call Rust command, using fallback:', err);
  }

  // Fallback when running in a regular web browser
  const saved = localStorage.getItem('viplike_hwid');
  if (saved) return saved;
  const newHwid = `WEB-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  localStorage.setItem('viplike_hwid', newHwid);
  return newHwid;
};

export const getSystemInfo = async (): Promise<Record<string, any>> => {
  try {
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<Record<string, any>>('get_system_info');
    }
  } catch (err) {
    console.warn('[Tauri Bridge] Failed to read system info:', err);
  }

  return {
    os: 'browser',
    arch: 'web',
    app_version: '2.0.0',
    is_tauri: false,
    engine: 'Web Browser Mode',
  };
};

/**
 * Bundled backend (src-tauri/src/backend.rs).
 * Status: starting | installing_browser | running | external | missing | error: <msg> | web
 */
export const getBackendStatus = async (): Promise<string> => {
  if (!isTauri()) return 'web';
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('backend_status');
  } catch {
    return 'external';
  }
};

export const startBackend = async (): Promise<void> => {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('start_backend');
  } catch (err) {
    console.warn('[Tauri Bridge] start_backend failed:', err);
  }
};

/** Must run before installing an update: Windows cannot overwrite a running node.exe. */
export const stopBackend = async (): Promise<void> => {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('stop_backend');
  } catch (err) {
    console.warn('[Tauri Bridge] stop_backend failed:', err);
  }
};
