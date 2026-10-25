// Release builds are GUI programs: no console window behind Memoria.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core;
mod desktop;
mod lan;
mod launch;
mod paths;
mod policy;
mod server;
mod update;

use std::sync::Arc;

use tauri::{Manager, RunEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::{core::StateCore, paths::Paths, server::Started};

fn prepare() -> Result<(Paths, StateCore), String> {
    let paths = Paths::resolve().map_err(|e| e.to_string())?;
    if let Some(app_data) = paths.data.parent() {
        paths::migrate_legacy_data(app_data, &paths.data).map_err(|e| e.to_string())?;
    }
    let core = StateCore::start(paths.state.clone()).map_err(|e| e.message)?;
    Ok((paths, core))
}

/// `--headless` serves the launcher and prints the launch URL, with no window.
/// The launcher contract tests drive the server this way.
fn headless() -> Result<(), String> {
    let (paths, core) = prepare()?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime.block_on(async {
        let url = match server::start(paths, core).await? {
            Started::Owned { url } | Started::Reused { url } => url,
        };
        println!("{url}");
        std::future::pending::<()>().await;
        Ok(())
    })
}

fn main() {
    if std::env::args().any(|arg| arg == "--headless") {
        if let Err(error) = headless() {
            eprintln!("Memoria: {error}");
            std::process::exit(1);
        }
        return;
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| desktop::second_instance(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            desktop::renderer_ready,
            desktop::close_result,
            desktop::request_quit,
            desktop::toggle_menu,
            desktop::launch_list,
            desktop::launch_choose,
            desktop::launch_clear,
            desktop::launch_start,
            desktop::update_check,
            desktop::update_download,
            desktop::update_install
        ])
        .on_menu_event(desktop::menu_handler)
        .setup(|app| {
            let handle = app.handle().clone();
            let started = prepare().and_then(|(paths, core)| {
                let started = tauri::async_runtime::block_on(server::start(paths.clone(), core))?;
                Ok((paths, started))
            });
            let result = started.and_then(|(paths, started)| {
                let url = match started {
                    Started::Owned { url } | Started::Reused { url } => url,
                };
                let origin = policy::launch_origin(&url).ok_or("The local data service gave an unexpected address.")?;
                app.manage(desktop::Host::new(paths, origin)?);
                let url = url.parse().map_err(|e: url::ParseError| e.to_string())?;
                desktop::create_window(&handle, url).map_err(|e| e.to_string())
            });
            if let Err(error) = result {
                handle
                    .dialog()
                    .message(error)
                    .title("Memoria could not start")
                    .kind(MessageDialogKind::Error)
                    .buttons(MessageDialogButtons::Ok)
                    .blocking_show();
                handle.exit(1);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Memoria could not start its window");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { api, code: None, .. } = event
            && !desktop::is_quitting(app)
            && app.try_state::<Arc<desktop::Host>>().is_some()
        {
            // Closing the last window still goes through the save handshake.
            api.prevent_exit();
            desktop::request_close(app);
        }
    });
}
