#[tauri::command]
fn get_machine_hwid() -> String {
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "DEVICE".to_string());
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "USER".to_string());
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let raw = format!("{}:{}:{}:{}", os, arch, hostname, user);
    let mut hash: u64 = 5381;
    for byte in raw.bytes() {
        hash = ((hash << 5).wrapping_add(hash)).wrapping_add(byte as u64);
    }
    format!("HWID-{:08X}-{:04X}", hash & 0xFFFFFFFF, (hash >> 32) & 0xFFFF)
}

#[tauri::command]
fn get_system_info() -> serde_json::Value {
    serde_json::json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "app_version": "2.0.0",
        "is_tauri": true,
        "engine": "Tauri v2 (Rust Core)"
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_machine_hwid, get_system_info])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
