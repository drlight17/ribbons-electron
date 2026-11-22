use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use tauri::AppHandle;

use crate::logging::write_log;
use crate::state::now_ms;

#[cfg(target_os = "linux")]
static LAST_INPUT_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(target_os = "linux")]
static STARTED: AtomicBool = AtomicBool::new(false);

/// Start the platform input monitor. Linux monitors evdev directly because
/// KWin/Wayland ScreenSaver.GetActiveTime is unreliable (returns 0 forever).
pub fn start(app: &AppHandle) {
    #[cfg(target_os = "linux")]
    start_evdev(app);
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

/// `None` means "idle time is unavailable". Callers must not treat that as 0,
/// otherwise a broken DBus backend closes the screensaver immediately.
pub fn get_idle_seconds() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        let last = LAST_INPUT_MS.load(Ordering::Relaxed);
        if last > 0 {
            return Some(now_ms().saturating_sub(last) / 1000);
        }
        return fallback_idle_seconds();
    }

    #[cfg(not(target_os = "linux"))]
    {
        user_idle::UserIdle::get_time()
            .ok()
            .map(|idle| idle.as_seconds())
    }
}

#[cfg(target_os = "linux")]
fn start_evdev(app: &AppHandle) {
    if STARTED.swap(true, Ordering::Relaxed) {
        return;
    }

    // Count input locally; the first real event is what starts the idle clock.
    let mut devices = 0usize;
    if let Ok(entries) = std::fs::read_dir("/dev/input") {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with("event") {
                continue;
            }
            let path = entry.path();
            match std::fs::File::open(&path) {
                Ok(file) => {
                    devices += 1;
                    std::thread::spawn(move || monitor_device(file));
                }
                Err(err) => {
                    write_log(
                        app,
                        format!("Cannot read input device {}: {err}", path.display()),
                    );
                }
            }
        }
    }

    if devices > 0 {
        LAST_INPUT_MS.store(now_ms(), Ordering::Relaxed);
        write_log(
            app,
            format!("Input activity monitor started on {devices} devices"),
        );
    } else {
        write_log(
            app,
            "No readable input devices. User activity detection is unavailable; add the user to the 'input' group.",
        );
    }
}

#[cfg(target_os = "linux")]
fn monitor_device(mut file: std::fs::File) {
    use std::io::Read;

    const EV_KEY: u16 = 0x01;
    const EV_REL: u16 = 0x02;
    const EV_ABS: u16 = 0x03;
    let size = std::mem::size_of::<libc::input_event>();
    let mut buffer = vec![0u8; size];

    loop {
        if file.read_exact(&mut buffer).is_err() {
            break;
        }
        let event =
            unsafe { std::ptr::read_unaligned(buffer.as_ptr() as *const libc::input_event) };
        if matches!(event.type_, EV_KEY | EV_REL | EV_ABS) {
            LAST_INPUT_MS.store(now_ms(), Ordering::Relaxed);
        }
    }
}

#[cfg(target_os = "linux")]
fn fallback_idle_seconds() -> Option<u64> {
    if let Ok(idle) = user_idle::UserIdle::get_time() {
        let seconds = idle.as_seconds();
        if seconds > 0 {
            return Some(seconds);
        }
    }

    if let Ok(output) = Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest",
            "org.freedesktop.ScreenSaver",
            "--object-path",
            "/org/freedesktop/ScreenSaver",
            "--method",
            "org.freedesktop.ScreenSaver.GetSessionIdleTime",
        ])
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        if let Some(value) = parse_uint(&text) {
            if value > 0 {
                return Some(value / 1000);
            }
        }
    }

    if let Ok(output) = Command::new("xprintidle").output() {
        let text = String::from_utf8_lossy(&output.stdout);
        if let Ok(ms) = text.trim().parse::<u64>() {
            if ms > 0 {
                return Some(ms / 1000);
            }
        }
    }

    None
}

#[cfg(target_os = "linux")]
fn parse_uint(text: &str) -> Option<u64> {
    let index = text.find("uint")?;
    let rest = &text[index + 4..];
    let digits: String = rest
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}
