//! The state document, read and merged by the shared/ rules running in QuickJS.
//!
//! One thread owns the JS runtime and the state file. Every read and merge,
//! loopback or phone, goes through its queue, so two writers never interleave.

use std::{fs, io::ErrorKind, path::PathBuf, sync::mpsc, thread, time::Duration};

use rquickjs::{Context, Function, Runtime};
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::oneshot;

/// esbuild output of native/core/entry.mjs, built by build.rs from shared/src.
const BUNDLE: &str = include_str!(concat!(env!("OUT_DIR"), "/shared-core.js"));
pub const MAX_SYNC_BYTES: usize = 1_000_000;
const MAX_STATE_FILE_BYTES: u64 = 10_000_000;
const UNREADABLE: &str = "The local state file could not be read. Restore a valid backup before syncing.";

#[derive(Debug, Clone, PartialEq)]
pub struct CoreError {
    pub status: u16,
    pub message: String,
}

impl CoreError {
    pub fn new(status: u16, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }
}

type Reply<T> = oneshot::Sender<Result<T, CoreError>>;
/// Re-checked inside the queue, right before the merge writes.
pub type Authorized = Box<dyn Fn() -> bool + Send>;

enum Job {
    Read(Reply<Value>),
    Merge { body: String, authorized: Authorized, reply: Reply<String> },
}

#[derive(Clone)]
pub struct StateCore {
    jobs: mpsc::Sender<Job>,
}

impl StateCore {
    pub fn start(state_file: PathBuf) -> Result<Self, CoreError> {
        let (jobs, queue) = mpsc::channel::<Job>();
        let (started, ready) = mpsc::channel();
        thread::Builder::new()
            .name("memoria-state".into())
            .spawn(move || {
                let engine = match Engine::new() {
                    Ok(engine) => {
                        let _ = started.send(Ok(()));
                        engine
                    }
                    Err(error) => {
                        let _ = started.send(Err(error));
                        return;
                    }
                };
                for job in queue {
                    match job {
                        Job::Read(reply) => {
                            let _ = reply.send(read(&engine, &state_file));
                        }
                        Job::Merge { body, authorized, reply } => {
                            let _ = reply.send(merge(&engine, &state_file, &body, authorized));
                        }
                    }
                }
            })
            .map_err(|e| CoreError::new(500, e.to_string()))?;
        ready.recv().map_err(|_| CoreError::new(500, "The state rules did not start."))??;
        Ok(Self { jobs })
    }

    /// The normalized document, or an empty one when there is no file yet.
    pub async fn read(&self) -> Result<Value, CoreError> {
        let (reply, answer) = oneshot::channel();
        self.send(Job::Read(reply))?;
        answer.await.map_err(|_| stopped())?
    }

    /// Merges `body` (a `{ "state": ... }` request) into the file and returns
    /// the merged document as JSON text.
    pub async fn merge(&self, body: String, authorized: Authorized) -> Result<String, CoreError> {
        let (reply, answer) = oneshot::channel();
        self.send(Job::Merge { body, authorized, reply })?;
        answer.await.map_err(|_| stopped())?
    }

    fn send(&self, job: Job) -> Result<(), CoreError> {
        self.jobs.send(job).map_err(|_| stopped())
    }
}

fn stopped() -> CoreError {
    CoreError::new(500, "The state rules stopped.")
}

struct Engine {
    _runtime: Runtime,
    context: Context,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Outcome<T> {
    Ok { ok: T },
    Failed { failed: Failure },
    Thrown { thrown: String },
}

#[derive(Deserialize)]
struct Failure {
    status: u16,
    error: String,
}

#[derive(Deserialize)]
struct Merged {
    json: String,
    changed: bool,
}

impl Engine {
    fn new() -> Result<Self, CoreError> {
        let fail = |e: rquickjs::Error| CoreError::new(500, format!("The state rules could not load: {e}"));
        let runtime = Runtime::new().map_err(fail)?;
        runtime.set_memory_limit(512 * 1024 * 1024);
        runtime.set_max_stack_size(8 * 1024 * 1024);
        let context = Context::full(&runtime).map_err(fail)?;
        let zone = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into());
        context
            .with(|ctx| -> rquickjs::Result<()> {
                ctx.globals().set("__memoriaZone", zone)?;
                ctx.eval::<(), _>(INTL_SHIM)?;
                ctx.eval::<(), _>(BUNDLE)?;
                ctx.eval::<(), _>(CALL)?;
                Ok(())
            })
            .map_err(fail)?;
        Ok(Self { _runtime: runtime, context })
    }

    /// Calls a MemoriaCore export. JSON crosses the boundary as text.
    fn call<T: for<'de> Deserialize<'de>>(&self, name: &str, args: Vec<Option<String>>) -> Result<T, CoreError> {
        let text = self
            .context
            .with(|ctx| -> rquickjs::Result<String> {
                let call: Function = ctx.globals().get("__memoriaCall")?;
                call.call((name, args))
            })
            .map_err(|e| CoreError::new(500, e.to_string()))?;
        match serde_json::from_str::<Outcome<T>>(&text) {
            Ok(Outcome::Ok { ok }) => Ok(ok),
            Ok(Outcome::Failed { failed }) => Err(CoreError::new(failed.status, failed.error)),
            Ok(Outcome::Thrown { thrown }) => Err(CoreError::new(500, thrown)),
            Err(e) => Err(CoreError::new(500, e.to_string())),
        }
    }
}

/// QuickJS has no Intl. Luxon only needs it here to name the PC's time zone,
/// which Rust supplies. Any other zone is refused, as an unknown zone would be.
const INTL_SHIM: &str = r#"
globalThis.Intl = Object.freeze({
  DateTimeFormat: function DateTimeFormat(_locale, options) {
    const zone = options && options.timeZone;
    if (zone !== undefined && zone !== globalThis.__memoriaZone) throw new RangeError('Invalid time zone: ' + zone);
    return {
      resolvedOptions: () => ({ timeZone: globalThis.__memoriaZone }),
      format: () => '',
      formatToParts: () => [],
    };
  },
});
"#;

const CALL: &str = r#"
globalThis.__memoriaCall = (name, args) => {
  try {
    const result = MemoriaCore[name](...args.map((arg) => (arg === undefined ? null : arg)));
    return JSON.stringify('status' in result ? { failed: result } : { ok: result });
  } catch (error) {
    return JSON.stringify({ thrown: String((error && error.message) || error) });
  }
};
"#;

fn read_raw(state_file: &PathBuf) -> Result<Option<String>, CoreError> {
    match fs::metadata(state_file) {
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(CoreError::new(500, UNREADABLE)),
        Ok(meta) if meta.len() > MAX_STATE_FILE_BYTES => return Err(CoreError::new(500, UNREADABLE)),
        Ok(_) => {}
    }
    let text = match fs::read_to_string(state_file) {
        Ok(text) => text,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(CoreError::new(500, UNREADABLE)),
    };
    // Same rule as JSON.parse in the Node launcher: an unparseable file is not
    // an empty one, and must never be merged over.
    serde_json::from_str::<Value>(&text).map_err(|_| CoreError::new(500, UNREADABLE))?;
    Ok(Some(text))
}

fn read(engine: &Engine, state_file: &PathBuf) -> Result<Value, CoreError> {
    let raw = read_raw(state_file)?;
    #[derive(Deserialize)]
    struct Read {
        state: Value,
    }
    Ok(engine.call::<Read>("read", vec![raw])?.state)
}

fn merge(engine: &Engine, state_file: &PathBuf, body: &str, authorized: Authorized) -> Result<String, CoreError> {
    if !authorized() {
        return Err(CoreError::new(401, "This device is no longer connected. Pair it again."));
    }
    let raw = read_raw(state_file)?;
    let merged: Merged = engine.call("merge", vec![raw, Some(body.to_owned())])?;
    if merged.json.len() > MAX_SYNC_BYTES - 100 {
        return Err(CoreError::new(
            413,
            "Combined data exceeds the 1 MB sync limit. Export a backup and reduce old data.",
        ));
    }
    if merged.changed {
        write_state(state_file, &merged.json).map_err(|e| CoreError::new(500, e.to_string()))?;
    }
    Ok(merged.json)
}

/// Temp file, then rename. Antivirus and the indexer can hold the target for a
/// moment on Windows, so the rename retries briefly.
pub fn write_state(state_file: &PathBuf, json: &str) -> std::io::Result<()> {
    if let Some(dir) = state_file.parent() {
        fs::create_dir_all(dir)?;
    }
    let temporary = state_file.with_extension("json.tmp");
    fs::write(&temporary, json)?;
    let mut attempt = 0;
    loop {
        match fs::rename(&temporary, state_file) {
            Ok(()) => return Ok(()),
            Err(error) if attempt >= 4 => return Err(error),
            Err(_) => {
                attempt += 1;
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// Replays native/core/parity.mjs cases, answered by the Node launcher's
    /// createStateAccess, through the Rust core.
    #[tokio::test]
    async fn matches_the_node_launcher() {
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let output = Command::new("node").arg("native/core/parity.mjs").current_dir(&repo).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let cases: Vec<Value> = serde_json::from_slice(&output.stdout).unwrap();
        assert!(cases.len() >= 9);
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let temp = tempfile::tempdir().unwrap();
            let file = temp.path().join("state.json");
            if let Some(raw) = case["raw"].as_str() {
                fs::write(&file, raw).unwrap();
            }
            let core = StateCore::start(file.clone()).unwrap();
            assert_eq!(core.read().await.unwrap(), case["read"], "read: {name}");
            let before = fs::read_to_string(&file).ok();
            let result = core.merge(case["body"].as_str().unwrap().to_owned(), Box::new(|| true)).await;
            let expected = &case["expected"];
            match result {
                Ok(json) => {
                    let merged: Value = serde_json::from_str(&json).unwrap();
                    assert_eq!(merged, expected["ok"], "merge: {name}");
                    let after = fs::read_to_string(&file).ok();
                    assert_eq!(after != before, expected["wrote"].as_bool().unwrap(), "write: {name}");
                }
                Err(error) => {
                    assert_eq!(
                        Some(error.status as u64),
                        expected["status"].as_u64(),
                        "status: {name} {}",
                        error.message
                    );
                    assert_eq!(error.message, expected["error"].as_str().unwrap(), "error: {name}");
                }
            }
        }
    }

    #[tokio::test]
    async fn refuses_an_unreadable_file_and_a_revoked_device() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("state.json");
        fs::write(&file, "{not json").unwrap();
        let core = StateCore::start(file.clone()).unwrap();
        assert_eq!(core.read().await.unwrap_err().message, UNREADABLE);
        let error = core.merge("{\"state\":{}}".into(), Box::new(|| false)).await.unwrap_err();
        assert_eq!(error.status, 401);
        assert_eq!(fs::read_to_string(&file).unwrap(), "{not json");
    }

    #[test]
    fn names_the_pc_time_zone() {
        let engine = Engine::new().unwrap();
        let zone: String =
            engine.context.with(|ctx| ctx.eval("Intl.DateTimeFormat().resolvedOptions().timeZone")).unwrap();
        assert_eq!(zone, iana_time_zone::get_timezone().unwrap());
    }
}
