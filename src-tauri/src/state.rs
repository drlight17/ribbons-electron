use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::config::{self, Store};
use crate::i18n::I18n;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone)]
pub struct DisplayInfo {
    pub id: String,
    pub label: String,
    pub index: usize,
    pub bounds: Bounds,
    pub physical: Bounds,
    pub src_bounds: Option<Vec<Bounds>>,
}

#[derive(Debug, Default, Clone)]
pub struct WindowState {
    pub running: bool,
    pub paused: bool,
    pub renderer_ready: bool,
    pub close_allowed_at: u64,
    pub last_close_sent: u64,
}

#[derive(Debug, Default)]
pub struct Runtime {
    pub displays: Vec<DisplayInfo>,
    pub windows: HashMap<String, WindowState>,
    pub settings_open: bool,
    pub about_open: bool,
    pub update_open: bool,
    pub dialog_count: u32,
    pub blocked_icon: bool,
    pub quitting: bool,
    pub update_available: bool,
    pub latest_version: Option<String>,
    pub release_url: Option<String>,
    pub idle_secs: u64,
    pub display_signature: String,
    pub glass_backgrounds: HashMap<String, String>,
    pub glass_capture_in_progress: bool,
}

impl Runtime {
    pub fn modal_open(&self) -> bool {
        self.settings_open || self.about_open || self.update_open || self.dialog_count > 0
    }
}

pub struct AppState {
    pub config_dir: PathBuf,
    pub log_path: PathBuf,
    pub store: Mutex<Store>,
    pub i18n: Mutex<I18n>,
    pub system_theme: Mutex<String>,
    pub runtime: Mutex<Runtime>,
    pub last_sound_ms: Arc<AtomicU64>,
    pub audio_stop: AtomicBool,
    pub audio_running: AtomicBool,
    pub audio_child: Mutex<Option<std::process::Child>>,
    pub locked: AtomicBool,
}

impl AppState {
    pub fn new(config_dir: PathBuf, store: Store, i18n: I18n) -> Self {
        config::ensure_dir(&config_dir).ok();
        let log_path = config_dir.join("app.log");
        Self {
            config_dir,
            log_path,
            store: Mutex::new(store),
            i18n: Mutex::new(i18n),
            system_theme: Mutex::new("dark".to_string()),
            runtime: Mutex::new(Runtime::default()),
            last_sound_ms: Arc::new(AtomicU64::new(0)),
            audio_stop: AtomicBool::new(false),
            audio_running: AtomicBool::new(false),
            audio_child: Mutex::new(None),
            locked: AtomicBool::new(false),
        }
    }

    pub fn sound_within(&self, timeout_secs: u64) -> bool {
        let last = self.last_sound_ms.load(Ordering::Relaxed);
        if last == 0 {
            return false;
        }
        now_ms().saturating_sub(last) < timeout_secs.saturating_mul(1000)
    }

    pub fn is_locked(&self) -> bool {
        self.locked.load(Ordering::Relaxed)
    }

    pub fn set_locked(&self, value: bool) {
        self.locked.store(value, Ordering::Relaxed);
    }

    pub fn stop_audio(&self) {
        self.audio_stop.store(true, Ordering::Relaxed);
        let mut child = self.audio_child.lock().unwrap().take();
        if let Some(child) = child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        drop(child);
        self.audio_running.store(false, Ordering::SeqCst);
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}
