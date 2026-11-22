use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(unix)]
use std::process::Stdio;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use crate::config::APP_NAME;
use crate::config::APP_NAME_LC;
use crate::logging::write_log;
use crate::state::AppState;

pub fn is_kde_plasma5() -> bool {
    if !cfg!(target_os = "linux") {
        return false;
    }
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    desktop.split(':').any(|part| part == "KDE")
        && std::env::var("KDE_SESSION_VERSION").as_deref() == Ok("5")
}

pub fn restart_app(app: &AppHandle) {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|arg| arg == "--systemd") {
        write_log(
            app,
            "Application was run as service. Restarting systemd service.",
        );
        let _ = Command::new("systemctl")
            .args(["--user", "restart", &format!("{APP_NAME_LC}.service")])
            .status();
        return;
    }

    {
        let state = app.state::<AppState>();
        let mut runtime = state.runtime.lock().unwrap();
        if runtime.quitting {
            return;
        }
        runtime.quitting = true;
    }

    crate::single_instance::release();

    let uses_dev_server = !crate::config::is_packaged() && app.config().build.dev_url.is_some();
    if uses_dev_server && spawn_dev_restart(app) {
        exit_after_restart(app);
        return;
    }

    let executable = std::env::var("APPIMAGE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_exe().unwrap_or_else(|_| PathBuf::from(APP_NAME_LC)));

    // Launch the replacement after the current process released the single-instance lock.
    let spawned = spawn_delayed_restart(&executable, &args);
    if spawned.is_err() {
        close_all_windows(app);
        app.restart();
    }
    exit_after_restart(app);
}

fn close_all_windows(app: &AppHandle) {
    for window in app.webview_windows().values() {
        let _ = window.destroy();
    }
}

fn exit_after_restart(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, TerminateProcess};

        let _ = app;
        unsafe {
            TerminateProcess(GetCurrentProcess(), 0);
        }
        std::process::exit(0);
    }
    #[cfg(not(target_os = "windows"))]
    {
        app.exit(0);
    }
}

#[cfg(debug_assertions)]
fn spawn_dev_restart(app: &AppHandle) -> bool {
    let project_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    let cli = project_dir
        .join("node_modules")
        .join("@tauri-apps")
        .join("cli")
        .join("tauri.js");
    if !cli.is_file() {
        write_log(
            app,
            "Cannot restart in dev mode: Tauri CLI is not installed",
        );
        return false;
    }

    let Some(node) = resolve_node() else {
        write_log(app, "Cannot restart in dev mode: node was not found");
        return false;
    };

    write_log(
        app,
        format!(
            "Restarting app in dev mode with {} dev",
            project_dir.display()
        ),
    );

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg("sleep 1; exec \"$0\" \"$1\" dev")
            .arg(&node)
            .arg(&cli)
            .current_dir(&project_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command.process_group(0);
        match command.spawn() {
            Ok(_) => true,
            Err(err) => {
                write_log(app, format!("Failed to restart app in dev mode: {err}"));
                false
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let node_path = windows_path(&node);
        let cli_path = windows_path(&cli.to_string_lossy());
        let project_path = windows_path(&project_dir.to_string_lossy());

        match Command::new(&node_path)
            .arg(&cli_path)
            .arg("dev")
            .current_dir(Path::new(&project_path))
            .spawn()
        {
            Ok(_) => true,
            Err(err) => {
                write_log(app, format!("Failed to restart app in dev mode: {err}"));
                false
            }
        }
    }

    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let _ = (app, node, cli, project_dir);
        false
    }
}

#[cfg(target_os = "windows")]
fn windows_path(value: &str) -> String {
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", rest);
    }
    let value = value.strip_prefix(r"\\?\").unwrap_or(value);

    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if bytes[0] == b'/'
            && bytes[1].is_ascii_alphabetic()
            && (value.len() == 2 || bytes[2] == b'/')
        {
            let drive = (bytes[1] as char).to_ascii_uppercase();
            let rest = &value[2..];
            return format!("{drive}:{}", rest.replace('/', "\\"));
        }
        if bytes[1] == b':' || value.starts_with("//") {
            return value.replace('/', "\\");
        }
    }

    value.to_string()
}

#[cfg(not(debug_assertions))]
fn spawn_dev_restart(_app: &AppHandle) -> bool {
    false
}

#[cfg(debug_assertions)]
fn resolve_node() -> Option<String> {
    for key in ["npm_node_execpath", "NODE"] {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() && Path::new(&value).is_file() {
                return Some(value);
            }
        }
    }

    let path = std::env::var_os("PATH")?;
    for name in ["node", "node.exe"] {
        if let Some(found) = std::env::split_paths(&path)
            .map(|dir| dir.join(name))
            .find(|candidate| candidate.is_file())
        {
            return Some(found.to_string_lossy().to_string());
        }
    }
    None
}

pub fn set_run_at_startup(app: &AppHandle, enabled: bool) {
    let executable = std::env::current_exe().unwrap_or_else(|_| PathBuf::from(APP_NAME_LC));

    #[cfg(target_os = "linux")]
    {
        let current =
            std::env::var("APPIMAGE").unwrap_or_else(|_| executable.to_string_lossy().to_string());
        let state = app.state::<AppState>();
        let changed = {
            let mut store = state.store.lock().unwrap();
            let stored = store.get_str("exec_path");
            if stored.as_deref() != Some(current.as_str()) {
                store.set_str("exec_path", &current);
                let _ = store.save();
                true
            } else {
                false
            }
        };
        if changed {
            write_log(app, "Exec path was changed.");
        }
        configure_linux_autostart(app, enabled, &current, changed);
    }

    #[cfg(target_os = "windows")]
    {
        let _ = executable;
        configure_windows_autostart(app, enabled);
    }

    #[cfg(target_os = "macos")]
    {
        configure_macos_autostart(app, enabled, &executable);
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        let _ = (app, executable, enabled);
    }
}

#[cfg(target_os = "linux")]
fn configure_linux_autostart(app: &AppHandle, enabled: bool, executable: &str, exec_changed: bool) {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let autostart_dir = home.join(".config/autostart");
    let systemd_dir = home.join(".config/systemd/user");
    let desktop_path = autostart_dir.join(format!("{APP_NAME_LC}.desktop"));
    let service_path = systemd_dir.join(format!("{APP_NAME_LC}.service"));

    if enabled {
        let appimage_exec = std::env::var("APPIMAGE").ok();
        let quoted = format!("\"{executable}\"");
        let workdir = appimage_exec
            .as_deref()
            .map(|p| {
                Path::new(p)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
            })
            .flatten()
            .or_else(|| {
                Path::new(executable)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| home.to_string_lossy().to_string());

        let shortcut_contents = format!(
            "[Desktop Entry]\n\
             Categories=Multimedia\n\
             Comment=Windows-like Ribbons Screensaver app\n\
             Exec=bash -c 'systemctl --user start {APP_NAME_LC}.service'\n\
             Name=Ribbons Screensaver\n\
             StartupWMClass=Ribbons Screensaver\n\
             Terminal=false\n\
             Type=Application\n\
             Icon={APP_NAME_LC}\n\
             X-GNOME-Autostart-Delay=10"
        );

        let systemd_contents = format!(
            "[Unit]\n\
             Description=Windows-like Ribbons Screensaver app\n\
             After=graphical-session.target\n\
             Requires=graphical-session.target\n\n\
             [Service]\n\
             Type=simple\n\
             WorkingDirectory={workdir}\n\
             ExecStart={quoted} --systemd\n\
             Environment=\"NODE_ENV=production\"\n\
             KillMode=mixed\n\
             TimeoutStopSec=10\n\n\
             [Install]\n\
             WantedBy=graphical-session.target"
        );

        if !desktop_path.exists() {
            if let Err(err) = fs::create_dir_all(&autostart_dir)
                .and_then(|_| fs::write(&desktop_path, shortcut_contents))
            {
                write_log(
                    app,
                    format!("Failed to write autostart desktop file: {err}"),
                );
            }
        }
        if !service_path.exists() || exec_changed {
            if let Err(err) = fs::create_dir_all(&systemd_dir)
                .and_then(|_| fs::write(&service_path, systemd_contents))
            {
                write_log(app, format!("Failed to write systemd service: {err}"));
            } else {
                let _ = Command::new("systemctl")
                    .args(["--user", "daemon-reload"])
                    .status();
                let _ = Command::new("systemctl")
                    .args(["--user", "enable", &format!("{APP_NAME_LC}.service")])
                    .status();
                write_log(
                    app,
                    "Application was set to autostart as user systemd service",
                );
            }
        }
    } else {
        if desktop_path.exists() {
            let _ = fs::remove_file(&desktop_path);
        }
        if service_path.exists() {
            let _ = Command::new("systemctl")
                .args(["--user", "disable", &format!("{APP_NAME_LC}.service")])
                .status();
            let _ = fs::remove_file(&service_path);
            let _ = Command::new("systemctl")
                .args(["--user", "daemon-reload"])
                .status();
            write_log(app, "Application was removed from autostart");
        }
    }
}

#[cfg(target_os = "windows")]
fn configure_windows_autostart(app: &AppHandle, enabled: bool) {
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    if enabled {
        let exe = std::env::current_exe()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let result = Command::new("reg")
            .args([
                "add",
                key,
                "/v",
                APP_NAME,
                "/t",
                "REG_SZ",
                "/d",
                &format!("\"{exe}\""),
                "/f",
            ])
            .status();
        if result.map(|s| s.success()).unwrap_or(false) {
            write_log(app, "Application was set to autostart");
        }
    } else {
        let _ = Command::new("reg")
            .args(["delete", key, "/v", APP_NAME, "/f"])
            .status();
        write_log(app, "Application was removed from autostart");
    }
}

#[cfg(target_os = "macos")]
fn configure_macos_autostart(app: &AppHandle, enabled: bool, executable: &Path) {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let launch_agents = home.join("Library/LaunchAgents");
    let label = "com.electron.ribbons-tauri";
    let plist_path = launch_agents.join(format!("{label}.plist"));
    let uid = Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .unwrap_or_else(|| "501".to_string());

    if enabled {
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>Label</key>
<string>{label}</string>
<key>ProgramArguments</key>
<array>
    <string>{}</string>
</array>
<key>RunAtLoad</key>
<true/>
<key>KeepAlive</key>
<true/>
</dict>
</plist>
"#,
            executable.to_string_lossy()
        );
        if !plist_path.exists() {
            if let Err(err) =
                fs::create_dir_all(&launch_agents).and_then(|_| fs::write(&plist_path, plist))
            {
                write_log(app, format!("Failed to write LaunchAgent: {err}"));
            } else {
                let _ = Command::new("launchctl")
                    .arg("bootstrap")
                    .arg(format!("gui/{uid}"))
                    .arg(&plist_path)
                    .status();
                write_log(app, "Application was set to autostart as service");
            }
        }
    } else if plist_path.exists() {
        let _ = Command::new("launchctl")
            .arg("bootout")
            .arg(format!("gui/{uid}/{label}"))
            .status();
        let _ = fs::remove_file(&plist_path);
        write_log(app, "Application was removed from autostart");
    }
}

fn spawn_delayed_restart(executable: &Path, args: &[String]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        #[cfg(target_os = "macos")]
        if let Some(bundle) = macos_bundle(executable) {
            let mut command = Command::new("sh");
            command
                .arg("-c")
                .arg("sleep 1; exec /usr/bin/open -n -g \"$0\" --args \"$@\"")
                .arg(bundle);
            for arg in args.iter().skip(1) {
                command.arg(arg);
            }
            command
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()?;
            return Ok(());
        }

        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg("sleep 1; exec \"$0\" \"$@\"")
            .arg(executable);
        for arg in args.iter().skip(1) {
            command.arg(arg);
        }
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        let executable_path = windows_path(&executable.to_string_lossy());
        let mut command = Command::new(&executable_path);
        for arg in args.iter().skip(1) {
            command.arg(arg);
        }
        if let Some(working_dir) = executable
            .parent()
            .map(|path| windows_path(&path.to_string_lossy()))
        {
            command.current_dir(Path::new(&working_dir));
        }
        command.spawn()?;
        Ok(())
    }
    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let _ = (executable, args);
        Err(std::io::Error::other("unsupported platform"))
    }
}

#[cfg(target_os = "macos")]
fn macos_bundle(executable: &Path) -> Option<PathBuf> {
    let macos_dir = executable.parent()?;
    let contents = macos_dir.parent()?;
    let bundle = contents.parent()?;
    if bundle.extension().and_then(|value| value.to_str()) == Some("app") {
        Some(bundle.to_path_buf())
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
pub fn bootout_macos_agent() {
    let uid = Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .unwrap_or_else(|| "501".to_string());
    let _ = Command::new("launchctl")
        .arg("bootout")
        .arg(format!("gui/{uid}/com.electron.ribbons-tauri"))
        .status();
}
