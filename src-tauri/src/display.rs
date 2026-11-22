use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::state::{AppState, Bounds, DisplayInfo};

fn monitor_to_display(index: usize, monitor: &tauri::Monitor) -> DisplayInfo {
    let scale = if monitor.scale_factor() > 0.0 {
        monitor.scale_factor()
    } else {
        1.0
    };
    let pos = monitor.position();
    let size = monitor.size();

    let physical = Bounds {
        x: pos.x as f64,
        y: pos.y as f64,
        width: size.width as f64,
        height: size.height as f64,
    };
    let bounds = Bounds {
        x: physical.x / scale,
        y: physical.y / scale,
        width: physical.width / scale,
        height: physical.height / scale,
    };

    let id = monitor
        .name()
        .cloned()
        .unwrap_or_else(|| format!("display-{index}"));
    let label = monitor
        .name()
        .cloned()
        .unwrap_or_else(|| format!("Display {index}"));

    DisplayInfo {
        id,
        label,
        index,
        bounds,
        physical,
        src_bounds: None,
    }
}

pub fn all_monitors(app: &AppHandle) -> Vec<DisplayInfo> {
    let monitors = app.available_monitors().unwrap_or_default();
    monitors
        .iter()
        .enumerate()
        .map(|(i, monitor)| monitor_to_display(i, monitor))
        .collect()
}

pub fn collect_displays(app: &AppHandle) -> Vec<DisplayInfo> {
    let all = all_monitors(app);
    let state = app.state::<AppState>();
    let mut store = state.store.lock().unwrap();

    if all.len() <= 1 {
        store.delete("selected_displays");
        store.set_bool("stretched_mode", false);
        let _ = store.save();
        return all;
    }

    let stretched = store.get_bool_or("stretched_mode", false);
    if stretched {
        store.set_str("selected_displays", "all");
        store.set_bool("randomize_datetime_pos", true);
        let _ = store.save();

        let (min_x, min_y, max_x, max_y) = all.iter().fold(
            (
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ),
            |(min_x, min_y, max_x, max_y), display| {
                (
                    min_x.min(display.bounds.x),
                    min_y.min(display.bounds.y),
                    max_x.max(display.bounds.x + display.bounds.width),
                    max_y.max(display.bounds.y + display.bounds.height),
                )
            },
        );
        let (pmin_x, pmin_y, pmax_x, pmax_y) = all.iter().fold(
            (
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ),
            |(min_x, min_y, max_x, max_y), display| {
                (
                    min_x.min(display.physical.x),
                    min_y.min(display.physical.y),
                    max_x.max(display.physical.x + display.physical.width),
                    max_y.max(display.physical.y + display.physical.height),
                )
            },
        );

        return vec![DisplayInfo {
            id: "stretched".to_string(),
            label: "Stretched".to_string(),
            index: 0,
            bounds: Bounds {
                x: min_x,
                y: min_y,
                width: max_x - min_x,
                height: max_y - min_y,
            },
            physical: Bounds {
                x: pmin_x,
                y: pmin_y,
                width: pmax_x - pmin_x,
                height: pmax_y - pmin_y,
            },
            src_bounds: Some(all.iter().map(|d| d.bounds).collect()),
        }];
    }

    let existing_ids: Vec<String> = all.iter().map(|d| d.id.clone()).collect();
    let mut selection = store.get("selected_displays").cloned();

    if let Some(Value::Object(obj)) = &selection {
        if let Some(Value::Array(ids)) = obj.get("displays") {
            let selected_ids: Vec<String> = ids
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .filter(|id| existing_ids.contains(id))
                .collect();

            if selected_ids.len() != ids.len() {
                if selected_ids.is_empty() {
                    store.delete("selected_displays");
                    selection = None;
                } else {
                    store.set(
                        "selected_displays",
                        serde_json::json!({ "displays": selected_ids }),
                    );
                    selection = store.get("selected_displays").cloned();
                }
                let _ = store.save();
            }
        }
    }

    let Some(Value::Object(obj)) = selection else {
        return all;
    };
    let Some(Value::Array(ids)) = obj.get("displays") else {
        return all;
    };

    let selected_ids: Vec<String> = ids
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();
    let filtered: Vec<DisplayInfo> = all
        .iter()
        .filter(|d| selected_ids.contains(&d.id))
        .cloned()
        .collect();

    if filtered.is_empty() {
        all
    } else {
        filtered
    }
}

pub fn signature(displays: &[DisplayInfo]) -> String {
    displays
        .iter()
        .map(|d| {
            format!(
                "{}:{:.1}:{:.1}:{:.1}:{:.1}",
                d.id, d.bounds.x, d.bounds.y, d.bounds.width, d.bounds.height
            )
        })
        .collect::<Vec<_>>()
        .join("|")
}

pub fn start_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let displays = all_monitors(&app);
            let signature = signature(&displays);
            let changed = {
                let state = app.state::<AppState>();
                let runtime = state.runtime.lock().unwrap();
                !signature.is_empty() && runtime.display_signature != signature
            };
            if changed {
                let delay = 2000 + crate::state::now_ms() % 5000;
                tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                crate::logging::write_log(&app, "Display configuration changed. Restarting app.");
                crate::autostart::restart_app(&app);
            }
        }
    });
}
