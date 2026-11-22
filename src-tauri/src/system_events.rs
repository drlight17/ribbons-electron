use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Manager};

use crate::logging::write_log;
use crate::state::AppState;

pub fn start(app: AppHandle) {
    spawn_watchdog(app.clone());

    #[cfg(target_os = "linux")]
    {
        let lock_app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = listen_lock_linux(lock_app.clone()).await {
                write_log(&lock_app, format!("Screen lock listener failed: {err}"));
            }
        });

        let suspend_app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = listen_suspend_linux(suspend_app.clone()).await {
                write_log(&suspend_app, format!("Suspend listener failed: {err}"));
            }
        });
    }
}

fn spawn_watchdog(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_mono = Instant::now();
        let mut last_wall = SystemTime::now();
        #[cfg(not(target_os = "linux"))]
        let mut last_locked = false;

        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;

            let wall_elapsed = last_wall.elapsed().map(|d| d.as_secs()).unwrap_or(0) as i64;
            let mono_elapsed = last_mono.elapsed().as_secs() as i64;
            if wall_elapsed - mono_elapsed > 10 {
                let state = app.state::<AppState>();
                state.set_locked(false);
                write_log(
                    &app,
                    "The system was resumed. Restarting app to prevent issues.",
                );
                crate::autostart::restart_app(&app);
            }
            last_mono = Instant::now();
            last_wall = SystemTime::now();

            #[cfg(not(target_os = "linux"))]
            {
                let locked = is_screen_locked();
                if locked != last_locked {
                    last_locked = locked;
                    let state = app.state::<AppState>();
                    state.set_locked(locked);
                    if locked {
                        write_log(&app, "The screen is locked");
                    } else {
                        write_log(&app, "The screen is unlocked");
                        write_log(&app, "Restart app to prevents issues.");
                        crate::autostart::restart_app(&app);
                    }
                }
            }
        }
    });
}

#[cfg(target_os = "linux")]
async fn listen_lock_linux(app: AppHandle) -> zbus::Result<()> {
    use futures_util::StreamExt;

    let connection = zbus::Connection::session().await?;
    let proxy = zbus::Proxy::new(
        &connection,
        "org.freedesktop.ScreenSaver",
        "/org/freedesktop/ScreenSaver",
        "org.freedesktop.ScreenSaver",
    )
    .await?;
    let mut signals = proxy.receive_signal("ActiveChanged").await?;

    while let Some(message) = signals.next().await {
        let Ok(active) = message.body().deserialize::<bool>() else {
            continue;
        };
        let state = app.state::<AppState>();
        state.set_locked(active);
        if active {
            write_log(&app, "The screen is locked");
        } else {
            write_log(&app, "The screen is unlocked");
            write_log(&app, "Restart app to prevents issues.");
            crate::autostart::restart_app(&app);
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
async fn listen_suspend_linux(app: AppHandle) -> zbus::Result<()> {
    use futures_util::StreamExt;

    let connection = zbus::Connection::system().await?;
    let proxy = zbus::Proxy::new(
        &connection,
        "org.freedesktop.login1",
        "/org/freedesktop/login1",
        "org.freedesktop.login1.Manager",
    )
    .await?;
    let mut signals = proxy.receive_signal("PrepareForSleep").await?;

    while let Some(message) = signals.next().await {
        let Ok(starting) = message.body().deserialize::<bool>() else {
            continue;
        };
        let state = app.state::<AppState>();
        if starting {
            state.set_locked(true);
            write_log(&app, "The system is suspended");
        } else {
            state.set_locked(false);
            write_log(&app, "The system is released");
            write_log(&app, "Restart app to prevents issues.");
            crate::autostart::restart_app(&app);
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn is_screen_locked() -> bool {
    use windows_sys::Win32::System::StationsAndDesktops::{
        CloseDesktop, OpenInputDesktop, DESKTOP_READOBJECTS, DESKTOP_SWITCHDESKTOP,
    };

    unsafe {
        let handle = OpenInputDesktop(0, 0, DESKTOP_READOBJECTS | DESKTOP_SWITCHDESKTOP);
        if handle.is_null() {
            true
        } else {
            let _ = CloseDesktop(handle);
            false
        }
    }
}

#[cfg(target_os = "macos")]
fn is_screen_locked() -> bool {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::CFString;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGSessionCopyCurrentDictionary() -> CFDictionaryRef;
    }

    unsafe {
        let dictionary_ref = CGSessionCopyCurrentDictionary();
        if dictionary_ref.is_null() {
            return false;
        }
        let dictionary: CFDictionary<CFString, CFType> =
            CFDictionary::wrap_under_create_rule(dictionary_ref);
        if let Some(value) = dictionary.find(&CFString::new("CGSSessionScreenIsLocked")) {
            if let Some(flag) = value.downcast::<CFBoolean>() {
                return bool::from(flag);
            }
        }
    }
    false
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn is_screen_locked() -> bool {
    false
}
