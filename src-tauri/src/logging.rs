use chrono::Local;
use std::fs::OpenOptions;
use std::io::Write;
use tauri::{AppHandle, Manager};

use crate::state::AppState;

pub fn write_log(app: &AppHandle, message: impl AsRef<str>) {
    let message = message.as_ref();
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    println!("[{timestamp}] {message}");

    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let logging = state
        .store
        .lock()
        .map(|store| store.get_bool_or("logging", false))
        .unwrap_or(false);

    if !logging {
        return;
    }

    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&state.log_path)
    {
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}
