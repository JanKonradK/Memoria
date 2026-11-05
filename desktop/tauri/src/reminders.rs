//! Device-local scheduling. The shared planner owns all game and quiet-hour rules.
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tokio::sync::{broadcast, watch};

use crate::{core::Core, store};

const MINUTE: i64 = 60_000;
const HORIZON: i64 = 24 * 60 * MINUTE;
const STALE: i64 = 5 * MINUTE;
const KEEP_FIRED: i64 = 7 * HORIZON;

#[derive(Clone, Debug, Deserialize)]
pub struct Notice {
    pub id: u32,
    pub title: String,
    pub body: String,
    pub at: i64,
}

/// Both clocks are supplied by the caller, so sleep and clock changes are testable.
#[derive(Clone, Copy)]
struct Clock {
    wall: i64,
    monotonic: Duration,
}

#[derive(Default)]
struct Schedule {
    plan: Vec<Notice>,
    fired: HashMap<u32, i64>,
    horizon: i64,
    last_clock: Option<Clock>,
}

impl Schedule {
    fn clock_changed(&mut self, now: Clock) -> bool {
        let previous = self.last_clock.replace(now);
        previous.is_some_and(|previous| {
            let elapsed = now.monotonic.saturating_sub(previous.monotonic).as_millis() as i64;
            let wall_elapsed = now.wall - previous.wall;
            // Some Windows clocks both include sleep. A missed 60-second tick
            // also means wake, even when the two clocks did not drift apart.
            (wall_elapsed - elapsed).abs() > 30_000 || elapsed > 90_000
        })
    }

    fn replace(&mut self, plan: Vec<Notice>, now: i64) {
        self.plan = plan;
        self.horizon = now + HORIZON;
    }

    fn take_due(&mut self, now: i64) -> Vec<Notice> {
        self.fired.retain(|_, fired_at| *fired_at >= now - KEEP_FIRED);
        let mut due = Vec::new();
        self.plan.retain(|notice| {
            if notice.at > now {
                return true;
            }
            if notice.at >= now - STALE && !self.fired.contains_key(&notice.id) {
                self.fired.insert(notice.id, now);
                due.push(notice.clone());
            }
            false
        });
        due
    }

    fn wait(&self, now: i64) -> Duration {
        let next = self.plan.iter().map(|notice| notice.at).min().unwrap_or(self.horizon);
        Duration::from_millis((next.min(self.horizon) - now).clamp(1, MINUTE) as u64)
    }
}

pub fn start(
    core: Core,
    mut changes: broadcast::Receiver<()>,
    mut enabled: watch::Receiver<bool>,
    data: PathBuf,
    show: impl Fn(Notice) + Send + 'static,
) {
    tauri::async_runtime::spawn(async move {
        let fired_file = data.join("desktop-reminders.json");
        let mut schedule = Schedule {
            fired: store::read_json(&fired_file)
                .and_then(|value| serde_json::from_value(value).ok())
                .unwrap_or_default(),
            ..Schedule::default()
        };
        let started = Instant::now();
        let mut rebuild = true;
        loop {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
            let clock_changed = schedule.clock_changed(Clock { wall: now, monotonic: started.elapsed() });
            let on = *enabled.borrow_and_update();
            if on {
                // Data changes replace pending work before delivery, so deleted
                // reminders and new quiet hours take effect immediately.
                if rebuild {
                    match core.notification_plan(now).await {
                        Ok(plan) => schedule.replace(plan, now),
                        Err(error) => {
                            eprintln!("Reminder planning failed: {}", error.message);
                            schedule.plan.clear();
                            schedule.horizon = now + MINUTE;
                        }
                    }
                }
                let pending = schedule.plan.len();
                let due = schedule.take_due(now);
                let consumed = pending != schedule.plan.len();
                if !due.is_empty() && *enabled.borrow() {
                    // Record before showing, so even a restart during delivery
                    // cannot repeat the same toast. Keep this file off sync.
                    let saved = store::write_json(&fired_file, &serde_json::json!(schedule.fired));
                    if let Err(error) = saved {
                        eprintln!("Reminder delivery skipped: {error}");
                    } else {
                        for notice in due {
                            if !*enabled.borrow() {
                                break;
                            }
                            show(notice);
                        }
                    }
                }
                // Deliver recent due work before a wake rebuild drops past
                // entries. Refill after delivery too: plans have a 32-item limit.
                rebuild = clock_changed || now >= schedule.horizon || consumed;
                if rebuild {
                    continue;
                }
            } else {
                schedule.plan.clear();
                rebuild = true;
            }
            let wait = if on { schedule.wait(now) } else { Duration::from_secs(60) };
            tokio::select! {
                _ = tokio::time::sleep(wait) => {},
                change = changes.recv() => {
                    if matches!(change, Err(broadcast::error::RecvError::Closed)) { break; }
                    // Lagged means at least one save occurred, so rebuild too.
                    rebuild = true;
                },
                preference = enabled.changed() => {
                    if preference.is_err() { break; }
                    rebuild = true;
                },
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notice(id: u32, at: i64) -> Notice {
        Notice { id, at, title: "Memoria".into(), body: "Reminder".into() }
    }

    #[test]
    fn selects_due_once_and_keeps_future_work() {
        let mut schedule = Schedule::default();
        schedule.replace(vec![notice(1, 1000), notice(2, 2000)], 0);
        assert!(schedule.take_due(999).is_empty());
        assert_eq!(schedule.take_due(1000)[0].id, 1);
        assert_eq!(schedule.wait(1000), Duration::from_millis(1000));
        assert!(schedule.take_due(1000).is_empty());
        assert_eq!(schedule.take_due(2000)[0].id, 2);
    }

    #[test]
    fn deduplicates_after_rebuild_and_restart() {
        let mut schedule = Schedule::default();
        schedule.replace(vec![notice(1, 1000), notice(1, 1000)], 0);
        assert_eq!(schedule.take_due(1000).len(), 1);
        let saved = serde_json::to_string(&schedule.fired).unwrap();
        let mut restarted = Schedule { fired: serde_json::from_str(&saved).unwrap(), ..Schedule::default() };
        restarted.replace(vec![notice(1, 1000)], 1000);
        assert!(restarted.take_due(1001).is_empty());
        assert_eq!(restarted.fired.len(), 1);
        restarted.take_due(1001 + KEEP_FIRED);
        assert!(restarted.fired.is_empty());
    }

    #[test]
    fn skips_stale_work_after_sleep_but_delivers_recent_work() {
        let mut schedule = Schedule::default();
        schedule.replace(vec![notice(1, 1000), notice(2, 1001), notice(3, 300_000)], 0);
        let due = schedule.take_due(1001 + STALE);
        assert_eq!(due.iter().map(|notice| notice.id).collect::<Vec<_>>(), vec![2, 3]);
        assert!(schedule.plan.is_empty());
        assert!(!schedule.fired.contains_key(&1));
    }

    #[test]
    fn detects_forward_backward_clock_jumps_and_sleep() {
        let mut schedule = Schedule::default();
        let clock = |wall, seconds| Clock { wall, monotonic: Duration::from_secs(seconds) };
        assert!(!schedule.clock_changed(clock(0, 0)));
        assert!(!schedule.clock_changed(clock(60_000, 60)));
        assert!(schedule.clock_changed(clock(3_720_000, 120)));
        assert!(schedule.clock_changed(clock(180_000, 180)));
        assert!(schedule.clock_changed(clock(3_780_000, 3780)));
        assert!(!schedule.clock_changed(clock(3_840_000, 3840)));
    }

    #[test]
    fn replaces_cancelled_work_and_expires_the_horizon_even_for_an_empty_plan() {
        let mut schedule = Schedule::default();
        schedule.replace(vec![notice(1, 1000)], 0);
        schedule.replace(vec![], 500);
        assert!(schedule.take_due(1000).is_empty());
        assert_eq!(schedule.horizon, 500 + HORIZON);
        assert_eq!(schedule.wait(schedule.horizon - 10), Duration::from_millis(10));
        assert_eq!(schedule.wait(500), Duration::from_secs(60));
    }
}
