#[cfg(not(target_os = "linux"))]
use tauri::AppHandle;

#[cfg(target_os = "linux")]
mod linux {
    use std::io::Cursor;
    use std::path::Path;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    use base64::Engine as _;
    use image::{DynamicImage, GenericImageView, ImageFormat, RgbImage};
    use tauri::{AppHandle, Emitter, Manager};
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::ConnectionExt;

    use crate::logging::write_log;
    use crate::state::AppState;

    pub fn prepare(app: &AppHandle) {
        let (glass, blocked) = {
            let state = app.state::<AppState>();
            let store = state.store.lock().unwrap();
            let glass = store.get_str("backgroundMode").as_deref() == Some("glass");
            let runtime = state.runtime.lock().unwrap();
            let blocked =
                runtime.modal_open() || runtime.windows.values().any(|window| window.running);
            (glass, blocked)
        };

        if !glass || blocked {
            return;
        }

        {
            let state = app.state::<AppState>();
            let mut runtime = state.runtime.lock().unwrap();
            if runtime.glass_capture_in_progress {
                return;
            }
            runtime.glass_capture_in_progress = true;
        }

        let Some(desktop) = capture_desktop(app) else {
            app.state::<AppState>()
                .runtime
                .lock()
                .unwrap()
                .glass_capture_in_progress = false;
            write_log(
                app,
                "Glass background capture failed; keeping the previous background",
            );
            return;
        };

        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let worker = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || process_desktop(&worker, desktop))
                .await;

            let running = {
                let state = app.state::<AppState>();
                let mut runtime = state.runtime.lock().unwrap();
                runtime.glass_capture_in_progress = false;
                runtime
                    .displays
                    .iter()
                    .filter(|display| {
                        runtime
                            .windows
                            .get(&display.id)
                            .map(|window| window.running)
                            .unwrap_or(false)
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            };

            for display in running {
                let background = app
                    .state::<AppState>()
                    .runtime
                    .lock()
                    .unwrap()
                    .glass_backgrounds
                    .get(&display.id)
                    .cloned();
                if let Some(window) =
                    app.get_webview_window(&crate::windows::window_label(&display.id))
                {
                    let _ = window.emit(
                        "glass-background",
                        serde_json::json!({ "background": background }),
                    );
                }
            }
        });
    }

    fn process_desktop(app: &AppHandle, desktop: DynamicImage) {
        let displays = {
            let state = app.state::<AppState>();
            let runtime = state.runtime.lock().unwrap();
            runtime.displays.clone()
        };

        let all = crate::display::all_monitors(app);
        let (min_x, min_y, max_x, max_y) = all.iter().fold(
            (
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ),
            |(min_x, min_y, max_x, max_y), display| {
                (
                    min_x.min(display.physical.x),
                    min_y.min(display.physical.y),
                    max_x.max(display.physical.x + display.physical.width),
                    max_y.max(display.physical.y + display.physical.height),
                )
            },
        );
        let virtual_width = (max_x - min_x).max(1.0);
        let virtual_height = (max_y - min_y).max(1.0);
        let scale_x = desktop.width() as f64 / virtual_width;
        let scale_y = desktop.height() as f64 / virtual_height;

        let mut backgrounds = std::collections::HashMap::new();
        for display in &displays {
            let image = if display.id == "stretched" {
                desktop.clone()
            } else {
                let x = ((display.physical.x - min_x) * scale_x).round() as i64;
                let y = ((display.physical.y - min_y) * scale_y).round() as i64;
                let width = (display.physical.width * scale_x).round().max(1.0) as u32;
                let height = (display.physical.height * scale_y).round().max(1.0) as u32;
                crop_clamped(&desktop, x, y, width, height)
            };

            if let Some(data_url) = encode_background(image, display.physical.width) {
                backgrounds.insert(display.id.clone(), data_url);
            }
        }

        if backgrounds.is_empty() {
            write_log(app, "Glass background could not be prepared");
        }
        app.state::<AppState>()
            .runtime
            .lock()
            .unwrap()
            .glass_backgrounds = backgrounds;
    }

    fn crop_clamped(image: &DynamicImage, x: i64, y: i64, width: u32, height: u32) -> DynamicImage {
        let (image_width, image_height) = image.dimensions();
        let x = x.max(0).min(image_width.saturating_sub(1) as i64) as u32;
        let y = y.max(0).min(image_height.saturating_sub(1) as i64) as u32;
        let width = width.min(image_width.saturating_sub(x)).max(1);
        let height = height.min(image_height.saturating_sub(y)).max(1);
        image.crop_imm(x, y, width, height)
    }

    fn encode_background(image: DynamicImage, physical_width: f64) -> Option<String> {
        let (width, height) = image.dimensions();
        if width == 0 || height == 0 {
            return None;
        }

        let target_width = 1920u32;
        let (resized_width, resized_height) = if width > target_width {
            let factor = target_width as f32 / width as f32;
            (
                target_width,
                ((height as f32 * factor).round() as u32).max(1),
            )
        } else {
            (width, height)
        };

        let resized = image.resize_exact(
            resized_width,
            resized_height,
            image::imageops::FilterType::CatmullRom,
        );
        let sigma_factor = resized_width as f32 / physical_width.max(1.0) as f32;
        let sigma = (20.0 * sigma_factor).max(1.0);
        let blurred = image::imageops::blur(&resized.to_rgb8(), sigma);
        let mut buffer = Vec::new();
        DynamicImage::ImageRgb8(blurred)
            .write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
            .ok()?;
        Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(buffer)
        ))
    }

    fn capture_desktop(app: &AppHandle) -> Option<DynamicImage> {
        let path = std::env::temp_dir().join(format!("ribbons-glass-{}.png", std::process::id()));
        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();

        let image = if wayland {
            capture_with_commands(&path, true)
        } else {
            capture_x11(app).or_else(|| capture_with_commands(&path, false))
        };

        let _ = std::fs::remove_file(&path);
        image
    }

    fn capture_with_commands(path: &Path, wayland: bool) -> Option<DynamicImage> {
        let path = path.to_string_lossy().to_string();
        let mut attempts: Vec<(&str, Vec<String>)> = Vec::new();

        if wayland {
            attempts.push(("grim", vec![path.clone()]));
            attempts.push((
                "spectacle",
                vec![
                    "-b".into(),
                    "-n".into(),
                    "-f".into(),
                    "-o".into(),
                    path.clone(),
                ],
            ));
            attempts.push(("gnome-screenshot", vec!["-f".into(), path.clone()]));
        } else {
            attempts.push(("maim", vec![path.clone()]));
            attempts.push(("scrot", vec![path.clone()]));
            attempts.push((
                "import",
                vec!["-window".into(), "root".into(), path.clone()],
            ));
        }

        for (program, args) in attempts {
            if !run_with_timeout(program, &args, Duration::from_secs(6)) {
                continue;
            }
            let Ok(metadata) = std::fs::metadata(path.as_str()) else {
                continue;
            };
            if metadata.len() == 0 {
                continue;
            }
            if let Ok(image) = image::open(path.as_str()) {
                return Some(image);
            }
        }
        None
    }

    fn run_with_timeout(program: &str, args: &[String], timeout: Duration) -> bool {
        let mut child = match Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(_) => return false,
        };

        let deadline = Instant::now() + timeout;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => return status.success(),
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return false;
                }
            }
        }
    }

    fn capture_x11(app: &AppHandle) -> Option<DynamicImage> {
        let (connection, screen_num) = match x11rb::connect(None) {
            Ok(value) => value,
            Err(err) => {
                write_log(app, format!("X11 screenshot connection failed: {err}"));
                return None;
            }
        };
        let screen = &connection.setup().roots[screen_num];
        let root = screen.root;
        let geometry = connection.get_geometry(root).ok()?.reply().ok()?;
        let width = geometry.width;
        let height = geometry.height;
        if width == 0 || height == 0 {
            return None;
        }

        let (image, _) = x11rb::image::Image::get(&connection, root, 0, 0, width, height).ok()?;
        let visual = screen
            .allowed_depths
            .iter()
            .flat_map(|depth| &depth.visuals)
            .find(|visual| visual.visual_id == screen.root_visual)?;

        let step = ((width as u32).div_ceil(1920)).max(1);
        let output_width = (width as u32).div_ceil(step);
        let output_height = (height as u32).div_ceil(step);
        let mut output = RgbImage::new(output_width, output_height);
        for output_y in 0..output_height {
            let y = (output_y * step) as u16;
            for output_x in 0..output_width {
                let x = (output_x * step) as u16;
                let pixel = image.get_pixel(x, y);
                output.put_pixel(
                    output_x,
                    output_y,
                    image::Rgb([
                        channel(pixel, visual.red_mask),
                        channel(pixel, visual.green_mask),
                        channel(pixel, visual.blue_mask),
                    ]),
                );
            }
        }
        Some(DynamicImage::ImageRgb8(output))
    }

    fn channel(pixel: u32, mask: u32) -> u8 {
        if mask == 0 {
            return 0;
        }
        let shift = mask.trailing_zeros();
        let max = mask >> shift;
        let value = (pixel & mask) >> shift;
        (((value as u64 * 255) + (max as u64 / 2)) / max as u64) as u8
    }
}

#[cfg(target_os = "linux")]
pub use linux::prepare;

#[cfg(not(target_os = "linux"))]
pub fn prepare(_app: &AppHandle) {}
