/**
 * tauriBridge.ts - Cầu nối giao tiếp giữa React JS và Rust Core (Tauri)
 * Tự động nhận diện: Khi chạy app desktop sẽ gọi trực tiếp các lệnh native của Rust.
 * Khi chạy trên web browser sẽ sử dụng fallback an toàn.
 */

export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
};

export const getMachineHwid = async (): Promise<string> => {
  try {
    if (isTauri()) {
      // Gọi trực tiếp hàm Rust `get_machine_hwid` đã đăng ký trong src/lib.rs
      const { invoke } = await import('@tauri-apps/api/core');
      const hwid = await invoke<string>('get_machine_hwid');
      if (hwid) return hwid;
    }
  } catch (err) {
    console.warn('[Tauri Bridge] Không gọi được lệnh Rust, chuyển sang fallback:', err);
  }

  // Fallback khi chạy trên trình duyệt web thông thường
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
    console.warn('[Tauri Bridge] Lỗi lấy thông tin hệ thống:', err);
  }

  return {
    os: 'browser',
    arch: 'web',
    app_version: '2.0.0',
    is_tauri: false,
    engine: 'Web Browser Mode',
  };
};
