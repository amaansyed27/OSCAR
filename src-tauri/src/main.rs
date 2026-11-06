#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use oscar_core::runtime::Runtime;
use serde_json::Value;
use std::{path::PathBuf, sync::Arc};
use tauri::{Emitter, Manager};
#[tauri::command]
async fn oscar(
    action: String,
    arg: Option<Value>,
    runtime: tauri::State<'_, Arc<Runtime>>,
) -> Result<Value, String> {
    runtime
        .action(&action, arg.unwrap_or(Value::Null))
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn open_link(url: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid link")?;
    if !["http", "https"].contains(&parsed.scheme()) {
        return Err("Only web links can be opened.".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Could not open link.".into())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = std::env::var_os("OSCAR_CONFIG_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    let cwd = std::env::current_dir().unwrap_or_default();
                    if cwd.join(".env.local").exists() || cwd.join(".env").exists() {
                        cwd
                    } else if cfg!(debug_assertions) {
                        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                            .parent()
                            .unwrap()
                            .to_owned()
                    } else {
                        std::env::current_exe()
                            .unwrap_or_default()
                            .parent()
                            .unwrap_or(&cwd)
                            .to_owned()
                    }
                });
            // Keep Electron's existing Windows data location; never create a second memory store.
            let data = std::env::var_os("OSCAR_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default()).join("oscar")
                });
            let handle = app.handle().clone();
            let runtime = Runtime::open(&root, &data.join("oscar.sqlite"), move |event| {
                let _ = handle.emit("oscar:event", event);
            })?;
            runtime.start();
            app.manage(runtime);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![oscar, open_link])
        .build(tauri::generate_context!())
        .expect("OSCAR could not open. Your local data has not been reset.")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                    let runtime = app.state::<Arc<Runtime>>().inner().clone();
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        runtime.drain().await;
                        handle.exit(0);
                    });
                }
            }
        });
}
