use std::process::Command;

pub fn resolve() -> String {
    #[cfg(target_os = "linux")]
    {
        if let Some(theme) = linux_theme() {
            return theme;
        }
    }

    #[cfg(target_os = "macos")]
    {
        return macos_theme();
    }

    #[cfg(target_os = "windows")]
    {
        return windows_theme();
    }

    #[allow(unreachable_code)]
    "dark".to_string()
}

#[cfg(target_os = "linux")]
fn linux_theme() -> Option<String> {
    let output = Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest",
            "org.freedesktop.portal.Desktop",
            "--object-path",
            "/org/freedesktop/portal/desktop",
            "--method",
            "org.freedesktop.portal.Settings.Read",
            "org.freedesktop.appearance",
            "color-scheme",
        ])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let marker = text.find("uint32")? + "uint32".len();
    let digits: String = text[marker..]
        .chars()
        .skip_while(|c| c.is_whitespace())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    match digits.parse::<u32>().ok()? {
        1 => Some("dark".to_string()),
        2 => Some("light".to_string()),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn macos_theme() -> String {
    let output = Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            if text.trim().eq_ignore_ascii_case("dark") {
                "dark".to_string()
            } else {
                "light".to_string()
            }
        }
        _ => "light".to_string(),
    }
}

#[cfg(target_os = "windows")]
fn windows_theme() -> String {
    let output = Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "/v",
            "AppsUseLightTheme",
        ])
        .output();
    if let Ok(output) = output {
        let text = String::from_utf8_lossy(&output.stdout).to_lowercase();
        if text.contains("0x0") {
            return "dark".to_string();
        }
        if text.contains("0x1") {
            return "light".to_string();
        }
    }
    "dark".to_string()
}
