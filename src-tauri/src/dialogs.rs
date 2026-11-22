use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

use crate::logging::write_log;
use crate::state::AppState;

pub fn dialog_opened(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let (paused, running) = {
        let mut runtime = state.runtime.lock().unwrap();
        if runtime.quitting {
            return;
        }
        runtime.dialog_count = runtime.dialog_count.saturating_add(1);
        let paused = runtime.modal_open();
        let running = runtime.windows.values().any(|window| window.running);
        runtime.blocked_icon = paused;
        for window in runtime.windows.values_mut() {
            window.paused = paused;
        }
        (paused, running)
    };

    crate::tray::rebuild_menu(app);
    crate::tray::set_tray_icon(app, paused);

    if running {
        crate::windows::stop_all(app);
    }
}

pub fn dialog_closed(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let paused = {
        let mut runtime = state.runtime.lock().unwrap();
        runtime.dialog_count = runtime.dialog_count.saturating_sub(1);
        if runtime.quitting {
            return;
        }
        let paused = runtime.modal_open();
        runtime.blocked_icon = paused;
        for window in runtime.windows.values_mut() {
            window.paused = paused;
        }
        paused
    };

    crate::tray::rebuild_menu(app);
    crate::tray::set_tray_icon(app, paused);
}

pub fn show_error(app: &AppHandle, title: &str, message: &str) {
    dialog_opened(app);
    let app2 = app.clone();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::Ok)
        .show(move |_| dialog_closed(&app2));
}

pub fn show_info(app: &AppHandle, title: &str, message: &str) {
    dialog_opened(app);
    let app2 = app.clone();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::Ok)
        .show(move |_| dialog_closed(&app2));
}

pub fn open_file(app: &AppHandle, path: impl AsRef<Path>) {
    let path = path.as_ref();
    if !path.exists() {
        show_error(
            app,
            "File not found",
            &format!("The file {} does not exist.", path.display()),
        );
        return;
    }
    if let Err(err) = app
        .opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
    {
        write_log(app, format!("Failed to open {}: {err}", path.display()));
        show_error(
            app,
            "Failed to open file",
            &format!("No application is associated with this file type. Error: {err}"),
        );
    }
}

pub fn open_url(app: &AppHandle, url: &str) {
    if let Err(err) = app.opener().open_url(url, None::<&str>) {
        write_log(app, format!("Failed to open URL {url}: {err}"));
        show_error(app, "Failed to open URL", &err.to_string());
    }
}
