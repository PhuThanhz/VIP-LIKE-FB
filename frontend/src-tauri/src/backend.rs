//! Runs the bundled Node backend (resources/node + resources/backend) next to the app.
//!
//! - If something already listens on 127.0.0.1:3100 (dev: `node server.js` running), nothing is spawned.
//! - Data, Via profiles and logs go to the user's app-data folder (the install folder is read-only on Windows).
//! - Chromium for Playwright is installed on first launch; a failed download is a warning, not fatal.
//! - The backend's stdin is a pipe held by the app: when the app quits or crashes the pipe closes and the
//!   backend shuts itself down (no orphan node.exe holding port 3100 or blocking an update).
//! - Errors carry the tail of the log so the cause is visible on screen.

use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

pub const BACKEND_PORT: u16 = 3100;

#[derive(Default)]
pub struct BackendState {
    child: Mutex<Option<Child>>,
    /// starting | installing_browser | running | external | missing | error: <msg>
    status: Mutex<String>,
    log_file: Mutex<Option<PathBuf>>,
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

/// Tauri canonicalizes app paths, which on Windows gives `\\?\C:\...`.
/// Node (module resolution, Playwright's CLI) does not cope with that prefix, so strip it
/// for normal drive paths (keep `\\?\UNC\...`).
fn plain_path(p: PathBuf) -> PathBuf {
    if cfg!(windows) {
        if let Some(rest) = p.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
            if !rest.starts_with(r"UNC\") {
                return PathBuf::from(rest);
            }
        }
    }
    p
}

fn log_tail(path: &Path) -> String {
    let text = fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(15)..].join("\n")
}

fn log_stdio(path: &Path) -> Result<(Stdio, Stdio), String> {
    let f = fs::File::create(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let f2 = f.try_clone().map_err(|e| e.to_string())?;
    Ok((Stdio::from(f), Stdio::from(f2)))
}

struct Paths {
    node: PathBuf,
    backend_dir: PathBuf,
    data_dir: PathBuf,
    profiles_dir: PathBuf,
    browsers_dir: PathBuf,
    logs_dir: PathBuf,
}

fn resolve_paths(app: &AppHandle) -> Result<Paths, String> {
    let res = plain_path(app.path().resource_dir().map_err(|e| e.to_string())?);
    let roaming = plain_path(app.path().app_data_dir().map_err(|e| e.to_string())?);
    let local = plain_path(app.path().app_local_data_dir().map_err(|e| e.to_string())?);
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    Ok(Paths {
        node: res.join("node").join(node_name),
        backend_dir: res.join("backend"),
        data_dir: roaming.join("data"),
        profiles_dir: roaming.join("browser_profiles"),
        browsers_dir: local.join("ms-playwright"),
        logs_dir: roaming.join("logs"),
    })
}

fn node_command(p: &Paths) -> Command {
    let mut cmd = Command::new(&p.node);
    cmd.current_dir(&p.backend_dir)
        .env("PORT", BACKEND_PORT.to_string())
        .env("NODE_ENV", "production")
        .env("VIPLIKE_DATA_DIR", &p.data_dir)
        .env("VIPLIKE_PROFILES_DIR", &p.profiles_dir)
        .env("PLAYWRIGHT_BROWSERS_PATH", &p.browsers_dir);
    hide_console(&mut cmd);
    cmd
}

/// Downloads Chromium once (marker file), or again after an update changed the Playwright version.
fn ensure_chromium(app: &AppHandle, p: &Paths) -> Result<(), String> {
    let pkg = p.backend_dir.join("node_modules").join("playwright").join("package.json");
    let version = fs::read_to_string(&pkg)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["version"].as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".into());
    let marker = p.browsers_dir.join(".installed");
    if fs::read_to_string(&marker).ok().as_deref() == Some(version.as_str()) {
        return Ok(());
    }
    set_status(app, "installing_browser");
    let log = p.logs_dir.join("playwright-install.log");
    let (out, err) = log_stdio(&log)?;
    let status = node_command(p)
        .arg(p.backend_dir.join("node_modules").join("playwright").join("cli.js"))
        .args(["install", "chromium", "chromium-headless-shell"])
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err)
        .status()
        .map_err(|e| format!("run playwright install: {e}"))?;
    if !status.success() {
        return Err(format!("Chromium download failed ({status}).\n{}", log_tail(&log)));
    }
    let _ = fs::write(marker, version);
    Ok(())
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
    for d in [&p.data_dir, &p.profiles_dir, &p.browsers_dir, &p.logs_dir] {
        fs::create_dir_all(d).map_err(|e| format!("create {}: {e}", d.display()))?;
    }

    if let Err(e) = ensure_chromium(app, &p) {
        // Not fatal: login, license and Via management still work; buffs need the browser.
        log::warn!("[backend] {e}");
    }

    set_status(app, "starting");
    let log = p.logs_dir.join("backend.log");
    *app.state::<BackendState>().log_file.lock().unwrap() = Some(log.clone());
    let (out, err) = log_stdio(&log)?;
    let child = node_command(&p)
        .arg("server.js")
        .env("VIPLIKE_PARENT_PIPE", "1")
        .stdin(Stdio::piped())
        .stdout(out)
        .stderr(err)
        .spawn()
        .map_err(|e| format!("spawn {}: {e}", p.node.display()))?;
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

/// Closes the backend's stdin (it flushes data and exits), then kills it if it is still alive after 5s.
pub fn stop(app: &AppHandle) {
    let state = app.state::<BackendState>();
    let child = state.child.lock().unwrap().take();
    if let Some(mut c) = child {
        drop(c.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = c.try_wait() {
                log::info!("[backend] stopped");
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = c.kill();
        let _ = c.wait();
        log::info!("[backend] killed");
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
            let tail = state
                .log_file
                .lock()
                .unwrap()
                .as_deref()
                .map(log_tail)
                .unwrap_or_default();
            set_status(&app, format!("error: backend exited ({code}).\n{tail}"));
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
