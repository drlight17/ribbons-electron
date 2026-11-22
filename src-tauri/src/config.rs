use serde_json::{Map, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const APP_NAME: &str = "Ribbons Screensaver";
pub const APP_NAME_LC: &str = "ribbons-tauri";
const LEGACY_APP_NAME: &str = "Ribbons screensaver";

pub fn is_packaged() -> bool {
    !cfg!(debug_assertions)
}

pub fn config_dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir_name = if is_packaged() {
        APP_NAME.to_string()
    } else {
        format!("{APP_NAME}-dev")
    };
    let dir = base.join(dir_name);

    // Preserve the config from the previous lowercase app name.
    if !dir.exists() {
        let legacy_name = if is_packaged() {
            LEGACY_APP_NAME.to_string()
        } else {
            format!("{LEGACY_APP_NAME}-dev")
        };
        let legacy = base.join(legacy_name);
        if legacy.is_dir() && fs::create_dir_all(&dir).is_ok() {
            for name in ["config.json", "app.log"] {
                let source = legacy.join(name);
                if source.is_file() {
                    let _ = fs::copy(source, dir.join(name));
                }
            }
        }
    }
    dir
}

pub fn ensure_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)
}

pub struct Store {
    path: PathBuf,
    data: Map<String, Value>,
}

impl Store {
    pub fn load(path: PathBuf) -> Self {
        let data = match fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<Value>(&raw) {
                Ok(Value::Object(map)) => map,
                Ok(_) => {
                    eprintln!("Config is not a JSON object, starting with defaults");
                    Map::new()
                }
                Err(err) => {
                    eprintln!("Config parse error: {err}");
                    let backup = path.with_extension("json.bak");
                    let _ = fs::rename(&path, backup);
                    Map::new()
                }
            },
            Err(_) => Map::new(),
        };
        Self { path, data }
    }

    pub fn snapshot(&self) -> Value {
        Value::Object(self.data.clone())
    }

    pub fn has(&self, key: &str) -> bool {
        self.data.contains_key(key)
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.data.get(key)
    }

    pub fn get_str(&self, key: &str) -> Option<String> {
        match self.data.get(key) {
            Some(Value::String(s)) => Some(s.clone()),
            Some(Value::Number(n)) => Some(n.to_string()),
            Some(Value::Bool(b)) => Some(b.to_string()),
            _ => None,
        }
    }

    pub fn get_bool(&self, key: &str) -> Option<bool> {
        match self.data.get(key) {
            Some(Value::Bool(b)) => Some(*b),
            Some(Value::Number(n)) => Some(n.as_i64().unwrap_or(0) != 0),
            Some(Value::String(s)) => match s.as_str() {
                "true" | "1" => Some(true),
                "false" | "0" => Some(false),
                _ => None,
            },
            _ => None,
        }
    }

    pub fn get_bool_or(&self, key: &str, fallback: bool) -> bool {
        self.get_bool(key).unwrap_or(fallback)
    }

    pub fn get_i64_or(&self, key: &str, fallback: i64) -> i64 {
        self.data
            .get(key)
            .and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_f64().map(|f| f as i64))
                    .or_else(|| v.as_str()?.parse().ok())
            })
            .unwrap_or(fallback)
    }

    pub fn get_u64_or(&self, key: &str, fallback: u64) -> u64 {
        let value = self.get_i64_or(key, fallback as i64);
        if value < 0 {
            fallback
        } else {
            value as u64
        }
    }

    pub fn get_f64_or(&self, key: &str, fallback: f64) -> f64 {
        self.data
            .get(key)
            .and_then(|v| v.as_f64().or_else(|| v.as_str()?.parse().ok()))
            .unwrap_or(fallback)
    }

    pub fn set(&mut self, key: &str, value: Value) {
        self.data.insert(key.to_string(), value);
    }

    pub fn set_str(&mut self, key: &str, value: &str) {
        self.set(key, Value::String(value.to_string()));
    }

    pub fn set_bool(&mut self, key: &str, value: bool) {
        self.set(key, Value::Bool(value));
    }

    pub fn set_map(&mut self, map: &Map<String, Value>) {
        for (key, value) in map {
            self.data.insert(key.clone(), value.clone());
        }
    }

    pub fn delete(&mut self, key: &str) -> bool {
        self.data.remove(key).is_some()
    }

    pub fn save(&self) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(&Value::Object(self.data.clone()))
            .map_err(io::Error::other)?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, raw)?;
        #[cfg(target_os = "windows")]
        if self.path.exists() {
            fs::remove_file(&self.path)?;
        }
        fs::rename(tmp, &self.path)
    }
}

pub fn init_defaults(store: &mut Store) -> bool {
    let mut changed = false;
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| APP_NAME_LC.to_string());

    macro_rules! default {
        ($key:expr, $value:expr) => {
            if store.get($key).is_none() || store.get($key) == Some(&Value::Null) {
                store.set($key, serde_json::json!($value));
                changed = true;
            }
        };
    }

    default!("engine", "modern");
    default!("backgroundMode", "auto");
    default!("opacity", 85);
    default!("glow", 26);
    default!("blur", 0);
    default!("shaftBrightness", 100);
    default!("edgeSoftness", 100);
    default!("minLength", 1);
    default!("maxLength", 6);
    default!("minWidth", 25);
    default!("maxWidth", 55);
    default!("minCurl", 0);
    default!("maxCurl", 0.15);
    default!("minTwist", 0);
    default!("maxTwist", 0);
    default!("curlAmplitude", 0.05);
    default!("endless", true);
    default!("freezeBeforeFade", true);
    default!("ui_theme", "auto");
    default!("selected_displays", "all");
    default!("hw_acc", true);
    default!("user_activity", true);
    default!("colorCycleSpeed", 3);
    default!("horizontalSpeed", "normal");
    default!("ribbonCount", 3);
    default!("idle_time", 60);
    default!("logging", false);
    default!("stretched_mode", false);
    default!("fullscreen_detect", true);

    if !store.has("run_at_startup") {
        store.set("run_at_startup", Value::Bool(false));
        changed = true;
    }

    if !store.has("media_detect") && !cfg!(target_os = "macos") {
        store.set("media_detect", Value::Bool(true));
        changed = true;
    }

    if store.get("exec_path").and_then(|v| v.as_str()).is_none() {
        store.set("exec_path", Value::String(exe));
        changed = true;
    }

    changed
}

pub fn locale_from_system() -> String {
    for key in ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"] {
        if let Ok(value) = std::env::var(key) {
            if value.is_empty() || value == "C" || value == "POSIX" {
                continue;
            }
            let first = value
                .split(':')
                .next()
                .unwrap_or(&value)
                .split(['_', '.', '@'])
                .next()
                .unwrap_or(&value)
                .to_lowercase();
            if !first.is_empty() {
                return first;
            }
        }
    }

    if let Some(locale) = sys_locale::get_locale() {
        let normalized = locale
            .split(['-', '_'])
            .next()
            .unwrap_or(&locale)
            .to_lowercase();
        if !normalized.is_empty() {
            return normalized;
        }
    }

    "en".to_string()
}
