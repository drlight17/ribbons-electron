use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::config;
use crate::dialogs;
use crate::logging::write_log;
use crate::state::AppState;

#[tauri::command]
pub fn renderer_message(
    app: AppHandle,
    window: WebviewWindow,
    event: String,
    payload: Option<Value>,
) -> Result<(), String> {
    match event.as_str() {
        "debug" => {
            let text = match payload {
                Some(Value::String(text)) => text,
                Some(value) => value.to_string(),
                None => String::new(),
            };
            write_log(&app, format!("[renderer] {text}"));
        }
        "renderer-ready" => {
            crate::windows::mark_renderer_ready(&app, window.label());
        }
        "close-button-clicked" => {
            write_log(
                &app,
                "Close button is clicked. Stopping screensaver at all displays.",
            );
            crate::windows::stop_all(&app);
        }
        "ribbons-settings-ready" => {
            let snapshot = crate::windows::settings_snapshot(&app);
            let _ = window.emit("ribbons-settings-load", snapshot);
        }
        "ribbons-settings-save" => {
            save_settings(&app, payload)?;
        }
        "ribbons-settings-open-log" => {
            let state = app.state::<AppState>();
            write_log(
                &app,
                format!("Opening app.log file in {}", state.config_dir.display()),
            );
            dialogs::open_file(&app, state.log_path.clone());
        }
        "ribbons-settings-glass" => {
            crate::windows::apply_settings_chrome(&app, true);
        }
        "ribbons-settings-transparent" => {
            crate::windows::apply_settings_chrome(&app, false);
        }
        "update-decision" => {
            if let Some(payload) = payload {
                crate::updates::handle_update_decision(&app, &payload);
            }
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub fn get_update_info(app: AppHandle) -> Value {
    crate::updates::update_info(&app)
}

#[tauri::command]
pub fn get_about_info(app: AppHandle) -> Value {
    let locale = app.state::<AppState>().i18n.lock().unwrap().tag.clone();
    serde_json::json!({
        "name": config::APP_NAME,
        "version": app.package_info().version.to_string(),
        "author": "Yuri Samoilov (drlight17)",
        "website": "https://ribbons.drlight.fun/",
        "source": "https://github.com/drlight17/ribbons-tauri",
        "license": "AGPLv3 ©2026",
        "locale": locale
    })
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http(s) URLs are allowed".to_string());
    }
    dialogs::open_url(&app, &url);
    Ok(())
}

fn save_settings(app: &AppHandle, payload: Option<Value>) -> Result<(), String> {
    let Some(Value::Object(mut data)) = payload else {
        return Ok(());
    };

    if data
        .get("stretched_mode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        data.insert(
            "selected_displays".to_string(),
            Value::String("all".to_string()),
        );
    }
    data.remove("_meta");
    if let Some(single_color) = data.remove("single_color") {
        data.entry("singleColor".to_string())
            .or_insert(single_color);
    }

    let run_at_startup = data.get("run_at_startup").and_then(|v| v.as_bool());

    let (previous_background_mode, previous_restart_settings) = {
        let state = app.state::<AppState>();
        let store = state.store.lock().unwrap();
        (
            store.get_str("backgroundMode").unwrap_or_default(),
            restart_settings_snapshot(&store),
        )
    };

    {
        let state = app.state::<AppState>();
        let mut store = state.store.lock().unwrap();
        store.set_map(&data);
        if store.has("single_color") {
            store.delete("single_color");
        }
        if let Err(err) = store.save() {
            write_log(app, format!("Failed to save settings: {err}"));
        }
    }

    let (background_mode, current_restart_settings) = {
        let state = app.state::<AppState>();
        let store = state.store.lock().unwrap();
        (
            store.get_str("backgroundMode").unwrap_or_default(),
            restart_settings_snapshot(&store),
        )
    };
    let restart_for_appearance =
        needs_appearance_restart(&previous_background_mode, &background_mode);
    let restart_for_system = previous_restart_settings != current_restart_settings;

    if let Some(enabled) = run_at_startup {
        if config::is_packaged() {
            crate::autostart::set_run_at_startup(app, enabled);
        }
    }

    write_log(app, "Settings are saved");

    if restart_for_appearance || restart_for_system {
        write_log(
            app,
            "Settings require a restart. Restarting app to apply them.",
        );
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(400)).await;
            if let Some(window) = app2.get_webview_window("settings") {
                let _ = window.close();
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
            crate::autostart::restart_app(&app2);
        });
    } else {
        crate::windows::apply_settings(app);
        crate::media::apply(app);

        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(700)).await;
            if let Some(window) = app2.get_webview_window("settings") {
                let _ = window.close();
            }
        });
    }

    Ok(())
}

fn restart_settings_snapshot(store: &config::Store) -> [Option<Value>; 4] {
    [
        store.get("hw_acc").cloned(),
        store.get("run_at_startup").cloned(),
        store.get("logging").cloned(),
        store.get("randomize_datetime_pos").cloned(),
    ]
}

fn is_transparent_window_mode(mode: &str) -> bool {
    matches!(mode, "glass" | "transparent")
}

fn needs_appearance_restart(previous: &str, current: &str) -> bool {
    previous != current
        && (is_transparent_window_mode(previous) || is_transparent_window_mode(current))
}
