#[cfg(target_os = "windows")]
mod windows {
    use std::fs::{File, OpenOptions};
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::Path;
    use std::sync::Mutex;

    use tauri::{AppHandle, Manager};
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    use crate::logging::write_log;
    use crate::state::AppState;

    const ERROR_SHARING_VIOLATION: i32 = 32;

    static INSTANCE_FILE: Mutex<Option<File>> = Mutex::new(None);

    pub fn init(app: &AppHandle, path: &Path) -> bool {
        let result = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .share_mode(0)
            .open(path);

        match result {
            Ok(file) => {
                *INSTANCE_FILE.lock().unwrap() = Some(file);
                true
            }
            Err(err) if err.raw_os_error() == Some(ERROR_SHARING_VIOLATION) => {
                let (title, message) = if let Some(state) = app.try_state::<AppState>() {
                    let i18n = state.i18n.lock().unwrap();
                    (i18n.t("error"), i18n.t("error1"))
                } else {
                    (
                        "Error".to_string(),
                        "Screensaver is already running! Check the tray icon!".to_string(),
                    )
                };
                let app2 = app.clone();
                app.dialog()
                    .message(message)
                    .title(title)
                    .kind(MessageDialogKind::Error)
                    .buttons(MessageDialogButtons::Ok)
                    .show(move |_| {
                        app2.exit(0);
                    });
                false
            }
            Err(err) => {
                write_log(app, format!("Failed to acquire instance lock: {err}"));
                true
            }
        }
    }

    pub fn release() {
        *INSTANCE_FILE.lock().unwrap() = None;
    }
}

#[cfg(target_os = "windows")]
pub use windows::{init, release};

#[cfg(not(target_os = "windows"))]
pub fn init(_app: &tauri::AppHandle, _path: &std::path::Path) -> bool {
    true
}

#[cfg(not(target_os = "windows"))]
pub fn release() {}
