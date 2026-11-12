#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    error::Error,
    fs,
    path::Path,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_updater::UpdaterExt;

/* ---------- File-based store (replaces browser localStorage) ---------- */

struct Store {
    path: PathBuf,
    data: Mutex<HashMap<String, String>>,
}

impl Store {
    fn load(path: PathBuf) -> Self {
        let data = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<HashMap<String, String>>(&s).ok())
            .unwrap_or_default();
        Store { path, data: Mutex::new(data) }
    }

    fn get(&self, key: &str) -> Option<String> {
        self.data.lock().ok().and_then(|d| d.get(key).cloned())
    }

    // Write to a temp file, then rename, so a crash never leaves a half-written store.
    fn flush(&self, data: &HashMap<String, String>) -> Result<(), String> {
        let json = serde_json::to_string(data).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn store_get(state: State<'_, Store>, key: String) -> Option<String> {
    state.data.lock().ok().and_then(|d| d.get(&key).cloned())
}

#[tauri::command]
fn store_set(state: State<'_, Store>, key: String, value: String) -> Result<(), String> {
    let mut d = state.data.lock().map_err(|e| e.to_string())?;
    d.insert(key, value);
    state.flush(&d)
}

#[tauri::command]
fn store_delete(state: State<'_, Store>, key: String) -> Result<(), String> {
    let mut d = state.data.lock().map_err(|e| e.to_string())?;
    d.remove(&key);
    state.flush(&d)
}

#[tauri::command]
fn store_list(state: State<'_, Store>, prefix: Option<String>) -> Vec<String> {
    let p = prefix.unwrap_or_default();
    state
        .data
        .lock()
        .map(|d| d.keys().filter(|k| k.starts_with(&p)).cloned().collect())
        .unwrap_or_default()
}

// UTC date as YYYY-MM-DD without pulling in a date crate.
fn today_ymd() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as i64;
    let z = secs / 86_400 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{:04}-{:02}-{:02}", y, m, d)
}

// One copy of the store per day, newest 14 kept. Best effort: never blocks startup.
fn daily_backup(dir: &Path, store_path: &Path) {
    if !store_path.exists() {
        return;
    }
    let backups = dir.join("backups");
    if fs::create_dir_all(&backups).is_err() {
        return;
    }
    let target = backups.join(format!("store-{}.json", today_ymd()));
    if !target.exists() {
        let _ = fs::copy(store_path, &target);
    }
    if let Ok(entries) = fs::read_dir(&backups) {
        let mut files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("store-") && n.ends_with(".json"))
                    .unwrap_or(false)
            })
            .collect();
        files.sort();
        if files.len() > 14 {
            for old in &files[..files.len() - 14] {
                let _ = fs::remove_file(old);
            }
        }
    }
}

/* ---------- Network bridge: AI calls run here, so CORS never applies ---------- */

#[derive(Deserialize)]
struct FetchReq {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
}

#[derive(Serialize, Default)]
struct FetchRes {
    ok: bool,
    status: u16,
    text: String,
    error: Option<String>,
    headers: std::collections::HashMap<String, String>,
}

fn describe(e: reqwest::Error) -> String {
    if e.is_timeout() {
        return "Request timed out after 120 s".into();
    }
    let mut msg = e.to_string();
    let mut src = e.source();
    while let Some(s) = src {
        msg.push_str(": ");
        msg.push_str(&s.to_string());
        src = s.source();
    }
    msg
}

async fn do_fetch(req: FetchReq) -> Result<FetchRes, String> {
    if !(req.url.starts_with("http://") || req.url.starts_with("https://")) {
        return Err("Only http(s) URLs are allowed".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let verb = req.method.unwrap_or_else(|| "GET".into()).to_uppercase();
    let method = reqwest::Method::from_bytes(verb.as_bytes()).map_err(|e| e.to_string())?;
    let mut rb = client.request(method, &req.url);
    if let Some(h) = req.headers {
        for (k, v) in h {
            rb = rb.header(k, v);
        }
    }
    if let Some(b) = req.body {
        rb = rb.body(b);
    }
    let res = rb.send().await.map_err(describe)?;
    let status = res.status();
    let mut headers = std::collections::HashMap::new();
    for (k, v) in res.headers().iter() {
        if let Ok(s) = v.to_str() {
            headers.insert(k.as_str().to_lowercase(), s.to_string());
        }
    }
    let text = res.text().await.map_err(describe)?;
    Ok(FetchRes { ok: status.is_success(), status: status.as_u16(), text, error: None, headers })
}

#[tauri::command]
async fn net_fetch(req: FetchReq) -> FetchRes {
    match do_fetch(req).await {
        Ok(r) => r,
        Err(e) => FetchRes { error: Some(e), ..Default::default() },
    }
}

/* ---------- Calendar feed: serves the plan as a subscribable .ics ---------- */

#[derive(Deserialize, Clone, PartialEq)]
struct FeedCfg {
    on: bool,
    lan: bool,
    port: u16,
    token: String,
}

#[derive(Serialize, Default, Clone)]
struct FeedStatus {
    running: bool,
    error: Option<String>,
    urls: Vec<String>,
}

#[derive(Default)]
struct FeedInner {
    cfg: Option<FeedCfg>,
    server: Option<Arc<tiny_http::Server>>,
    error: Option<String>,
}

struct FeedState {
    body: Arc<Mutex<String>>,
    inner: Mutex<FeedInner>,
}

fn feed_urls(cfg: &FeedCfg) -> Vec<String> {
    let path = format!("/plan-{}.ics", cfg.token);
    let mut urls = vec![format!("http://127.0.0.1:{}{}", cfg.port, path)];
    if cfg.lan {
        if let Ok(ifs) = if_addrs::get_if_addrs() {
            for i in ifs {
                if i.is_loopback() {
                    continue;
                }
                if let std::net::IpAddr::V4(ip) = i.ip() {
                    urls.push(format!("http://{}:{}{}", ip, cfg.port, path));
                }
            }
        }
    }
    urls
}

fn feed_status(inner: &FeedInner) -> FeedStatus {
    match (&inner.server, &inner.cfg, &inner.error) {
        (Some(_), Some(cfg), None) => FeedStatus { running: true, error: None, urls: feed_urls(cfg) },
        _ => FeedStatus { running: false, error: inner.error.clone(), urls: vec![] },
    }
}

#[tauri::command]
fn feed_configure(state: State<'_, FeedState>, cfg: FeedCfg) -> FeedStatus {
    let mut inner = match state.inner.lock() {
        Ok(g) => g,
        Err(_) => return FeedStatus { running: false, error: Some("Feed state is unavailable".into()), urls: vec![] },
    };
    let token: String = cfg.token.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let cfg = FeedCfg { token, port: cfg.port.max(1024), ..cfg };
    let same = cfg.on && inner.server.is_some() && inner.error.is_none() && inner.cfg.as_ref() == Some(&cfg);
    if same {
        return feed_status(&inner);
    }
    if let Some(srv) = inner.server.take() {
        srv.unblock();
    }
    inner.error = None;
    inner.cfg = Some(cfg.clone());
    if cfg.on && !cfg.token.is_empty() {
        let host = if cfg.lan { "0.0.0.0" } else { "127.0.0.1" };
        match tiny_http::Server::http((host, cfg.port)) {
            Ok(server) => {
                let server = Arc::new(server);
                let srv = server.clone();
                let body = state.body.clone();
                let path = format!("/plan-{}.ics", cfg.token);
                std::thread::spawn(move || {
                    for rq in srv.incoming_requests() {
                        let url = rq.url().split('?').next().unwrap_or("").to_string();
                        if rq.method() == &tiny_http::Method::Get && url == path {
                            let text = body.lock().map(|b| b.clone()).unwrap_or_default();
                            let resp = tiny_http::Response::from_string(text)
                                .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/calendar; charset=utf-8"[..]).unwrap())
                                .with_header(tiny_http::Header::from_bytes(&b"Cache-Control"[..], &b"no-cache"[..]).unwrap());
                            let _ = rq.respond(resp);
                        } else {
                            let _ = rq.respond(tiny_http::Response::from_string("Not found").with_status_code(404));
                        }
                    }
                });
                inner.server = Some(server);
            }
            Err(e) => {
                let msg = e.to_string();
                inner.error = Some(if msg.to_lowercase().contains("in use") {
                    format!("Port {} is already in use", cfg.port)
                } else {
                    msg
                });
            }
        }
    }
    feed_status(&inner)
}

#[tauri::command]
fn feed_update(state: State<'_, FeedState>, body: String) -> bool {
    match state.body.lock() {
        Ok(mut b) => {
            *b = body;
            true
        }
        Err(_) => false,
    }
}

/* ---------- Updates (installed app only) ---------- */

const UPD_KEY: &str = "__update_url";

#[derive(Serialize, Clone, Default)]
struct UpdState {
    state: String,
    version: Option<String>,
    msg: Option<String>,
    current: String,
    url: Option<String>,
}

struct UpdHolder {
    st: Mutex<UpdState>,
    pending: Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>,
}

fn upd_set(app: &AppHandle, hold: &UpdHolder, state: &str, version: Option<String>, msg: Option<String>) -> UpdState {
    let snap = {
        let mut st = hold.st.lock().unwrap();
        st.state = state.to_string();
        st.version = version;
        st.msg = msg;
        st.current = app.package_info().version.to_string();
        st.clone()
    };
    let _ = app.emit("update:status", snap.clone());
    snap
}

fn with_url(mut st: UpdState, store: &Store) -> UpdState {
    st.url = store.get(UPD_KEY).filter(|u| !u.is_empty());
    st
}

// The address is a folder that serves latest.json (or the full address of the json file).
fn endpoint_of(raw: &str) -> Option<tauri::Url> {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return None;
    }
    if !s.to_lowercase().ends_with(".json") {
        if !s.ends_with('/') {
            s.push('/');
        }
        s.push_str("latest.json");
    }
    s.parse::<tauri::Url>().ok()
}

async fn do_check(app: &AppHandle, store: &Store, hold: &UpdHolder) -> UpdState {
    if cfg!(debug_assertions) {
        return upd_set(app, hold, "dev", None, None);
    }
    let raw = store.get(UPD_KEY).or_else(|| std::env::var("UPDATE_URL").ok()).unwrap_or_default();
    let ep = match endpoint_of(&raw) {
        Some(e) => e,
        None => return upd_set(app, hold, "nourl", None, None),
    };
    upd_set(app, hold, "checking", None, None);
    let updater = match app.updater_builder().endpoints(vec![ep]).and_then(|b| b.build()) {
        Ok(u) => u,
        Err(e) => return upd_set(app, hold, "error", None, Some(e.to_string())),
    };
    match updater.check().await {
        Ok(Some(update)) => {
            let ver = update.version.clone();
            upd_set(app, hold, "downloading", Some(ver.clone()), None);
            match update.download(|_, _| {}, || {}).await {
                Ok(bytes) => {
                    if let Ok(mut p) = hold.pending.lock() {
                        *p = Some((update, bytes));
                    }
                    upd_set(app, hold, "ready", Some(ver), None)
                }
                Err(e) => upd_set(app, hold, "error", Some(ver), Some(e.to_string())),
            }
        }
        Ok(None) => upd_set(app, hold, "none", None, None),
        Err(e) => upd_set(app, hold, "error", None, Some(e.to_string())),
    }
}

#[tauri::command]
async fn update_check(app: AppHandle, store: State<'_, Store>, hold: State<'_, UpdHolder>) -> Result<UpdState, String> {
    let st = do_check(&app, &store, &hold).await;
    Ok(with_url(st, &store))
}

#[tauri::command]
fn update_status(app: AppHandle, store: State<'_, Store>, hold: State<'_, UpdHolder>) -> UpdState {
    let mut st = hold.st.lock().map(|s| s.clone()).unwrap_or_default();
    if st.state.is_empty() {
        st.state = "idle".into();
    }
    st.current = app.package_info().version.to_string();
    with_url(st, &store)
}

#[tauri::command]
async fn update_set_url(app: AppHandle, store: State<'_, Store>, hold: State<'_, UpdHolder>, url: String) -> Result<UpdState, String> {
    {
        let mut d = store.data.lock().map_err(|e| e.to_string())?;
        d.insert(UPD_KEY.to_string(), url.trim().to_string());
        store.flush(&d)?;
    }
    let st = do_check(&app, &store, &hold).await;
    Ok(with_url(st, &store))
}

#[tauri::command]
fn update_install(app: AppHandle, store: State<'_, Store>, hold: State<'_, UpdHolder>) -> Result<UpdState, String> {
    let pending = hold.pending.lock().map_err(|e| e.to_string())?.take();
    match pending {
        Some((update, bytes)) => {
            update.install(bytes).map_err(|e| e.to_string())?;
            app.restart()
        }
        None => Ok(with_url(upd_set(&app, &hold, "error", None, Some("No update is ready yet.".into())), &store)),
    }
}

struct TrayOk(AtomicBool);

/* ---------- Window, tray, hotkey ---------- */

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn open_console(app: &AppHandle) {
    show_main(app);
    let _ = app.emit("console:focus", ());
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let open_i = MenuItem::with_id(app, "open", "Open console (Ctrl+Shift+Space)", true, None::<&str>)?;
    let show_i = MenuItem::with_id(app, "show", "Show dashboard", true, None::<&str>)?;
    let auto_i = CheckMenuItem::with_id(app, "autostart", "Start with system", true, autostart_on, None::<&str>)?;
    let upd_i = MenuItem::with_id(app, "update", "Check for updates", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open_i, &show_i, &upd_i, &sep1, &auto_i, &sep2, &quit_i])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("Task Progress")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_console(app),
            "show" => show_main(app),
            "update" => {
                open_console(app);
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    let store = app2.state::<Store>();
                    let hold = app2.state::<UpdHolder>();
                    do_check(&app2, &store, &hold).await;
                });
            }
            "autostart" => {
                let al = app.autolaunch();
                let _ = if al.is_enabled().unwrap_or(false) { al.disable() } else { al.enable() };
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // Single-instance must be registered first: a second launch just opens the console.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| open_console(app)))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(FeedState {
            body: Arc::new(Mutex::new("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Task Progress//Planner//EN\r\nEND:VCALENDAR\r\n".to_string())),
            inner: Mutex::new(FeedInner::default()),
        })
        .manage(UpdHolder { st: Mutex::new(UpdState::default()), pending: Mutex::new(None) })
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        open_console(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            store_get,
            store_set,
            store_delete,
            store_list,
            net_fetch,
            feed_configure,
            feed_update,
            update_check,
            update_status,
            update_set_url,
            update_install
        ])
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let path = dir.join("store.json");
            daily_backup(&dir, &path);
            app.manage(Store::load(path));

            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            if let Err(e) = app.global_shortcut().register(shortcut) {
                eprintln!("Global shortcut unavailable (another app may own it): {e}");
            }

            let tray_ok = match build_tray(app.handle()) {
                Ok(()) => true,
                Err(e) => {
                    eprintln!("Tray icon unavailable, closing the window will quit the app: {e}");
                    false
                }
            };
            app.manage(TrayOk(AtomicBool::new(tray_ok)));

            // Look for updates shortly after start and then every 6 hours, if an address is set.
            let h = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(20));
                loop {
                    let store = h.state::<Store>();
                    let hold = h.state::<UpdHolder>();
                    if store.get(UPD_KEY).map(|u| !u.is_empty()).unwrap_or(false) {
                        tauri::async_runtime::block_on(do_check(&h, &store, &hold));
                    }
                    std::thread::sleep(Duration::from_secs(6 * 3600));
                }
            });
            Ok(())
        })
        // Closing the window hides it to the tray so the hotkey keeps working; quit from the tray menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let tray_ok = window
                    .app_handle()
                    .try_state::<TrayOk>()
                    .map(|t| t.0.load(Ordering::Relaxed))
                    .unwrap_or(false);
                if tray_ok {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Task Progress");
}
