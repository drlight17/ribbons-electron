use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::i18n::resource_file;
use crate::state::AppState;

pub const TRAY_ID: &str = "main";

fn tray_icon_name(paused: bool) -> &'static str {
    #[cfg(target_os = "macos")]
    {
        if paused {
            "iconTemplatePaused.png"
        } else {
            "iconTemplate.png"
        }
    }
    #[cfg(target_os = "windows")]
    {
        if paused {
            "iconPaused.ico"
        } else {
            "icon.ico"
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if paused {
            "iconPaused.png"
        } else {
            "icon.png"
        }
    }
}

pub fn load_window_icon(app: &AppHandle) -> Option<tauri::image::Image<'static>> {
    #[cfg(target_os = "windows")]
    let name = "icon.ico";
    #[cfg(not(target_os = "windows"))]
    let name = "icon.png";
    let path = resource_file(app, name);
    if path.exists() {
        tauri::image::Image::from_path(path).ok()
    } else {
        None
    }
}

pub fn load_tray_icon(app: &AppHandle, paused: bool) -> Option<tauri::image::Image<'static>> {
    let path = resource_file(app, tray_icon_name(paused));
    if !path.exists() {
        return None;
    }
    tauri::image::Image::from_path(path).ok()
}

pub fn set_tray_icon(app: &AppHandle, paused: bool) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Some(icon) = load_tray_icon(app, paused) {
            let _ = tray.set_icon(Some(icon));
        }
        #[cfg(target_os = "macos")]
        {
            let _ = tray.set_icon_as_template(true);
        }
    }
}

pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<AppState>();
    let (any_running, any_paused, modal_open, update_available, latest) = {
        let runtime = state.runtime.lock().unwrap();
        (
            runtime.windows.values().any(|w| w.running),
            runtime.windows.values().any(|w| w.paused),
            runtime.modal_open(),
            runtime.update_available,
            runtime.latest_version.clone(),
        )
    };
    let t = |key: &str| state.i18n.lock().unwrap().t(key);

    let play_enabled = !any_running && !modal_open;
    let pause_enabled = !any_running && !modal_open && !any_paused;
    let settings_enabled = !any_running;

    let play = MenuItem::with_id(
        app,
        "play",
        format!("⏵  {}", t("show_now")),
        play_enabled,
        None::<&str>,
    )?;
    let pause = MenuItem::with_id(
        app,
        "pause",
        format!("⏸  {}", t("pause")),
        pause_enabled,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(
        app,
        "settings",
        format!("🛠️  {}", t("settings")),
        settings_enabled,
        None::<&str>,
    )?;
    let config = MenuItem::with_id(
        app,
        "settings_json",
        format!("📜  {}", t("settings_json")),
        true,
        None::<&str>,
    )?;

    let about_show = MenuItem::with_id(
        app,
        "about_show",
        format!("ℹ️  {}", t("show")),
        true,
        None::<&str>,
    )?;
    let (update_label, update_enabled) = if update_available {
        (
            format!("🔥  {}: {}", t("new_version"), latest.unwrap_or_default()),
            true,
        )
    } else {
        (format!("✗  {}", t("new_version_no")), false)
    };
    let update_status = MenuItem::with_id(
        app,
        "update_status",
        update_label,
        update_enabled,
        None::<&str>,
    )?;
    let check_update = MenuItem::with_id(
        app,
        "check_update",
        format!("🔎  {}", t("check_new_version")),
        !update_available,
        None::<&str>,
    )?;
    let about = Submenu::with_id_and_items(
        app,
        "about",
        format!("ℹ️  {}", t("about")),
        true,
        &[&about_show, &update_status, &check_update],
    )?;

    let restart = MenuItem::with_id(
        app,
        "restart",
        format!("↩️  {}", t("restart_app")),
        true,
        None::<&str>,
    )?;
    let exit = MenuItem::with_id(
        app,
        "exit",
        format!("🚪  {}", t("exit")),
        true,
        None::<&str>,
    )?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    Menu::with_items(
        app,
        &[
            &play, &pause, &sep1, &settings, &config, &about, &sep2, &restart, &exit,
        ],
    )
}

pub fn rebuild_menu(app: &AppHandle) {
    if let Ok(menu) = build_menu(app) {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let paused = app
        .state::<AppState>()
        .runtime
        .lock()
        .map(|runtime| runtime.modal_open())
        .unwrap_or(false);
    let icon = load_tray_icon(app, paused);
    let tooltip = format!(
        "{} v.{}",
        app.package_info().name,
        app.package_info().version
    );

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(tooltip)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(on_tray_event);

    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }

    let tray = builder.build(app)?;
    #[cfg(target_os = "macos")]
    {
        let _ = tray.set_icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = tray;
    }
    Ok(())
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "play" => {
            let ids = display_ids(app);
            for id in ids {
                crate::windows::start_screensaver(app, &id, false);
            }
        }
        "pause" => {
            let ids = display_ids(app);
            for id in ids {
                crate::windows::toggle_screensaver(app, &id);
            }
        }
        "settings" => crate::windows::open_settings(app),
        "settings_json" => {
            let state = app.state::<AppState>();
            let path = state.config_dir.join("config.json");
            crate::logging::write_log(
                app,
                format!("Opening config.json file in {}", state.config_dir.display()),
            );
            crate::dialogs::open_file(app, path);
        }
        "about_show" => crate::windows::open_about(app),
        "update_status" | "check_update" => {
            crate::updates::spawn_check(app, true);
        }
        "restart" => crate::autostart::restart_app(app),
        "exit" => {
            {
                let state = app.state::<AppState>();
                state.runtime.lock().unwrap().quitting = true;
            }
            #[cfg(target_os = "macos")]
            {
                crate::autostart::bootout_macos_agent();
            }
            app.exit(0);
        }
        _ => {}
    }
}

fn on_tray_event(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    if cfg!(target_os = "macos") {
        return;
    }
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        let app = tray.app_handle();
        let state = app.state::<AppState>();
        if state.runtime.lock().unwrap().blocked_icon {
            return;
        }
        let ids = display_ids(app);
        for id in ids {
            crate::windows::start_screensaver(app, &id, false);
        }
    }
}

fn display_ids(app: &AppHandle) -> Vec<String> {
    let state = app.state::<AppState>();
    let runtime = state.runtime.lock().unwrap();
    runtime.displays.iter().map(|d| d.id.clone()).collect()
}
