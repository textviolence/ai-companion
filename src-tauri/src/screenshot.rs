use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use image::{imageops::FilterType, DynamicImage, ImageFormat};
use std::io::Cursor;
use xcap::Monitor;

const MAX_SIDE: u32 = 1280;

#[tauri::command]
pub fn capture_screenshot() -> Result<String, String> {
    let monitors = Monitor::all().map_err(|err| format!("Monitor::all: {err}"))?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or("no monitors found")?;

    let rgba = monitor
        .capture_image()
        .map_err(|err| format!("capture_image: {err}"))?;
    let image = DynamicImage::ImageRgba8(rgba);

    let longest = image.width().max(image.height());
    let scaled = if longest > MAX_SIDE {
        image.resize(MAX_SIDE, MAX_SIDE, FilterType::Lanczos3)
    } else {
        image
    };

    let mut buffer = Cursor::new(Vec::new());
    scaled
        .write_to(&mut buffer, ImageFormat::Png)
        .map_err(|err| format!("png encode: {err}"))?;

    Ok(format!(
        "data:image/png;base64,{}",
        BASE64.encode(buffer.into_inner())
    ))
}
