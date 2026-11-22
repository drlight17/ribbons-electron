use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::active_window::{self, ActiveWindowInfo};
use crate::logging::write_log;
use crate::state::{now_ms, AppState};
use crate::windows;

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_idle_check = Instant::now();
        let mut idle_secs: Option<u64> = None;
        let mut was_locked = false;

        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let state = app.state::<AppState>();

            if state.is_locked() {
                if !was_locked {
                    was_locked = true;
                    write_log(&app, "Running screensaver detected. Stopping it.");
                    windows::stop_all(&app);
                }
                continue;
            }
            was_locked = false;

            if last_idle_check.elapsed() >= Duration::from_millis(500) {
                idle_secs = tokio::task::spawn_blocking(crate::idle::get_idle_seconds)
                    .await
                    .ok()
                    .flatten();
                state.runtime.lock().unwrap().idle_secs = idle_secs.unwrap_or(0);
                last_idle_check = Instant::now();
            }

            let user_activity = state
                .store
                .lock()
                .map(|s| s.get_bool_or("user_activity", true))
                .unwrap_or(true);

            let (displays, running) = {
                let runtime = state.runtime.lock().unwrap();
                let running: Vec<(String, bool, bool, u64, u64)> = runtime
                    .windows
                    .iter()
                    .map(|(id, w)| {
                        (
                            id.clone(),
                            w.running,
                            w.paused,
                            w.close_allowed_at,
                            w.last_close_sent,
                        )
                    })
                    .collect();
                (runtime.displays.clone(), running)
            };

            let now = now_ms();
            for (id, is_running, _paused, close_allowed_at, last_close_sent) in &running {
                if !*is_running {
                    continue;
                }

                let user_is_active = idle_secs.map(|secs| secs < 1).unwrap_or(false);
                if user_activity && user_is_active && now > close_allowed_at + 1500 {
                    write_log(
                        &app,
                        format!("User activity, stop screensaver at display {id}"),
                    );
                    windows::stop_screensaver(&app, id);
                    continue;
                }

                // If idle time is unavailable, still expose the close button after
                // the grace period so the user is never trapped in the screensaver.
                let close_button_due = idle_secs.map(|secs| secs < 1).unwrap_or(true);
                if close_button_due && now >= *close_allowed_at && now - last_close_sent >= 200 {
                    if let Some(window) = app.get_webview_window(&windows::window_label(id)) {
                        let _ = window.emit("show-close-btn", ());
                    }
                    if let Some(entry) = state.runtime.lock().unwrap().windows.get_mut(id) {
                        entry.last_close_sent = now;
                    }
                }
            }

            let modal_open = state.runtime.lock().unwrap().modal_open();
            if modal_open {
                continue;
            }

            let (idle_time, fullscreen_detect) = {
                let store = state.store.lock().unwrap();
                (
                    store.get_u64_or("idle_time", 60),
                    store.get_bool_or("fullscreen_detect", true),
                )
            };
            let Some(idle_secs_known) = idle_secs else {
                continue;
            };
            if idle_secs_known <= idle_time || state.sound_within(idle_time) {
                continue;
            }

            let any_eligible = {
                let runtime = state.runtime.lock().unwrap();
                displays.iter().any(|display| {
                    runtime
                        .windows
                        .get(&display.id)
                        .map(|entry| !entry.running && !entry.paused)
                        .unwrap_or(true)
                })
            };
            if !any_eligible {
                continue;
            }

            #[cfg(target_os = "macos")]
            write_log(
                &app,
                "macOS: checking active window before screensaver start",
            );

            let active = if fullscreen_detect {
                #[cfg(target_os = "macos")]
                {
                    let (tx, rx) = std::sync::mpsc::channel();
                    let active_app = app.clone();
                    let queued = app.run_on_main_thread(move || {
                        let _ = tx.send(active_window::get_active_window(&active_app));
                    });
                    if queued.is_ok() {
                        rx.recv_timeout(Duration::from_millis(800)).ok().flatten()
                    } else {
                        None
                    }
                }
                #[cfg(not(target_os = "macos"))]
                {
                    let active_app = app.clone();
                    tokio::task::spawn_blocking(move || {
                        active_window::get_active_window(&active_app)
                    })
                    .await
                    .ok()
                    .flatten()
                }
            } else {
                None
            };

            for display in &displays {
                {
                    let runtime = state.runtime.lock().unwrap();
                    if let Some(entry) = runtime.windows.get(&display.id) {
                        if entry.running || entry.paused {
                            continue;
                        }
                    }
                }
                let should_start = match &active {
                    None => no_active_window_should_start(&app, fullscreen_detect),
                    Some(info) => {
                        let fullscreen = fullscreen_detect
                            && active_window::fullscreen_for_display(info, display);
                        !fullscreen || active_window::is_desktop_window(info)
                    }
                };
                if should_start {
                    windows::start_screensaver(&app, &display.id, false);
                }
            }
        }
    });
}

fn no_active_window_should_start(app: &AppHandle, fullscreen_detect: bool) -> bool {
    if cfg!(target_os = "macos") {
        return fullscreen_detect;
    }
    if cfg!(target_os = "linux") {
        write_log(
            app,
            "Cannot get active window info on Linux. Assuming not fullscreen.",
        );
        return true;
    }
    false
}

#[allow(dead_code)]
fn log_active(app: &AppHandle, active: &Option<ActiveWindowInfo>) {
    if let Some(info) = active {
        write_log(
            app,
            format!(
                "Active window: {} / {} (fullscreen: {})",
                info.owner, info.title, info.fullscreen
            ),
        );
    }
}
