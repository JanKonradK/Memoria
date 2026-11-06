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
/// Matches MAX_SYNC_BYTES in shared/src/types.ts.
pub const MAX_STATE_BYTES: usize = 8_000_000;

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
    NotificationPlan(i64, oneshot::Sender<Result<String, CoreError>>),
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

    pub async fn notification_plan(&self, now: i64) -> Result<Vec<crate::reminders::Notice>, CoreError> {
        let (reply, answer) = oneshot::channel();
        self.send(Job::NotificationPlan(now, reply))?;
        let json = answer.await.map_err(|_| stopped())??;
        serde_json::from_str(&json).map_err(|_| CoreError::new(500, "The reminder plan could not be read."))
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
    // An 8 MB document and its parsed copies stay far below this.
    runtime.set_memory_limit(512 * 1024 * 1024);
    runtime.set_max_stack_size(4 * 1024 * 1024);
    let context = Context::full(&runtime).expect("create a QuickJS context");
    let timezone = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into());
    context.with(|ctx| {
        ctx.globals()
            .set("__memoriaTimeZone", timezone)
            .expect("set the time zone");
        // QuickJS has no Intl. Supply the IANA offsets Luxon needs for game
        // resets and quiet hours. Jiff already ships with the Windows dependency tree.
        ctx.globals()
            .set(
                "__memoriaZoneOffset",
                Function::new(ctx.clone(), |zone: String, at: f64| {
                    let zone = jiff::tz::TimeZone::get(&zone).ok()?;
                    let at = jiff::Timestamp::from_millisecond(at as i64).ok()?;
                    Some(zone.to_offset(at).seconds())
                })
                .expect("create the time zone bridge"),
            )
            .expect("set the time zone bridge");
        ctx.eval::<(), _>(include_str!("intl.js"))
            .expect("install the time zone shim");
        ctx.eval::<(), _>(SOURCE).expect("load the shared app code");
    });

    for job in inbox {
        match job {
            Job::Read(reply) => {
                let result = store::read_raw(&state_file).and_then(|raw| call_read(&context, raw));
                let _ = reply.send(result);
            }
            Job::NotificationPlan(now, reply) => {
                let result = store::read_raw(&state_file).and_then(|raw| {
                    context.with(|ctx| {
                        let core: Object = ctx.globals().get("MemoriaCore").map_err(|_| exception(&ctx))?;
                        let plan: Function = core.get("notificationPlan").map_err(|_| exception(&ctx))?;
                        plan.call::<_, String>((raw, now as f64)).map_err(|_| exception(&ctx))
                    })
                });
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
                    let outgoing = call_read(&context, Some(json.clone()))?;
                    if outgoing.len() > MAX_STATE_BYTES - 100 {
                        return Err(CoreError::new(
                            413,
                            "Combined data exceeds the 8 MB sync limit. Export a backup and reduce old data.",
                        ));
                    }
                    if changed {
                        store::write_atomic(&state_file, json.as_bytes())
                            .map_err(|error| CoreError::new(500, format!("The PC could not save data: {error}")))?;
                        let _ = changes.send(());
                    }
                    Ok(outgoing)
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
            .merge(r#"{"state":{"schemaVersion":10,"games":"no"}}"#.into(), || true)
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

    #[tokio::test]
    async fn plans_reminders_and_energy_from_disk_with_real_quiet_hours() {
        let file = scratch("reminders");
        let core = Core::start(file.clone(), broadcast::channel(4).0);
        let now = 1_791_288_000_000i64; // 2026-10-06 12:00 UTC
        assert!(core.notification_plan(now).await.unwrap().is_empty());
        let mut state: serde_json::Value = serde_json::from_str(&core.read().await.unwrap()).unwrap();
        state["settings"] = serde_json::json!({
            "quietStart": null, "quietEnd": null, "localTz": "UTC", "sleepHours": 8, "updatedAt": 1
        });
        state["games"] = serde_json::json!([{
            "id": "g1", "name": "Test", "short": "T", "color": "#88bbff", "icon": "",
            "platform": "both", "tz": "Asia/Tokyo", "dailyResetHour": 4, "weeklyResetDay": 1,
            "monthlyResetDay": 1, "paused": false, "sort": 0, "updatedAt": 1
        }]);
        state["resources"] = serde_json::json!([{
            "id": "r1", "gameId": "g1", "name": "Energy", "cap": 100, "regenMinutes": 6,
            "reserveCap": 0, "sort": 0, "updatedAt": 1
        }]);
        state["snapshots"] = serde_json::json!([{
            "id": "s1", "resourceId": "r1", "value": 80, "takenAt": now
        }]);
        state["reminders"] = serde_json::json!([{
            "id": "reminder", "gameId": null, "message": "Check in", "at": now + 3_600_000, "updatedAt": 1
        }]);
        store::write_json(&file, &state).unwrap();
        let plan = core.notification_plan(now).await.unwrap();
        assert_eq!(plan.len(), 2);
        assert_eq!(plan[0].body, "Check in");
        assert_eq!(plan[1].at, now + 90 * 60_000);

        state["settings"]["quietStart"] = serde_json::json!(21 * 60);
        state["settings"]["quietEnd"] = serde_json::json!(7 * 60);
        state["settings"]["localTz"] = serde_json::json!("Asia/Tokyo");
        store::write_json(&file, &state).unwrap();
        assert!(core.notification_plan(now).await.unwrap().is_empty());
        state["settings"]["localTz"] = serde_json::json!("UTC");
        store::write_json(&file, &state).unwrap();
        assert_eq!(core.notification_plan(now).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn plans_game_resets_across_both_dst_transitions() {
        let file = scratch("reminder-dst");
        let core = Core::start(file.clone(), broadcast::channel(4).0);
        let mut state: serde_json::Value = serde_json::from_str(&core.read().await.unwrap()).unwrap();
        state["settings"] = serde_json::json!({
            "quietStart": null, "quietEnd": null, "localTz": "UTC", "sleepHours": 8, "updatedAt": 1
        });
        state["games"] = serde_json::json!([{
            "id": "g1", "name": "Test", "short": "T", "color": "#88bbff", "icon": "",
            "platform": "both", "tz": "America/New_York", "dailyResetHour": 4, "weeklyResetDay": 1,
            "monthlyResetDay": 1, "paused": false, "sort": 0, "updatedAt": 1
        }]);
        state["tasks"] = serde_json::json!([{
            "id": "t1", "gameId": "g1", "name": "Dailies", "cadence": "daily",
            "intervalDays": 1, "anchorAt": 0, "sort": 0, "updatedAt": 1
        }]);
        store::write_json(&file, &state).unwrap();
        for (now, expected) in [
            ("2026-03-08T05:00:00Z", "2026-03-08T07:30:00Z"),
            ("2026-11-01T04:00:00Z", "2026-11-01T08:30:00Z"),
        ] {
            let millis = |text: &str| text.parse::<jiff::Timestamp>().unwrap().as_millisecond();
            let plan = core.notification_plan(millis(now)).await.unwrap();
            assert_eq!(plan.len(), 1);
            assert_eq!(plan[0].at, millis(expected));
        }
    }
}
