mod dpapi;
mod screenshot;

use tauri::Manager;

fn has_companion_image(app: &tauri::App) -> bool {
    let Ok(dir) = app.path().app_data_dir() else {
        return false;
    };
    let Ok(raw) = std::fs::read_to_string(dir.join("settings.json")) else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    json.pointer("/settings/images/companion")
        .and_then(|value| value.as_str())
        .is_some_and(|name| !name.is_empty())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            dpapi::dpapi_protect,
            dpapi::dpapi_unprotect,
            screenshot::capture_screenshot
        ])
        .setup(|app| {
            let label = if has_companion_image(app) {
                "companion"
            } else {
                "onboarding"
            };
            if let Some(window) = app.get_webview_window(label) {
                window.show()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
