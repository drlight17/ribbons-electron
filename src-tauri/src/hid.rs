use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::logging::write_log;
use crate::state::AppState;

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut api = match hidapi::HidApi::new() {
            Ok(api) => api,
            Err(err) => {
                write_log(&app, format!("HID monitor unavailable: {err}"));
                return;
            }
        };

        let mut count = api.device_list().count();
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            {
                let state = app.state::<AppState>();
                if state.runtime.lock().unwrap().quitting {
                    return;
                }
            }
            match api.refresh_devices() {
                Ok(()) => {
                    let next = api.device_list().count();
                    if next != count {
                        count = next;
                        let delay = 2000 + crate::state::now_ms() % 5000;
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                        write_log(&app, "Some HID devices changed. Restarting app.");
                        crate::autostart::restart_app(&app);
                    }
                }
                Err(err) => write_log(&app, format!("HID monitor error: {err}")),
            }
        }
    });
}
