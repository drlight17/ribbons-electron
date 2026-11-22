use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn ui_dir(app: &AppHandle) -> PathBuf {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.clone());
        candidates.push(resource_dir.join("resources"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.to_path_buf());
            candidates.push(exe_dir.join("resources"));
        }
    }
    if let Some(ui) = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("ui"))
    {
        candidates.push(ui);
    }
    for candidate in &candidates {
        if candidate.join("translations").is_dir() {
            return candidate.clone();
        }
    }
    candidates
        .first()
        .cloned()
        .unwrap_or_else(|| PathBuf::from("ui"))
}

pub fn resource_file(app: &AppHandle, name: &str) -> PathBuf {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.clone());
        candidates.push(resource_dir.join("resources"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.to_path_buf());
            candidates.push(exe_dir.join("resources"));
        }
    }
    candidates.push(ui_dir(app));
    for candidate in &candidates {
        let path = candidate.join(name);
        if path.exists() {
            return path;
        }
    }
    ui_dir(app).join(name)
}

pub fn translations_dir(app: &AppHandle) -> PathBuf {
    ui_dir(app).join("translations")
}

pub fn available_locales(app: &AppHandle) -> Vec<String> {
    let mut locales = Vec::new();
    if let Ok(entries) = fs::read_dir(translations_dir(app)) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    locales.push(stem.to_string());
                }
            }
        }
    }
    locales.sort();
    locales
}

pub struct I18n {
    #[allow(dead_code)]
    pub tag: String,
    map: HashMap<String, String>,
}

impl I18n {
    pub fn load(app: &AppHandle, requested: Option<&str>) -> Self {
        let locales = available_locales(app);
        let requested = requested.filter(|s| !s.is_empty());
        let mut tag = requested
            .map(|s| s.to_string())
            .or_else(|| locale_candidate(app, &locales))
            .unwrap_or_else(|| "en".to_string());

        if !locales.iter().any(|l| l == &tag) {
            tag = "en".to_string();
        }

        let path = translations_dir(app).join(format!("{tag}.json"));
        let map = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .and_then(|value| match value {
                Value::Object(obj) => Some(
                    obj.into_iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
                        .collect(),
                ),
                _ => None,
            })
            .unwrap_or_default();

        Self { tag, map }
    }

    pub fn t(&self, key: &str) -> String {
        self.map
            .get(key)
            .cloned()
            .unwrap_or_else(|| key.to_string())
    }
}

fn locale_candidate(app: &AppHandle, locales: &[String]) -> Option<String> {
    let system = crate::config::locale_from_system();
    let system = system.to_lowercase();
    if locales.iter().any(|l| l == &system) {
        return Some(system);
    }
    if let Some(short) = system.split(['-', '_']).next() {
        if locales.iter().any(|l| l == short) {
            return Some(short.to_string());
        }
    }
    // Country-code based locales (e.g. ru_RU -> ru) are already covered above.
    let _ = app;
    None
}
