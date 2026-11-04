//! The app's own merge and validation code, run in QuickJS.
//!
//! `desktop/dist/core.js` is the shared TypeScript package bundled by
//! `npm run build:desktop`. Running it here means the PC merges phone and
//! window edits with exactly the code the app runs, instead of a second copy
//! of the rules in Rust that could drift.
//!
//! QuickJS is not thread-safe, so one thread owns the engine and every read
//! and merge queues through it. That queue is also what serializes writes to
//! the state file.

use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;

use rquickjs::{Context, Function, Object, Runtime};
use tokio::sync::{broadcast, oneshot};

use crate::store;

const SOURCE: &str = include_str!("../../dist/core.js");
/// The phone and the window refuse documents larger than this.
pub const MAX_STATE_BYTES: usize = 1_000_000;

#[derive(Debug)]
pub struct CoreError {
    pub status: u16,
    pub message: String,
}

impl CoreError {
    pub fn new(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

enum Job {
    Read(oneshot::Sender<Result<String, CoreError>>),
    /// The JSON request body (`{ "state": ... }`) and a check that the caller is still allowed.
    Merge(
        String,
        Box<dyn Fn() -> bool + Send>,
        oneshot::Sender<Result<String, CoreError>>,
    ),
}

#[derive(Clone)]
pub struct Core {
    jobs: mpsc::Sender<Job>,
}

impl Core {
    /// `changes` hears about every write, so open windows pull right away.
    pub fn start(state_file: PathBuf, changes: broadcast::Sender<()>) -> Self {
        let (jobs, inbox) = mpsc::channel::<Job>();
        thread::Builder::new()
            .name("memoria-core".into())
            .spawn(move || run(state_file, inbox, changes))
            .expect("start the data thread");
        Self { jobs }
    }

    /// The saved document, normalized, as JSON.
    pub async fn read(&self) -> Result<String, CoreError> {
        let (reply, answer) = oneshot::channel();
        self.send(Job::Read(reply))?;
        answer.await.map_err(|_| stopped())?
    }

    /// Merges `body` (`{ "state": ... }`) into the saved document and returns the result.
    pub async fn merge(
        &self,
        body: String,
        authorized: impl Fn() -> bool + Send + 'static,
    ) -> Result<String, CoreError> {
        let (reply, answer) = oneshot::channel();
        self.send(Job::Merge(body, Box::new(authorized), reply))?;
        answer.await.map_err(|_| stopped())?
    }

    fn send(&self, job: Job) -> Result<(), CoreError> {
        self.jobs.send(job).map_err(|_| stopped())
    }
}

fn stopped() -> CoreError {
    CoreError::new(500, "The local data service stopped. Restart Memoria.")
}

fn run(state_file: PathBuf, inbox: mpsc::Receiver<Job>, changes: broadcast::Sender<()>) {
    let runtime = Runtime::new().expect("start QuickJS");
    // A 1 MB document and its parsed copies stay far below this.
    runtime.set_memory_limit(512 * 1024 * 1024);
    runtime.set_max_stack_size(4 * 1024 * 1024);
    let context = Context::full(&runtime).expect("create a QuickJS context");
    let timezone = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into());
    context.with(|ctx| {
        ctx.globals()
            .set("__memoriaTimeZone", timezone)
            .expect("set the time zone");
        // QuickJS has no Intl. The shared code only asks it for the local time
        // zone and whether a zone name is valid.
        ctx.eval::<(), _>(
            r#"globalThis.Intl = { DateTimeFormat: function () {
                 return { resolvedOptions: () => ({ timeZone: globalThis.__memoriaTimeZone }),
                          format: () => '', formatToParts: () => [] };
               } };"#,
        )
        .expect("install the time zone shim");
        ctx.eval::<(), _>(SOURCE).expect("load the shared app code");
    });

    for job in inbox {
        match job {
            Job::Read(reply) => {
                let result = store::read_raw(&state_file).and_then(|raw| call_read(&context, raw));
                let _ = reply.send(result);
            }
            Job::Merge(body, authorized, reply) => {
                let result = (|| {
                    let raw = store::read_raw(&state_file)?;
                    if !authorized() {
                        return Err(CoreError::new(
                            401,
                            "This device is no longer connected. Pair it again.",
                        ));
                    }
                    let (json, changed) = call_merge(&context, raw, body)?;
                    if json.len() > MAX_STATE_BYTES - 100 {
                        return Err(CoreError::new(
                            413,
                            "Combined data exceeds the 1 MB sync limit. Export a backup and reduce old data.",
                        ));
                    }
                    if changed {
                        store::write_atomic(&state_file, json.as_bytes())
                            .map_err(|error| CoreError::new(500, format!("The PC could not save data: {error}")))?;
                        let _ = changes.send(());
                    }
                    Ok(json)
                })();
                let _ = reply.send(result);
            }
        }
    }
}

fn exception(ctx: &rquickjs::Ctx<'_>) -> CoreError {
    let caught = ctx.catch();
    let message = caught
        .as_exception()
        .and_then(|error| error.message())
        .or_else(|| caught.as_string().and_then(|text| text.to_string().ok()))
        .unwrap_or_else(|| "The shared app code failed.".into());
    CoreError::new(500, message)
}

fn call_read(context: &Context, raw: Option<String>) -> Result<String, CoreError> {
    context.with(|ctx| {
        let core: Object = ctx.globals().get("MemoriaCore").map_err(|_| exception(&ctx))?;
        let read: Function = core.get("read").map_err(|_| exception(&ctx))?;
        read.call::<_, String>((raw,)).map_err(|_| exception(&ctx))
    })
}

fn call_merge(context: &Context, raw: Option<String>, body: String) -> Result<(String, bool), CoreError> {
    context.with(|ctx| {
        let core: Object = ctx.globals().get("MemoriaCore").map_err(|_| exception(&ctx))?;
        let merge: Function = core.get("merge").map_err(|_| exception(&ctx))?;
        let result: Object = merge.call((raw, body)).map_err(|_| exception(&ctx))?;
        let status: u16 = result.get("status").map_err(|_| exception(&ctx))?;
        if status != 200 {
            let message: String = result
                .get("error")
                .unwrap_or_else(|_| "The data could not be merged.".into());
            return Err(CoreError::new(status, message));
        }
        let json: String = result.get("json").map_err(|_| exception(&ctx))?;
        let changed: bool = result.get("changed").map_err(|_| exception(&ctx))?;
        Ok((json, changed))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("memoria-core-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("state.json")
    }

    #[tokio::test]
    async fn reads_defaults_and_merges_a_game() {
        let file = scratch("merge");
        let (changes, mut heard) = broadcast::channel(4);
        let core = Core::start(file.clone(), changes);
        let empty: serde_json::Value = serde_json::from_str(&core.read().await.unwrap()).unwrap();
        assert_eq!(empty["games"].as_array().unwrap().len(), 0);

        let mut incoming = empty.clone();
        incoming["games"] = serde_json::json!([{
            "id": "g1", "name": "Genshin Impact", "short": "GI", "color": "#88bbff", "icon": "",
            "platform": "both", "tz": "UTC", "dailyResetHour": 4, "weeklyResetDay": 1,
            "monthlyResetDay": 1, "paused": false, "sort": 0, "updatedAt": 1_700_000_000_000u64
        }]);
        let merged = core
            .merge(serde_json::json!({ "state": incoming }).to_string(), || true)
            .await
            .unwrap();
        let merged: serde_json::Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(merged["games"][0]["name"], "Genshin Impact");
        let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert_eq!(saved["games"][0]["id"], "g1");
        assert!(heard.try_recv().is_ok());
    }

    #[tokio::test]
    async fn rejects_invalid_documents_and_revoked_devices() {
        let core = Core::start(scratch("invalid"), broadcast::channel(4).0);
        let error = core
            .merge(r#"{"state":{"games":"no"}}"#.into(), || true)
            .await
            .unwrap_err();
        assert_eq!(error.status, 400);
        let error = core.merge("not json".into(), || true).await.unwrap_err();
        assert_eq!(error.status, 400);
        let state = core.read().await.unwrap();
        let error = core
            .merge(format!(r#"{{"state":{state}}}"#), || false)
            .await
            .unwrap_err();
        assert_eq!(error.status, 401);
    }
}
