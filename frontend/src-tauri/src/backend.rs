//! Runs the bundled Node backend (resources/node + resources/backend) next to the app.
//!
//! - If something already listens on 127.0.0.1:3100 (dev: `node server.js` running), nothing is spawned.
//! - Data, Via profiles and logs go to the user's app-data folder (the install folder is read-only on Windows).
//! - Chromium for Playwright is installed on first launch into the local app-data folder.
//! - The backend is killed when the app exits and before an update is installed.

use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};

pub const BACKEND_PORT: u16 = 3100;

#[derive(Default)]
pub struct BackendState {
    child: Mutex<Option<Child>>,
    /// starting | installing_browser | running | external | missing | error: <msg>
    status: Mutex<String>,
}

fn set_status(app: &AppHandle, s: impl Into<String>) {
    let s = s.into();
    log::info!("[backend] {s}");
    *app.state::<BackendState>().status.lock().unwrap() = s;
}

fn port_in_use() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], BACKEND_PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

fn has_chromium(browsers_dir: &Path) -> bool {
    fs::read_dir(browsers_dir)
        .map(|it| {
            it.flatten()
                .any(|e| e.file_name().to_string_lossy().starts_with("chromium"))
        })
        .unwrap_or(false)
}

struct Paths {
    node: PathBuf,
    backend_dir: PathBuf,
    data_dir: PathBuf,
    profiles_dir: PathBuf,
    browsers_dir: PathBuf,
    log_file: PathBuf,
}

fn resolve_paths(app: &AppHandle) -> Result<Paths, String> {
    let res = app.path().resource_dir().map_err(|e| e.to_string())?;
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let roaming = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let local = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(Paths {
        node: res.join("node").join(node_name),
        backend_dir: res.join("backend"),
        data_dir: roaming.join("data"),
        profiles_dir: roaming.join("browser_profiles"),
        browsers_dir: local.join("ms-playwright"),
        log_file: roaming.join("logs").join("backend.log"),
    })
}

fn base_command(p: &Paths, log: &fs::File) -> Result<Command, String> {
    let mut cmd = Command::new(&p.node);
    cmd.current_dir(&p.backend_dir)
        .env("PORT", BACKEND_PORT.to_string())
        .env("NODE_ENV", "production")
        .env("VIPLIKE_DATA_DIR", &p.data_dir)
        .env("VIPLIKE_PROFILES_DIR", &p.profiles_dir)
        .env("PLAYWRIGHT_BROWSERS_PATH", &p.browsers_dir)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log.try_clone().map_err(|e| e.to_string())?);
    hide_console(&mut cmd);
    Ok(cmd)
}

fn run(app: &AppHandle) -> Result<(), String> {
    if port_in_use() {
        set_status(app, "external");
        return Ok(());
    }
    let p = resolve_paths(app)?;
    if !p.node.exists() || !p.backend_dir.join("server.js").exists() {
        // Dev build without `scripts/prepare-backend-bundle.mjs`: start the backend yourself.
        set_status(app, "missing");
        return Ok(());
    }
    for d in [&p.data_dir, &p.profiles_dir, &p.browsers_dir] {
        fs::create_dir_all(d).map_err(|e| format!("create {}: {e}", d.display()))?;
    }
    if let Some(parent) = p.log_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&p.log_file)
        .map_err(|e| format!("open log: {e}"))?;

    // Playwright browser: a no-op when already installed, a ~150MB download the first time.
    if !has_chromium(&p.browsers_dir) {
        set_status(app, "installing_browser");
    }
    let cli = p.backend_dir.join("node_modules").join("playwright").join("cli.js");
    let ok = base_command(&p, &log)?
        .arg(cli)
        .args(["install", "chromium"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok && !has_chromium(&p.browsers_dir) {
        return Err("could not download Chromium (check the internet connection)".into());
    }

    set_status(app, "starting");
    let child = base_command(&p, &log)?
        .arg("server.js")
        .spawn()
        .map_err(|e| format!("spawn node: {e}"))?;
    *app.state::<BackendState>().child.lock().unwrap() = Some(child);
    set_status(app, "running");
    Ok(())
}

/// Starts the backend on a background thread (the window opens right away).
pub fn start(app: &AppHandle) {
    {
        let state = app.state::<BackendState>();
        let mut child = state.child.lock().unwrap();
        if let Some(c) = child.as_mut() {
            if matches!(c.try_wait(), Ok(None)) {
                return; // still running
            }
            *child = None;
        }
    }
    set_status(app, "starting");
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = run(&app) {
            set_status(&app, format!("error: {e}"));
        }
    });
}

pub fn stop(app: &AppHandle) {
    let state = app.state::<BackendState>();
    let child = state.child.lock().unwrap().take();
    if let Some(mut c) = child {
        let _ = c.kill();
        let _ = c.wait();
        log::info!("[backend] stopped");
    }
}

#[tauri::command]
pub fn backend_status(app: AppHandle) -> String {
    let state = app.state::<BackendState>();
    let mut child = state.child.lock().unwrap();
    if let Some(c) = child.as_mut() {
        if let Ok(Some(code)) = c.try_wait() {
            *child = None;
            drop(child);
            set_status(&app, format!("error: backend exited ({code})"));
        }
    }
    state.status.lock().unwrap().clone()
}

#[tauri::command]
pub fn start_backend(app: AppHandle) {
    start(&app);
}

#[tauri::command]
pub fn stop_backend(app: AppHandle) {
    stop(&app);
}
