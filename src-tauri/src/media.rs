use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::Arc;
#[cfg(not(target_os = "linux"))]
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::logging::write_log;
use crate::state::{now_ms, AppState};

const RMS_THRESHOLD: f64 = 0.01;

pub fn start(app: AppHandle) {
    let state = app.state::<AppState>();
    if state.audio_running.swap(true, Ordering::SeqCst) {
        return;
    }
    let enabled = state
        .store
        .lock()
        .map(|store| store.get_bool_or("media_detect", false))
        .unwrap_or(false);
    if !enabled {
        state.audio_running.store(false, Ordering::SeqCst);
        write_log(&app, "System audio detection is off");
        return;
    }
    state.audio_stop.store(false, Ordering::Relaxed);
    drop(state);

    let handle = app.clone();
    std::thread::spawn(move || {
        #[cfg(target_os = "linux")]
        run_linux(handle.clone());

        #[cfg(not(target_os = "linux"))]
        run_cpal(handle.clone());

        handle
            .state::<AppState>()
            .audio_running
            .store(false, Ordering::SeqCst);
    });
}

pub fn stop(app: &AppHandle) {
    app.state::<AppState>().stop_audio();
}

pub fn apply(app: &AppHandle) {
    let enabled = app
        .state::<AppState>()
        .store
        .lock()
        .map(|store| store.get_bool_or("media_detect", false))
        .unwrap_or(false);
    if enabled {
        start(app.clone());
    } else {
        stop(app);
    }
}

fn mark_if_loud(last_sound: &Arc<std::sync::atomic::AtomicU64>, sum: f64, count: u64) {
    if count == 0 {
        return;
    }
    let rms = (sum / count as f64).sqrt();
    if rms > RMS_THRESHOLD {
        last_sound.store(now_ms(), Ordering::Relaxed);
    }
}

#[cfg(target_os = "linux")]
fn run_linux(app: AppHandle) {
    let state = app.state::<AppState>();
    let last_sound = state.last_sound_ms.clone();
    let stop = &state.audio_stop;

    let mut child = match spawn_parec() {
        Ok(child) => child,
        Err(err) => {
            write_log(&app, format!("Failed to start system audio capture: {err}"));
            return;
        }
    };

    let mut stdout = child.stdout.take();
    *state.audio_child.lock().unwrap() = Some(child);
    write_log(&app, "System audio detection is started");

    if let Some(mut stdout) = stdout.take() {
        let mut buffer = vec![0u8; 8192];
        loop {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            match stdout.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let mut sum = 0.0f64;
                    let mut count = 0u64;
                    for chunk in buffer[..read].chunks_exact(4) {
                        let sample = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                        if sample.is_finite() {
                            sum += (sample as f64) * (sample as f64);
                            count += 1;
                        }
                    }
                    mark_if_loud(&last_sound, sum, count);
                }
                Err(err) => {
                    write_log(&app, format!("System audio capture read error: {err}"));
                    break;
                }
            }
        }
    }

    let quitting = app
        .state::<AppState>()
        .runtime
        .lock()
        .map(|runtime| runtime.quitting)
        .unwrap_or(false);
    if !stop.load(Ordering::Relaxed) && !quitting {
        write_log(&app, "System audio capture ended");
    }
    let mut child = state.audio_child.lock().unwrap().take();
    if let Some(child) = child.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
    drop(child);
}

#[cfg(target_os = "linux")]
fn spawn_parec() -> std::io::Result<std::process::Child> {
    let mut attempts = vec!["@DEFAULT_MONITOR@".to_string()];
    if let Ok(output) = Command::new("pactl").args(["get-default-sink"]).output() {
        let sink = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !sink.is_empty() {
            attempts.push(format!("{sink}.monitor"));
        }
    }

    let mut last_error = None;
    for device in attempts {
        let result = Command::new("parec")
            .args([
                "--device",
                &device,
                "--format=float32le",
                "--rate=48000",
                "--channels=2",
                "--raw",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        match result {
            Ok(child) => return Ok(child),
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| std::io::Error::other("parec is unavailable")))
}

#[cfg(not(target_os = "linux"))]
fn run_cpal(app: AppHandle) {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{Data, SampleFormat};

    let state = app.state::<AppState>();
    let last_sound = state.last_sound_ms.clone();
    let stop = &state.audio_stop;

    let host = cpal::default_host();
    let Some(device) = host.default_output_device() else {
        write_log(&app, "System audio detection: no default output device");
        return;
    };
    let supported = match device.default_output_config() {
        Ok(config) => config,
        Err(err) => {
            write_log(
                &app,
                format!("System audio detection: no output config: {err}"),
            );
            return;
        }
    };
    let sample_format = supported.sample_format();
    let config = supported.config();

    let last_for_cb = last_sound.clone();
    let callback = move |data: &Data, _info: &cpal::InputCallbackInfo| {
        let mut sum = 0.0f64;
        let mut count = 0u64;
        match sample_format {
            SampleFormat::F32 => {
                if let Some(samples) = data.as_slice::<f32>() {
                    for sample in samples {
                        sum += (*sample as f64) * (*sample as f64);
                        count += 1;
                    }
                }
            }
            SampleFormat::I16 => {
                if let Some(samples) = data.as_slice::<i16>() {
                    for sample in samples {
                        let v = *sample as f64 / 32768.0;
                        sum += v * v;
                        count += 1;
                    }
                }
            }
            SampleFormat::U16 => {
                if let Some(samples) = data.as_slice::<u16>() {
                    for sample in samples {
                        let v = (*sample as f64 - 32768.0) / 32768.0;
                        sum += v * v;
                        count += 1;
                    }
                }
            }
            SampleFormat::I32 => {
                if let Some(samples) = data.as_slice::<i32>() {
                    for sample in samples {
                        let v = *sample as f64 / 2147483648.0;
                        sum += v * v;
                        count += 1;
                    }
                }
            }
            _ => {}
        }
        mark_if_loud(&last_for_cb, sum, count);
    };

    let stream = match device.build_input_stream_raw(
        config,
        sample_format,
        callback,
        |err| eprintln!("System audio capture error: {err}"),
        None,
    ) {
        Ok(stream) => stream,
        Err(err) => {
            write_log(&app, format!("Failed to start system audio capture: {err}"));
            return;
        }
    };

    if let Err(err) = stream.play() {
        write_log(&app, format!("Failed to play audio capture stream: {err}"));
        return;
    }
    write_log(&app, "System audio detection is started");

    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(250));
    }
    drop(stream);
}
