use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

use crate::config::APP_NAME;
use crate::display;
use crate::logging::write_log;
use crate::state::{AppState, DisplayInfo};
use crate::tray;

const SETTINGS_WIDTH: f64 = 1024.0;
const SETTINGS_HEIGHT: f64 = 768.0;

pub fn window_label(id: &str) -> String {
    let sanitized: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '/') {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("screensaver-{sanitized}")
}

fn display_by_id(app: &AppHandle, id: &str) -> Option<DisplayInfo> {
    let state = app.state::<AppState>();
    let runtime = state.runtime.lock().unwrap();
    runtime.displays.iter().find(|d| d.id == id).cloned()
}

pub fn create_screensaver_windows(app: &AppHandle) {
    let displays = display::collect_displays(app);
    {
        let state = app.state::<AppState>();
        let mut runtime = state.runtime.lock().unwrap();
        runtime.displays = displays.clone();
        runtime.display_signature = display::signature(&display::all_monitors(app));
        for display in &displays {
            runtime.windows.entry(display.id.clone()).or_default();
        }
    }

    for display in &displays {
        let label = window_label(&display.id);
        if app.get_webview_window(&label).is_some() {
            continue;
        }

        let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title(APP_NAME)
            .inner_size(display.bounds.width, display.bounds.height)
            .position(display.bounds.x, display.bounds.y)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .resizable(false)
            .visible(false)
            .focused(false);

        match builder.build() {
            Ok(window) => {
                if let Some(icon) = tray::load_window_icon(app) {
                    let _ = window.set_icon(icon);
                }
                let _ = window.set_always_on_top(true);
                let _ = window.set_visible_on_all_workspaces(true);
                raise_to_screensaver_level(&window);
                let _ = window.set_focusable(false);
                apply_physical_bounds(&window, display);

                let state = app.state::<AppState>();
                let glass = state
                    .store
                    .lock()
                    .map(|s| s.get_str("backgroundMode").as_deref() == Some("glass"))
                    .unwrap_or(false);
                if glass {
                    apply_window_glass(&window);
                }
                if glass
                    || state
                        .store
                        .lock()
                        .map(|s| s.get_str("backgroundMode").as_deref() == Some("transparent"))
                        .unwrap_or(false)
                {
                    let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
                }

                let app2 = app.clone();
                let id2 = display.id.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let quitting = app2
                            .state::<AppState>()
                            .runtime
                            .lock()
                            .map(|runtime| runtime.quitting)
                            .unwrap_or(false);
                        if quitting {
                            return;
                        }
                        api.prevent_close();
                        stop_screensaver(&app2, &id2);
                    }
                });

                write_log(
                    app,
                    format!("Display to use: {} (id {})", display.label, display.id),
                );
            }
            Err(err) => {
                write_log(
                    app,
                    format!("Failed to create window for display {}: {err}", display.id),
                );
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn raise_to_screensaver_level(window: &tauri::WebviewWindow) {
    let window_for_closure = window.clone();
    let _ = window.run_on_main_thread(move || {
        use objc::{msg_send, sel, sel_impl};

        const KCG_SCREEN_SAVER_WINDOW_LEVEL: isize = 1000;
        if let Ok(ns_window) = window_for_closure.ns_window() {
            let ns_window = ns_window as *mut objc::runtime::Object;
            unsafe {
                let _: () = msg_send![ns_window, setLevel: KCG_SCREEN_SAVER_WINDOW_LEVEL];
            }
        }
    });
}

#[cfg(target_os = "linux")]
fn raise_to_screensaver_level(window: &tauri::WebviewWindow) {
    use gtk::prelude::*;

    if let Ok(gtk_window) = window.gtk_window() {
        gtk_window.set_keep_above(true);
        gtk_window.set_skip_taskbar_hint(true);
        gtk_window.set_skip_pager_hint(true);
        gtk_window.set_decorated(false);
        gtk_window.stick();
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn raise_to_screensaver_level(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "linux")]
fn present_screensaver_window(window: &tauri::WebviewWindow) {
    use gtk::prelude::*;

    if let Ok(gtk_window) = window.gtk_window() {
        gtk_window.set_keep_above(true);
        gtk_window.stick();
        gtk_window.present();
    }
}

#[cfg(not(target_os = "linux"))]
fn present_screensaver_window(_window: &tauri::WebviewWindow) {}

fn apply_window_glass(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        let _ = apply_vibrancy(
            window,
            NSVisualEffectMaterial::FullScreenUI,
            Some(NSVisualEffectState::Active),
            Some(0.0),
        );
    }
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::apply_acrylic;
        let _ = apply_acrylic(window, Some((0, 0, 0, 0)));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
    }
}

pub fn build_options(app: &AppHandle, display: &DisplayInfo) -> Value {
    let state = app.state::<AppState>();
    let store = state.store.lock().unwrap();
    let theme = state.system_theme.lock().unwrap().clone();
    let background_mode = store
        .get_str("backgroundMode")
        .unwrap_or_else(|| "auto".into());
    let background_mode = if background_mode == "auto" {
        theme.clone()
    } else {
        background_mode
    };
    let ui_theme = store.get_str("ui_theme").unwrap_or_else(|| "auto".into());
    let ui_theme = if ui_theme == "auto" { theme } else { ui_theme };
    let close_title = state.i18n.lock().unwrap().t("close");
    let stretched = display.id == "stretched";
    let glass_background = if background_mode == "glass" {
        state
            .runtime
            .lock()
            .unwrap()
            .glass_backgrounds
            .get(&display.id)
            .cloned()
    } else {
        None
    };

    json!({
        "closeBtnTitle": close_title,
        "engine": store.get_str("engine").unwrap_or_else(|| "modern".into()),
        "endless": store.get_bool_or("endless", true),
        "freezeBeforeFade": store.get_bool_or("freezeBeforeFade", true),
        "opacity": store.get_f64_or("opacity", 85.0),
        "glow": store.get_f64_or("glow", 26.0),
        "blur": store.get_f64_or("blur", 0.0),
        "shaftBrightness": store.get_f64_or("shaftBrightness", 100.0),
        "edgeSoftness": store.get_f64_or("edgeSoftness", 100.0),
        "minLength": store.get_f64_or("minLength", 1.0),
        "maxLength": store.get_f64_or("maxLength", 6.0),
        "minWidth": store.get_f64_or("minWidth", 25.0),
        "maxWidth": store.get_f64_or("maxWidth", 55.0),
        "minCurl": store.get_f64_or("minCurl", 0.0),
        "maxCurl": store.get_f64_or("maxCurl", 0.15),
        "minTwist": store.get_f64_or("minTwist", 0.0),
        "maxTwist": store.get_f64_or("maxTwist", 0.0),
        "curlAmplitude": store.get_f64_or("curlAmplitude", 0.05),
        "backgroundMode": background_mode,
        "glassBackground": glass_background,
        "ui_theme": ui_theme,
        "ribbonCount": store.get_u64_or("ribbonCount", 3),
        "colorCycleSpeed": store.get_f64_or("colorCycleSpeed", 3.0),
        "horizontalSpeed": store.get("horizontalSpeed").cloned().unwrap_or_else(|| json!("normal")),
        "singleColor": store.get("singleColor").cloned().unwrap_or(Value::Bool(false)),
        "locale": store.get_str("locale").unwrap_or_else(|| "en".into()),
        "datetime_front": store.get_bool_or("datetime_front", false),
        "show_datetime": store.get_bool_or("show_datetime", false),
        "randomize_datetime_pos": stretched || store.get_bool_or("randomize_datetime_pos", false),
        "datetime_pos": store.get_str("datetime_pos").unwrap_or_else(|| "center".into()),
        "display_bounds": display.bounds,
        "src_bounds": display.src_bounds.clone().map(|b| json!(b)).unwrap_or(Value::Null),
    })
}

fn apply_physical_bounds(window: &tauri::WebviewWindow, display: &DisplayInfo) {
    let _ = window.set_position(PhysicalPosition::new(
        display.physical.x,
        display.physical.y,
    ));
    let _ = window.set_size(tauri::PhysicalSize::new(
        display.physical.width.max(1.0) as u32,
        display.physical.height.max(1.0) as u32,
    ));
}

fn enter_fullscreen(window: &tauri::WebviewWindow, display: &DisplayInfo) {
    if display.id == "stretched" {
        apply_physical_bounds(window, display);
        return;
    }

    #[cfg(target_os = "macos")]
    {
        // Native fullscreen on macOS creates a new Space and can crash borderless
        // transparent windows. A screen-saver-level borderless window covering the
        // display is sufficient and behaves like a real screensaver.
        apply_physical_bounds(window, display);
        raise_to_screensaver_level(window);
        return;
    }

    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;

        if let Ok(gtk_window) = window.gtk_window() {
            if let Some(screen) = gtk::prelude::WidgetExt::screen(&gtk_window) {
                gtk_window.fullscreen_on_monitor(&screen, display.index as i32);
                return;
            }
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let position = PhysicalPosition::new(display.physical.x, display.physical.y);
        if window.set_fullscreen_on_monitor(position).is_err() {
            let _ = window.set_fullscreen(true);
        }
    }
}

pub fn start_screensaver(app: &AppHandle, id: &str, force: bool) {
    #[cfg(target_os = "macos")]
    write_log(app, format!("macOS: screensaver start requested for {id}"));

    let state = app.state::<AppState>();
    let modal_open = state.runtime.lock().unwrap().modal_open();
    if modal_open && !force {
        return;
    }
    let Some(display) = display_by_id(app, id) else {
        return;
    };
    let label = window_label(id);
    let Some(window) = app.get_webview_window(&label) else {
        write_log(app, format!("Screensaver window {label} is missing"));
        return;
    };

    let first_display = {
        let runtime = state.runtime.lock().unwrap();
        !runtime.windows.values().any(|window| window.running)
    };
    if first_display {
        crate::glass::prepare(app);
    }

    {
        let mut runtime = state.runtime.lock().unwrap();
        let entry = runtime.windows.entry(id.to_string()).or_default();
        entry.running = true;
        entry.paused = false;
        entry.close_allowed_at = crate::state::now_ms() + 2000;
    }

    // Set the exact monitor bounds before mapping the window. On compositors
    // where fullscreen requests are delayed or ignored this still fills the screen.
    apply_physical_bounds(&window, &display);

    let _ = window.set_focusable(true);
    send_options(app, &display);
    #[cfg(target_os = "macos")]
    write_log(app, format!("macOS: showing screensaver window {label}"));
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
    raise_to_screensaver_level(&window);

    // Fullscreen is more reliable after the surface has been mapped.
    #[cfg(target_os = "macos")]
    write_log(
        app,
        format!("macOS: applying screensaver geometry for {id}"),
    );
    enter_fullscreen(&window, &display);
    #[cfg(target_os = "macos")]
    write_log(app, format!("macOS: screensaver geometry applied for {id}"));
    present_screensaver_window(&window);

    let delayed_window = window.clone();
    let delayed_display = display.clone();
    let delayed_app = app.clone();
    tauri::async_runtime::spawn(async move {
        for delay in [300u64, 900, 1800] {
            tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
            let still_running = delayed_app
                .state::<AppState>()
                .runtime
                .lock()
                .map(|runtime| {
                    runtime
                        .windows
                        .get(&delayed_display.id)
                        .map(|entry| entry.running)
                        .unwrap_or(false)
                })
                .unwrap_or(false);
            if !still_running {
                return;
            }

            enter_fullscreen(&delayed_window, &delayed_display);
            #[cfg(not(target_os = "macos"))]
            if !delayed_window.is_fullscreen().unwrap_or(false) {
                let _ = delayed_window.set_fullscreen(true);
            }
            present_screensaver_window(&delayed_window);
        }
    });

    write_log(
        app,
        format!(
            "Start screensaver at display {} (id {})",
            display.label, display.id
        ),
    );
    tray::rebuild_menu(app);
    let paused_icon = app.state::<AppState>().runtime.lock().unwrap().modal_open();
    tray::set_tray_icon(app, paused_icon);
}

pub fn send_options(app: &AppHandle, display: &DisplayInfo) {
    let Some(window) = app.get_webview_window(&window_label(&display.id)) else {
        return;
    };
    let paused = {
        let state = app.state::<AppState>();
        let runtime = state.runtime.lock().unwrap();
        let paused = runtime
            .windows
            .get(&display.id)
            .map(|w| w.paused)
            .unwrap_or(false);
        drop(runtime);
        paused
    };
    let options = build_options(app, display);
    let _ = window.emit(
        "send-options",
        json!({ "options": options, "paused": paused }),
    );
}

pub fn mark_renderer_ready(app: &AppHandle, label: &str) {
    let display = {
        let state = app.state::<AppState>();
        let mut runtime = state.runtime.lock().unwrap();
        let Some((id, entry)) = runtime
            .windows
            .iter_mut()
            .find(|(id, _)| window_label(id) == label)
        else {
            return;
        };
        entry.renderer_ready = true;
        if !entry.running {
            return;
        }
        let id = id.clone();
        runtime.displays.iter().find(|d| d.id == id).cloned()
    };
    if let Some(display) = display {
        send_options(app, &display);
    }
}

pub fn stop_screensaver(app: &AppHandle, id: &str) {
    let label = window_label(id);
    if let Some(window) = app.get_webview_window(&label) {
        if window.is_visible().unwrap_or(false) {
            #[cfg(not(target_os = "macos"))]
            if id != "stretched" {
                let _ = window.set_fullscreen(false);
            }
            let _ = window.emit("send-stop", true);
            let _ = window.hide();
        }
    }

    let state = app.state::<AppState>();
    let paused = {
        let mut runtime = state.runtime.lock().unwrap();
        let paused = runtime.modal_open();
        if let Some(entry) = runtime.windows.get_mut(id) {
            entry.running = false;
            entry.paused = paused;
            entry.close_allowed_at = 0;
            entry.last_close_sent = 0;
        }
        paused
    };
    tray::rebuild_menu(app);
    tray::set_tray_icon(app, paused);
    write_log(app, format!("Screensaver stopped at display {id}"));
}

pub fn stop_all(app: &AppHandle) {
    let ids: Vec<String> = {
        let state = app.state::<AppState>();
        let runtime = state.runtime.lock().unwrap();
        runtime.displays.iter().map(|d| d.id.clone()).collect()
    };
    for id in ids {
        stop_screensaver(app, &id);
    }
}

pub fn toggle_screensaver(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    let paused = state
        .runtime
        .lock()
        .unwrap()
        .windows
        .get(id)
        .map(|w| w.paused)
        .unwrap_or(false);

    let label = window_label(id);
    if !paused {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.emit("send-pause", ());
        }
        state
            .runtime
            .lock()
            .unwrap()
            .windows
            .entry(id.to_string())
            .or_default()
            .paused = true;
        tray::rebuild_menu(app);
        tray::set_tray_icon(app, true);
        write_log(app, "Screensaver is paused");
    } else {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.emit("send-stop", true);
        }
        start_screensaver(app, id, true);
        write_log(app, "Screensaver is resumed");
    }
}

pub fn toggle_all(app: &AppHandle) {
    let ids: Vec<String> = {
        let state = app.state::<AppState>();
        let runtime = state.runtime.lock().unwrap();
        runtime.displays.iter().map(|d| d.id.clone()).collect()
    };
    for id in ids {
        toggle_screensaver(app, &id);
    }
}

pub fn open_about(app: &AppHandle) {
    let title = {
        let state = app.state::<AppState>();
        let i18n = state.i18n.lock().unwrap();
        format!("{} {}", i18n.t("about"), APP_NAME)
    };

    if let Some(window) = app.get_webview_window("about") {
        let _ = window.set_title(&title);
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    {
        let state = app.state::<AppState>();
        let mut runtime = state.runtime.lock().unwrap();
        runtime.about_open = true;
        runtime.blocked_icon = true;
        for window in runtime.windows.values_mut() {
            window.paused = true;
        }
    }
    tray::rebuild_menu(app);
    tray::set_tray_icon(app, true);

    let builder = WebviewWindowBuilder::new(app, "about", WebviewUrl::App("about.html".into()))
        .title(title)
        .inner_size(520.0, 440.0)
        .center()
        .resizable(false)
        .always_on_top(true)
        .visible(false);

    match builder.build() {
        Ok(window) => {
            if let Some(icon) = tray::load_window_icon(app) {
                let _ = window.set_icon(icon);
            }

            let app2 = app.clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    about_closed(&app2);
                }
            });

            let _ = window.show();
            let _ = window.set_focus();
            write_log(app, "About window opened");
        }
        Err(err) => {
            write_log(app, format!("Failed to open About window: {err}"));
            let state = app.state::<AppState>();
            let mut runtime = state.runtime.lock().unwrap();
            runtime.about_open = false;
            let paused = runtime.settings_open;
            runtime.blocked_icon = paused;
            for window in runtime.windows.values_mut() {
                window.paused = paused;
            }
            drop(runtime);
            tray::rebuild_menu(app);
            tray::set_tray_icon(app, paused);
        }
    }
}

fn about_closed(app: &AppHandle) {
    let state = app.state::<AppState>();
    let paused;
    {
        let mut runtime = state.runtime.lock().unwrap();
        if runtime.quitting {
            return;
        }
        runtime.about_open = false;
        paused = runtime.settings_open;
        runtime.blocked_icon = paused;
        for window in runtime.windows.values_mut() {
            window.paused = paused;
        }
    }
    tray::rebuild_menu(app);
    tray::set_tray_icon(app, paused);
    write_log(app, "About window closed");
}

fn settings_center(app: &AppHandle) -> Option<(f64, f64)> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|position| {
            app.monitor_from_point(position.x, position.y)
                .ok()
                .flatten()
        })
        .or_else(|| app.primary_monitor().ok().flatten())?;

    let scale = monitor.scale_factor();
    if scale <= 0.0 {
        return None;
    }

    let position = monitor.position();
    let size = monitor.size();
    let x = (position.x as f64 + (size.width as f64 - SETTINGS_WIDTH * scale) / 2.0) / scale;
    let y = (position.y as f64 + (size.height as f64 - SETTINGS_HEIGHT * scale) / 2.0) / scale;
    Some((x, y))
}

pub fn open_settings(app: &AppHandle) {
    let center = settings_center(app);

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_size(tauri::LogicalSize::new(SETTINGS_WIDTH, SETTINGS_HEIGHT));
        if let Some((x, y)) = center {
            let _ = window.set_position(tauri::LogicalPosition::new(x, y));
        }
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let state = app.state::<AppState>();
    {
        let mut runtime = state.runtime.lock().unwrap();
        runtime.settings_open = true;
        runtime.blocked_icon = true;
        for window in runtime.windows.values_mut() {
            window.paused = true;
        }
    }
    tray::rebuild_menu(app);
    tray::set_tray_icon(app, true);

    let builder =
        WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
            .title("Ribbons — settings")
            .inner_size(SETTINGS_WIDTH, SETTINGS_HEIGHT)
            .visible(false)
            .resizable(true)
            .decorations(true)
            .skip_taskbar(true)
            .transparent(!cfg!(target_os = "windows"));
    let builder = match center {
        Some((x, y)) => builder.position(x, y),
        None => builder.center(),
    };

    match builder.build() {
        Ok(window) => {
            if let Some(icon) = tray::load_window_icon(app) {
                let _ = window.set_icon(icon);
            }
            #[cfg(target_os = "macos")]
            {
                let _ = window.set_always_on_top(true);
                use window_vibrancy::{
                    apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
                };
                let _ = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::FullScreenUI,
                    Some(NSVisualEffectState::Active),
                    Some(0.0),
                );
            }
            let glass = state
                .store
                .lock()
                .map(|s| s.get_str("backgroundMode").as_deref() == Some("glass"))
                .unwrap_or(false);
            if glass {
                apply_settings_chrome(app, true);
            }

            let app2 = app.clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    settings_closed(&app2);
                }
            });

            let _ = window.show();
            let _ = window.set_focus();
            write_log(app, "Settings window opened");
        }
        Err(err) => {
            write_log(app, format!("Failed to open settings window: {err}"));
            let mut runtime = state.runtime.lock().unwrap();
            runtime.settings_open = false;
            let paused = runtime.about_open;
            runtime.blocked_icon = paused;
            for window in runtime.windows.values_mut() {
                window.paused = paused;
            }
            drop(runtime);
            tray::rebuild_menu(app);
            tray::set_tray_icon(app, paused);
        }
    }
}

fn settings_closed(app: &AppHandle) {
    let state = app.state::<AppState>();
    let paused;
    {
        let mut runtime = state.runtime.lock().unwrap();
        if runtime.quitting {
            return;
        }
        runtime.settings_open = false;
        paused = runtime.about_open;
        runtime.blocked_icon = paused;
        for window in runtime.windows.values_mut() {
            window.paused = paused;
        }
    }
    tray::rebuild_menu(app);
    tray::set_tray_icon(app, paused);
    write_log(app, "Settings window closed");
}

pub fn apply_settings_chrome(app: &AppHandle, glass: bool) {
    let Some(window) = app.get_webview_window("settings") else {
        return;
    };
    let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));

    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{
            apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
        };
        if glass {
            let _ = apply_vibrancy(
                &window,
                NSVisualEffectMaterial::FullScreenUI,
                Some(NSVisualEffectState::Active),
                Some(0.0),
            );
        } else {
            let _ = clear_vibrancy(&window);
        }
    }
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, clear_acrylic};
        if glass {
            let _ = apply_acrylic(&window, Some((0, 0, 0, 0)));
        } else {
            let _ = clear_acrylic(&window);
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, glass);
    }
}

pub fn apply_settings(app: &AppHandle) {
    let locale = {
        let state = app.state::<AppState>();
        let store = state.store.lock().unwrap();
        store.get_str("locale")
    };

    let i18n = crate::i18n::I18n::load(app, locale.as_deref());
    let tag = i18n.tag.clone();
    {
        let state = app.state::<AppState>();
        *state.i18n.lock().unwrap() = i18n;
    }

    update_window_titles(app);
    tray::rebuild_menu(app);
    refresh_screensaver_windows(app);

    if let Some(window) = app.get_webview_window("about") {
        let _ = window.emit("ribbons-i18n-changed", tag);
    }
}

fn update_window_titles(app: &AppHandle) {
    let (about_title, settings_title, update_title) = {
        let state = app.state::<AppState>();
        let i18n = state.i18n.lock().unwrap();
        (
            format!("{} {}", i18n.t("about"), APP_NAME),
            i18n.t("settings_title"),
            i18n.t("new_version"),
        )
    };

    if let Some(window) = app.get_webview_window("about") {
        let _ = window.set_title(&about_title);
    }
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_title(&settings_title);
    }
    if let Some(window) = app.get_webview_window("update") {
        let _ = window.set_title(&update_title);
    }
}

fn refresh_screensaver_windows(app: &AppHandle) {
    let displays = display::collect_displays(app);
    let signature = display::signature(&displays);
    let old_ids: Vec<String> = {
        let state = app.state::<AppState>();
        let runtime = state.runtime.lock().unwrap();
        runtime.windows.keys().cloned().collect()
    };
    let changed = {
        let state = app.state::<AppState>();
        let runtime = state.runtime.lock().unwrap();
        display::signature(&runtime.displays) != signature
    };

    if !changed {
        for display in &displays {
            send_options(app, display);
        }
        return;
    }

    stop_all(app);
    for id in &old_ids {
        if let Some(window) = app.get_webview_window(&window_label(id)) {
            let _ = window.destroy();
        }
    }
    {
        let state = app.state::<AppState>();
        let mut runtime = state.runtime.lock().unwrap();
        runtime.windows.clear();
        runtime.displays.clear();
    }
    create_screensaver_windows(app);
}

pub fn settings_snapshot(app: &AppHandle) -> Value {
    let state = app.state::<AppState>();
    let mut snapshot = state.store.lock().unwrap().snapshot();
    let displays: Vec<Value> = display::all_monitors(app)
        .iter()
        .map(|d| json!({ "id": d.id, "label": d.label }))
        .collect();
    if let Value::Object(map) = &mut snapshot {
        map.insert(
            "_meta".to_string(),
            json!({
                "isPackaged": crate::config::is_packaged(),
                "displays": displays
            }),
        );
    }
    snapshot
}
