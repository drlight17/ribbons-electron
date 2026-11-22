use serde_json::{json, Map, Value};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::config;
use crate::dialogs;
use crate::i18n::resource_file;
use crate::logging::write_log;
use crate::state::AppState;

const API_URL: &str = "https://api.github.com/repos/drlight17/ribbons-tauri/releases/latest";

pub fn update_blocked(app: &AppHandle) -> bool {
    if option_env!("RIBBONS_UPDATE_BLOCK") == Some("1") {
        return true;
    }
    resource_file(app, "UPDATE_BLOCK").exists()
}

pub fn spawn_check(app: &AppHandle, call_dialog: bool) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        check_new_version(&app, call_dialog).await;
    });
}

pub async fn check_new_version(app: &AppHandle, call_dialog: bool) {
    let current = app.package_info().version.to_string();
    let (cached_version, cached_url) = {
        let state = app.state::<AppState>();
        let store = state.store.lock().unwrap();
        (store.get_str("latestVersion"), store.get_str("releaseUrl"))
    };

    let (latest, url) = if cached_version.is_none() || cached_url.is_none() {
        write_log(app, "Fetch new version info from GitHub.");
        match fetch_latest().await {
            Ok((latest, url)) => {
                let state = app.state::<AppState>();
                {
                    let mut store = state.store.lock().unwrap();
                    store.set_str("latestVersion", &latest);
                    store.set_str("releaseUrl", &url);
                    let _ = store.save();
                }
                (latest, url)
            }
            Err(err) => {
                write_log(app, format!("Error fetching the latest release: {err}"));
                return;
            }
        }
    } else {
        (cached_version.unwrap(), cached_url.unwrap())
    };

    let latest_clean = normalize_version(&latest);
    let current_clean = normalize_version(&current);
    let comparison = match (
        semver::Version::parse(&current_clean),
        semver::Version::parse(&latest_clean),
    ) {
        (Ok(current), Ok(latest)) => current.cmp(&latest),
        _ => {
            write_log(
                app,
                format!("Cannot compare versions: current={current}, latest={latest}"),
            );
            return;
        }
    };

    use std::cmp::Ordering;
    match comparison {
        Ordering::Equal => {
            write_log(app, "You are using the latest version.");
            if call_dialog {
                let t = app
                    .state::<AppState>()
                    .i18n
                    .lock()
                    .unwrap()
                    .t("new_version_no");
                dialogs::show_info(app, &app.package_info().name, &t);
            }
        }
        Ordering::Less => {
            write_log(app, format!("A new version is available: {latest}"));
            {
                let state = app.state::<AppState>();
                let mut runtime = state.runtime.lock().unwrap();
                runtime.update_available = true;
                runtime.latest_version = Some(latest.clone());
                runtime.release_url = Some(url.clone());
            }
            crate::tray::rebuild_menu(app);
            open_new_version_dialog(app, &latest, &url);
        }
        Ordering::Greater => {
            write_log(app, "You are using a newer version.");
            if call_dialog {
                let t = app
                    .state::<AppState>()
                    .i18n
                    .lock()
                    .unwrap()
                    .t("newer_version");
                dialogs::show_info(app, &app.package_info().name, &t);
            }
        }
    }
}

async fn fetch_latest() -> Result<(String, String), String> {
    let client = reqwest::Client::builder()
        .user_agent("ribbons-screensaver")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(API_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let data: Value = response.json().await.map_err(|e| e.to_string())?;
    let latest = data
        .get("tag_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "tag_name is missing".to_string())?
        .to_string();
    let url = data
        .get("html_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "html_url is missing".to_string())?
        .to_string();
    Ok((latest, url))
}

fn normalize_version(version: &str) -> String {
    version.trim().trim_start_matches(['v', 'V']).to_string()
}

fn is_remembered(app: &AppHandle, latest: &str) -> bool {
    let state = app.state::<AppState>();
    let store = state.store.lock().unwrap();
    let Some(raw) = store.get_str("new_version_remember") else {
        return false;
    };
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&raw) else {
        return false;
    };
    map.get(latest).and_then(|v| v.as_bool()).unwrap_or(false)
}

pub fn update_info(app: &AppHandle) -> Value {
    let state = app.state::<AppState>();
    let (latest, url) = {
        let runtime = state.runtime.lock().unwrap();
        (runtime.latest_version.clone(), runtime.release_url.clone())
    };
    let i18n = state.i18n.lock().unwrap();
    json!({
        "latestVersion": latest.unwrap_or_default(),
        "releaseUrl": url.unwrap_or_default(),
        "installEnabled": !update_blocked(app),
        "labels": {
            "title": i18n.t("new_version"),
            "ask": i18n.t("new_version_ask"),
            "yes": i18n.t("yes"),
            "no": i18n.t("no"),
            "install": i18n.t("new_version_install"),
            "remember": i18n.t("new_version_remember")
        }
    })
}

fn set_update_modal(app: &AppHandle, open: bool) {
    let state = app.state::<AppState>();
    let (paused, running, quitting) = {
        let mut runtime = state.runtime.lock().unwrap();
        if runtime.quitting {
            (false, false, true)
        } else {
            runtime.update_open = open;
            let paused = runtime.modal_open();
            let running = runtime.windows.values().any(|window| window.running);
            runtime.blocked_icon = paused;
            for window in runtime.windows.values_mut() {
                window.paused = paused;
            }
            (paused, running, false)
        }
    };
    if quitting {
        return;
    }

    crate::tray::rebuild_menu(app);
    crate::tray::set_tray_icon(app, paused);

    if open && running {
        crate::windows::stop_all(app);
    }
}

fn open_new_version_dialog(app: &AppHandle, latest: &str, url: &str) {
    if app.get_webview_window("update").is_some() {
        return;
    }
    if is_remembered(app, latest) {
        return;
    }

    set_update_modal(app, true);

    let builder = WebviewWindowBuilder::new(app, "update", WebviewUrl::App("update.html".into()))
        .title(
            app.state::<AppState>()
                .i18n
                .lock()
                .unwrap()
                .t("new_version"),
        )
        .inner_size(520.0, 320.0)
        .center()
        .resizable(false)
        .always_on_top(true)
        .visible(false);

    match builder.build() {
        Ok(window) => {
            if let Some(icon) = crate::tray::load_window_icon(app) {
                let _ = window.set_icon(icon);
            }

            let app2 = app.clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    set_update_modal(&app2, false);
                }
            });

            let _ = window.show();
            let _ = window.set_focus();
        }
        Err(err) => {
            write_log(app, format!("Failed to open update dialog: {err}"));
            set_update_modal(app, false);
            let state = app.state::<AppState>();
            let i18n = state.i18n.lock().unwrap();
            let buttons = if update_blocked(app) {
                MessageDialogButtons::YesNo
            } else {
                MessageDialogButtons::YesNoCancel
            };
            let app2 = app.clone();
            let url2 = url.to_string();
            crate::dialogs::dialog_opened(app);
            app.dialog()
                .message(i18n.t("new_version_ask"))
                .title(format!("{}: {latest}", i18n.t("new_version")))
                .kind(MessageDialogKind::Info)
                .buttons(buttons)
                .show(move |ok| {
                    crate::dialogs::dialog_closed(&app2);
                    if ok {
                        dialogs::open_url(&app2, &url2);
                    }
                });
        }
    }
}

pub fn handle_update_decision(app: &AppHandle, payload: &Value) {
    let decision = payload
        .get("decision")
        .and_then(|v| v.as_str())
        .unwrap_or("no");
    let remember = payload
        .get("remember")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let (latest, url) = {
        let state = app.state::<AppState>();
        let runtime = state.runtime.lock().unwrap();
        (runtime.latest_version.clone(), runtime.release_url.clone())
    };

    if remember {
        if let Some(latest) = &latest {
            let state = app.state::<AppState>();
            let mut store = state.store.lock().unwrap();
            let mut map = Map::new();
            map.insert(latest.clone(), Value::Bool(true));
            store.set_str(
                "new_version_remember",
                &serde_json::to_string(&Value::Object(map)).unwrap_or_default(),
            );
            let _ = store.save();
        }
    }

    if let Some(window) = app.get_webview_window("update") {
        let _ = window.close();
    }

    match decision {
        "yes" => {
            if let Some(url) = url {
                dialogs::open_url(app, &url);
            }
        }
        "install" => {
            if update_blocked(app) {
                write_log(app, "Self-update is blocked by UPDATE_BLOCK");
                return;
            }
            if !config::is_packaged() && std::env::var("APPIMAGE").is_err() {
                let message = app
                    .state::<AppState>()
                    .i18n
                    .lock()
                    .unwrap()
                    .t("update_unsupported");
                dialogs::show_info(app, &app.package_info().name, &message);
                if let Some(url) = url {
                    dialogs::open_url(app, &url);
                }
                return;
            }

            let message = app
                .state::<AppState>()
                .i18n
                .lock()
                .unwrap()
                .t("update_wait");
            dialogs::show_info(app, &app.package_info().name, &message);
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                self_update(app2).await;
            });
        }
        _ => {}
    }
}

async fn self_update(app: AppHandle) {
    use tauri_plugin_updater::UpdaterExt;

    write_log(&app, "[UPDATER] Checking for update");
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            write_log(&app, format!("[UPDATER] Unavailable: {err}"));
            return;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            write_log(&app, format!("[UPDATER] Downloading {}", update.version));
            match update
                .download_and_install(|_chunk, _total| {}, || {})
                .await
            {
                Ok(()) => {
                    write_log(&app, "[UPDATER] Installed, restarting");
                    crate::autostart::restart_app(&app);
                }
                Err(err) => {
                    write_log(&app, format!("[UPDATER] Install failed: {err}"));
                    fallback_update_page(&app);
                }
            }
        }
        Ok(None) => {
            write_log(&app, "[UPDATER] No update");
            fallback_update_page(&app);
        }
        Err(err) => {
            write_log(&app, format!("[UPDATER] Failed: {err}"));
            fallback_update_page(&app);
        }
    }
}

fn fallback_update_page(app: &AppHandle) {
    let url = {
        let state = app.state::<AppState>();
        let runtime = state.runtime.lock().unwrap();
        runtime.release_url.clone()
    };
    if let Some(url) = url {
        let message = {
            let state = app.state::<AppState>();
            let i18n = state.i18n.lock().unwrap();
            i18n.t("new_version_ask")
        };
        dialogs::show_info(app, &app.package_info().name, &message);
        dialogs::open_url(app, &url);
    }
}
