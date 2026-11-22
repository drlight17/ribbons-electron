use serde_json::Value;
use std::process::Command;
use tauri::AppHandle;

#[cfg(any(target_os = "linux", target_os = "macos"))]
use crate::logging::write_log;
use crate::state::{Bounds, DisplayInfo};

#[derive(Debug, Clone)]
pub struct ActiveWindowInfo {
    pub owner: String,
    pub title: String,
    pub fullscreen: bool,
    #[allow(dead_code)]
    pub bounds: Option<Bounds>,
}

const DESKTOP_PROCESSES: &[&str] = &[
    "explorer.exe",
    "finder",
    "gnome-shell",
    "plasmashell",
    "marco",
    "mate",
    "muffin",
    "cinnamon",
    "xfwm4",
    "openbox",
    "i3",
    "desktop",
];

pub fn get_active_window(app: &AppHandle) -> Option<ActiveWindowInfo> {
    #[cfg(target_os = "linux")]
    {
        if let Some(info) = linux_active_window(app) {
            return Some(info);
        }
    }

    #[cfg(target_os = "macos")]
    {
        if !core_graphics::access::ScreenCaptureAccess::default().preflight() {
            write_log(
                app,
                "Screen recording permission is not granted; skipping active window detection",
            );
            return None;
        }
    }

    #[cfg(not(target_os = "linux"))]
    let _ = app;

    active_win_pos_rs::get_active_window()
        .ok()
        .map(|window| ActiveWindowInfo {
            owner: window.app_name,
            title: window.title,
            fullscreen: false,
            bounds: Some(Bounds {
                x: window.position.x,
                y: window.position.y,
                width: window.position.width,
                height: window.position.height,
            }),
        })
}

pub fn is_desktop_window(info: &ActiveWindowInfo) -> bool {
    let owner = info.owner.to_lowercase();
    let known = DESKTOP_PROCESSES
        .iter()
        .any(|process| owner.contains(process));
    if cfg!(target_os = "macos") {
        known
    } else {
        known || info.title.trim().is_empty()
    }
}

pub fn fullscreen_for_display(info: &ActiveWindowInfo, display: &DisplayInfo) -> bool {
    #[cfg(target_os = "linux")]
    {
        let _ = display;
        return info.fullscreen;
    }

    #[cfg(target_os = "windows")]
    {
        let Some(bounds) = info.bounds else {
            return false;
        };
        let target = display.physical;
        return approx_eq(bounds.x, target.x)
            && approx_eq(bounds.y, target.y)
            && approx_eq(bounds.width, target.width)
            && approx_eq(bounds.height, target.height);
    }

    #[cfg(target_os = "macos")]
    {
        let Some(bounds) = info.bounds else {
            return false;
        };
        let target = display.bounds;
        return approx_eq(bounds.x, target.x)
            && approx_eq(bounds.y, target.y)
            && approx_eq(bounds.width, target.width);
    }

    #[allow(unreachable_code)]
    false
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn approx_eq(a: f64, b: f64) -> bool {
    (a - b).abs() <= 2.0
}

#[cfg(target_os = "linux")]
fn linux_active_window(app: &AppHandle) -> Option<ActiveWindowInfo> {
    if let Some(info) = get_via_wctx(app) {
        return Some(info);
    }

    if !is_wayland_session() {
        if let Some(info) = get_via_xprop() {
            return Some(info);
        }
    } else if let Some(info) = get_via_xprop() {
        return Some(info);
    }

    let desktop = desktop_env();
    if std::env::var("HYPRLAND_INSTANCE_SIGNATURE").is_ok() || desktop.contains("hyprland") {
        if let Some(info) = get_via_hyprctl() {
            return Some(info);
        }
    }
    if std::env::var("SWAYSOCK").is_ok() || desktop.contains("sway") {
        if let Some(info) = get_via_sway() {
            return Some(info);
        }
    }
    if desktop.contains("gnome") || desktop.contains("ubuntu") {
        if let Some(info) = get_via_gnome() {
            return Some(info);
        }
    }
    get_via_wlrctl()
}

#[cfg(target_os = "linux")]
fn is_wayland_session() -> bool {
    std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var("WAYLAND_DISPLAY").is_ok()
}

#[cfg(target_os = "linux")]
fn desktop_env() -> String {
    std::env::var("XDG_CURRENT_DESKTOP")
        .or_else(|_| std::env::var("DESKTOP_SESSION"))
        .unwrap_or_default()
        .to_lowercase()
}

#[cfg(target_os = "linux")]
fn run(command: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(command).args(args).output().ok()?;
    if !output.status.success() && output.stdout.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(target_os = "linux")]
fn get_via_wctx(app: &AppHandle) -> Option<ActiveWindowInfo> {
    let output = match Command::new("wctx").args(["active", "-f", "json"]).output() {
        Ok(output) => output,
        Err(err) => {
            if err.kind() != std::io::ErrorKind::NotFound || is_wayland_session() {
                write_log(app, format!("wctx is not available: {err}"));
            }
            return None;
        }
    };

    let raw = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() || raw.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        write_log(
            app,
            format!(
                "wctx returned no response (status: {}, stderr: {})",
                output.status,
                stderr.trim()
            ),
        );
        return None;
    }

    let (Some(start), Some(end)) = (raw.find('{'), raw.rfind('}')) else {
        write_log(
            app,
            format!("wctx returned an invalid response: {}", raw.trim()),
        );
        return None;
    };
    if end <= start {
        write_log(
            app,
            format!("wctx returned an invalid response: {}", raw.trim()),
        );
        return None;
    }

    let data: Value = match serde_json::from_str(&raw[start..=end]) {
        Ok(data) => data,
        Err(err) => {
            write_log(app, format!("wctx response could not be parsed: {err}"));
            return None;
        }
    };

    let state = data
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_uppercase();
    Some(ActiveWindowInfo {
        owner: data
            .get("class")
            .or_else(|| data.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string(),
        title: data
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        fullscreen: state == "FULLSCREEN",
        bounds: None,
    })
}

#[cfg(target_os = "linux")]
fn get_via_xprop() -> Option<ActiveWindowInfo> {
    let active = run("xprop", &["-root", "_NET_ACTIVE_WINDOW"])?;
    let id = active.split("window id #").nth(1)?.trim().to_string();
    if id.is_empty() || id == "0x0" || id == "0x0 (none)" {
        return None;
    }
    let props = run("xprop", &["-id", &id])?;
    let fullscreen = props.contains("_NET_WM_STATE_FULLSCREEN");
    let title = run("xprop", &["-id", &id, "_NET_WM_NAME"])
        .and_then(|text| quoted_value(&text))
        .unwrap_or_default();
    let owner = run("xprop", &["-id", &id, "WM_CLASS"])
        .and_then(|text| last_quoted(&text))
        .unwrap_or_else(|| "Unknown".to_string());
    Some(ActiveWindowInfo {
        owner,
        title,
        fullscreen,
        bounds: None,
    })
}

#[cfg(target_os = "linux")]
fn quoted_value(text: &str) -> Option<String> {
    let start = text.find('"')? + 1;
    let end = text[start..].find('"')? + start;
    Some(text[start..end].to_string())
}

#[cfg(target_os = "linux")]
fn last_quoted(text: &str) -> Option<String> {
    text.split('"')
        .skip(1)
        .step_by(2)
        .filter(|value| !value.is_empty() && *value != ", ")
        .last()
        .map(|value| value.to_string())
}

#[cfg(target_os = "linux")]
fn get_via_hyprctl() -> Option<ActiveWindowInfo> {
    let raw = run("hyprctl", &["activewindow", "-j"])?;
    let data: Value = serde_json::from_str(&raw).ok()?;
    if data.get("address").and_then(|v| v.as_str()) == Some("0x0") {
        return None;
    }
    let fullscreen = data
        .get("fullscreen")
        .and_then(|v| v.as_bool().or_else(|| v.as_i64().map(|n| n != 0)))
        .unwrap_or(false)
        || data
            .get("fullscreenMode")
            .and_then(|v| v.as_i64())
            .unwrap_or(0)
            > 0;
    let bounds = json_bounds(&data, "at", "size");
    Some(ActiveWindowInfo {
        owner: data
            .get("class")
            .or_else(|| data.get("initialClass"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string(),
        title: data
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        fullscreen,
        bounds,
    })
}

#[cfg(target_os = "linux")]
fn json_bounds(data: &Value, pos_key: &str, size_key: &str) -> Option<Bounds> {
    let pos = data.get(pos_key)?.as_array()?;
    let size = data.get(size_key)?.as_array()?;
    Some(Bounds {
        x: pos.first()?.as_f64()?,
        y: pos.get(1)?.as_f64()?,
        width: size.first()?.as_f64()?,
        height: size.get(1)?.as_f64()?,
    })
}

#[cfg(target_os = "linux")]
fn get_via_sway() -> Option<ActiveWindowInfo> {
    let raw = run("swaymsg", &["-t", "get_tree"])?;
    let tree: Value = serde_json::from_str(&raw).ok()?;
    let focused = find_focused(&tree)?;
    let fullscreen = focused
        .get("fullscreen_mode")
        .and_then(|v| v.as_i64())
        .map(|mode| mode == 1 || mode == 2)
        .unwrap_or(false);
    let bounds = focused.get("rect").map(|rect| Bounds {
        x: rect.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0),
        y: rect.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0),
        width: rect.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0),
        height: rect.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0),
    });
    Some(ActiveWindowInfo {
        owner: focused
            .get("app_id")
            .or_else(|| focused.pointer("/window_properties/class"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string(),
        title: focused
            .get("name")
            .or_else(|| focused.pointer("/window_properties/title"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        fullscreen,
        bounds,
    })
}

#[cfg(target_os = "linux")]
fn find_focused(node: &Value) -> Option<&Value> {
    if node.get("focused").and_then(|v| v.as_bool()) == Some(true)
        && node.get("type").and_then(|v| v.as_str()) == Some("con")
    {
        return Some(node);
    }
    if let Some(nodes) = node.get("nodes").and_then(|v| v.as_array()) {
        for child in nodes {
            if let Some(found) = find_focused(child) {
                return Some(found);
            }
        }
    }
    if let Some(nodes) = node.get("floating_nodes").and_then(|v| v.as_array()) {
        for child in nodes {
            if let Some(found) = find_focused(child) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn get_via_gnome() -> Option<ActiveWindowInfo> {
    let js = "global.display.focus_window && global.display.focus_window.is_fullscreen()";
    let raw = run(
        "gdbus",
        &[
            "call",
            "--session",
            "--dest",
            "org.gnome.Shell",
            "--object-path",
            "/org/gnome/Shell",
            "--method",
            "org.gnome.Shell.Eval",
            js,
        ],
    )?;
    let marker = "(true, '";
    let start = raw.find(marker)? + marker.len();
    let end = raw[start..].find('\'')? + start;
    Some(ActiveWindowInfo {
        owner: "GNOME".to_string(),
        title: String::new(),
        fullscreen: &raw[start..end] == "true",
        bounds: None,
    })
}

#[cfg(target_os = "linux")]
fn get_via_wlrctl() -> Option<ActiveWindowInfo> {
    let active = run("wlrctl", &["toplevel", "find", "state:active"])?;
    if active.trim().is_empty() {
        return None;
    }
    let fullscreen = run(
        "wlrctl",
        &["toplevel", "find", "state:active", "state:fullscreen"],
    )
    .map(|text| !text.trim().is_empty())
    .unwrap_or(false);
    Some(ActiveWindowInfo {
        owner: "wlr".to_string(),
        title: active.lines().next().unwrap_or("").to_string(),
        fullscreen,
        bounds: None,
    })
}
