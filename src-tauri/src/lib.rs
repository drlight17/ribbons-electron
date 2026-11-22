mod active_window;
mod autostart;
mod commands;
mod config;
mod dialogs;
mod display;
mod glass;
mod hid;
mod i18n;
mod idle;
mod logging;
mod media;
mod monitor;
mod single_instance;
mod state;
mod system_events;
mod system_theme;
mod tray;
mod updates;
mod windows;

use tauri::{AppHandle, Manager, RunEvent};

use state::AppState;

fn choose_locale(app: &AppHandle, requested: Option<String>) -> String {
    let locales = i18n::available_locales(app);
    if let Some(requested) = requested.filter(|s| !s.is_empty()) {
        if locales.iter().any(|l| l == &requested) {
            return requested;
        }
        let short = requested
            .split(['-', '_'])
            .next()
            .unwrap_or(&requested)
            .to_lowercase();
        if locales.iter().any(|l| l == &short) {
            return short;
        }
    }
    let system = config::locale_from_system();
    if locales.iter().any(|l| l == &system) {
        return system;
    }
    if let Some(short) = system.split(['-', '_']).next() {
        if locales.iter().any(|l| l == short) {
            return short.to_string();
        }
    }
    "en".to_string()
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();

    let config_dir = config::config_dir();
    config::ensure_dir(&config_dir)?;
    let store_path = config_dir.join("config.json");
    let mut store = config::Store::load(store_path);
    let defaults_changed = config::init_defaults(&mut store);

    let locale = choose_locale(&handle, store.get_str("locale"));
    let locale_changed = store.get_str("locale").as_deref() != Some(locale.as_str());
    if locale_changed {
        store.set_str("locale", &locale);
    }
    if defaults_changed || locale_changed {
        let _ = store.save();
    }

    let i18n = i18n::I18n::load(&handle, Some(&locale));
    let state = AppState::new(config_dir.clone(), store, i18n);
    {
        let theme = system_theme::resolve();
        *state.system_theme.lock().unwrap() = theme;
    }

    let hw_acc = state.store.lock().unwrap().get_bool_or("hw_acc", true);
    if !hw_acc {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            format!("{existing} --disable-gpu").trim().to_string(),
        );
    }

    app.manage(state);

    if !single_instance::init(&handle, &config_dir.join("instance.lock")) {
        return Ok(());
    }

    logging::write_log(
        &handle,
        format!(
            "{} v.{} started in {} mode (config: {})",
            config::APP_NAME,
            handle.package_info().version,
            if config::is_packaged() {
                "production"
            } else {
                "dev"
            },
            config_dir.display()
        ),
    );

    #[cfg(target_os = "macos")]
    {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }

    #[cfg(target_os = "linux")]
    check_linux_runtime(&handle);

    #[cfg(target_os = "macos")]
    {
        maybe_ask_media_detect(&handle);
        check_reduce_transparency(&handle);
    }

    #[cfg(unix)]
    spawn_signal_handlers(handle.clone());

    if config::is_packaged() {
        let enabled = handle
            .state::<AppState>()
            .store
            .lock()
            .unwrap()
            .get_bool_or("run_at_startup", false);
        autostart::set_run_at_startup(&handle, enabled);
    }

    windows::create_screensaver_windows(&handle);
    tray::init(&handle)?;

    register_shortcuts(&handle);

    display::start_watcher(handle.clone());
    system_events::start(handle.clone());
    idle::start(&handle);
    monitor::start(handle.clone());
    media::start(handle.clone());
    hid::start(handle.clone());

    let update_handle = handle.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        updates::check_new_version(&update_handle, false).await;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60 * 60)).await;
            updates::check_new_version(&update_handle, false).await;
        }
    });

    Ok(())
}

#[cfg(unix)]
fn spawn_signal_handlers(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};

        let Ok(mut terminate) = signal(SignalKind::terminate()) else {
            return;
        };
        let Ok(mut interrupt) = signal(SignalKind::interrupt()) else {
            return;
        };
        tokio::select! {
            _ = terminate.recv() => {}
            _ = interrupt.recv() => {}
        }
        {
            let state = app.state::<AppState>();
            state.runtime.lock().unwrap().quitting = true;
        }
        app.exit(0);
    });
}

#[cfg(target_os = "macos")]
fn check_reduce_transparency(app: &AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let is_glass = app
        .state::<AppState>()
        .store
        .lock()
        .map(|store| store.get_str("backgroundMode").as_deref() == Some("glass"))
        .unwrap_or(false);
    if !is_glass {
        return;
    }

    let enabled = std::process::Command::new("defaults")
        .args(["read", "com.apple.universalaccess", "reduceTransparency"])
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim() == "1")
        .unwrap_or(false);
    if !enabled {
        return;
    }

    let state = app.state::<AppState>();
    let i18n = state.i18n.lock().unwrap();
    let title = i18n.t("warning_vibrancy");
    let message = i18n.t("warning_vibrancy_details");
    drop(i18n);

    crate::dialogs::dialog_opened(app);
    let app2 = app.clone();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::Ok)
        .show(move |_| crate::dialogs::dialog_closed(&app2));
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.universalaccess?Display")
        .status();
}

fn register_shortcuts(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    if autostart::is_kde_plasma5() {
        logging::write_log(
            app,
            "Skip globalShortcut registration in old KDE Plasma 5 to prevent GUI issues",
        );
        return;
    }

    let pause = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyP);
    if let Err(err) = app
        .global_shortcut()
        .on_shortcut(pause, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                windows::toggle_all(app);
            }
        })
    {
        logging::write_log(app, format!("Failed to register Ctrl+P: {err}"));
    }

    let restart = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Escape);
    if let Err(err) = app
        .global_shortcut()
        .on_shortcut(restart, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                logging::write_log(app, "Alt+Shift+Escape is pressed. Restart app!");
                autostart::restart_app(app);
            }
        })
    {
        logging::write_log(app, format!("Failed to register Alt+Shift+Escape: {err}"));
    }
}

#[cfg(target_os = "linux")]
fn command_exists(command: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths).any(|dir| {
                let path = dir.join(command);
                path.is_file()
            })
        })
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn check_linux_runtime(app: &AppHandle) {
    use tauri_plugin_dialog::DialogExt;

    let wayland = std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var("WAYLAND_DISPLAY").is_ok();

    let (missing, key) = if wayland {
        (!command_exists("wctx"), "error5")
    } else {
        (!command_exists("xprop"), "error2")
    };

    if missing {
        let state = app.state::<AppState>();
        let i18n = state.i18n.lock().unwrap();
        let title = i18n.t("error");
        let message = i18n.t(key);
        drop(i18n);
        let app2 = app.clone();
        crate::dialogs::dialog_opened(app);
        app.dialog()
            .message(message)
            .title(title)
            .kind(tauri_plugin_dialog::MessageDialogKind::Error)
            .buttons(tauri_plugin_dialog::MessageDialogButtons::Ok)
            .show(move |_| {
                crate::dialogs::dialog_closed(&app2);
                app2.exit(0);
            });
    }
}

#[cfg(target_os = "macos")]
fn maybe_ask_media_detect(app: &AppHandle) {
    use tauri_plugin_dialog::{
        DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
    };

    let has_value = app
        .state::<AppState>()
        .store
        .lock()
        .unwrap()
        .has("media_detect");
    if has_value {
        return;
    }

    let state = app.state::<AppState>();
    let i18n = state.i18n.lock().unwrap();
    let title = i18n.t("warning_media_detect");
    let message = i18n.t("warning_media_detect_details");
    let yes = i18n.t("yes");
    let no = i18n.t("no");
    drop(i18n);

    let app2 = app.clone();
    let no_label = no.clone();
    let cancel_label = "Cancel".to_string();
    crate::dialogs::dialog_opened(app);
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            yes,
            no,
            cancel_label.clone(),
        ))
        .show_with_result(move |result| {
            crate::dialogs::dialog_closed(&app2);
            match result {
                MessageDialogResult::Custom(label) if label == no_label => {
                    save_media_detect(&app2, true);
                    autostart::restart_app(&app2);
                }
                MessageDialogResult::Custom(label) if label == cancel_label => app2.exit(0),
                MessageDialogResult::No => {
                    save_media_detect(&app2, true);
                    autostart::restart_app(&app2);
                }
                MessageDialogResult::Yes => save_media_detect(&app2, false),
                _ => save_media_detect(&app2, false),
            }
        });
}

#[cfg(target_os = "macos")]
fn save_media_detect(app: &AppHandle, enabled: bool) {
    let state = app.state::<AppState>();
    let mut store = state.store.lock().unwrap();
    store.set_bool("media_detect", enabled);
    let _ = store.save();
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(target_os = "windows"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if cfg!(target_os = "macos") {
                app.exit(0);
                return;
            }
            let (title, message) = if let Some(state) = app.try_state::<AppState>() {
                let i18n = state.i18n.lock().unwrap();
                (i18n.t("error"), i18n.t("error1"))
            } else {
                (
                    "Error".to_string(),
                    "Screensaver is already running!".to_string(),
                )
            };
            dialogs::show_error(app, &title, &message);
        }));
    }

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::renderer_message,
            commands::get_update_info,
            commands::get_about_info,
            commands::open_external
        ])
        .setup(setup)
        .build(tauri::generate_context!())
        .expect("error while building Ribbons");

    app.run(|app, event| match event {
        RunEvent::ExitRequested { .. } => {
            if let Some(state) = app.try_state::<AppState>() {
                state.runtime.lock().unwrap().quitting = true;
            }
        }
        RunEvent::Exit => {
            let state = app.state::<AppState>();
            state.stop_audio();
            #[cfg(target_os = "linux")]
            let media_detect = state
                .store
                .lock()
                .map(|store| store.get_bool_or("media_detect", false))
                .unwrap_or(false);
            #[cfg(target_os = "linux")]
            if media_detect {
                logging::write_log(
                    app,
                    "Linux detected. Restarting pipewire to prevent capture process leaks",
                );
                let _ = std::process::Command::new("systemctl")
                    .args(["--user", "restart", "pipewire", "wireplumber"])
                    .status();
            }
            logging::write_log(
                app,
                format!(
                    "{} v.{} is exited",
                    app.package_info().name,
                    app.package_info().version
                ),
            );
        }
        _ => {}
    });
}
