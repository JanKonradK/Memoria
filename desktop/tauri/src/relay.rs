//! Device sync over the internet.
//!
//! A phone away from home cannot reach this PC directly, so it leaves its
//! sealed request in a mailbox on a small relay the owner deploys (relay/ in
//! this repository). This loop collects those requests, answers each through
//! the same routes as Wi-Fi sync, and hands the sealed reply back. The relay
//! only ever holds ciphertext: it cannot read data or forge a request, because
//! every packet is sealed to a device paired on the Wi-Fi.

use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::lan::Lan;

/// How long the relay holds a collect request open; a little under the HTTP timeout.
const COLLECT_TIMEOUT: Duration = Duration::from_secs(40);
/// One relayed request gets as long as a Wi-Fi one.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(15);
/// The second owner secret, sent beside the bearer token on every mailbox call.
const OWNER_HEADER: &str = "X-Memoria-Owner";
/// Empty collects in a row before the loop starts pausing between them.
const IDLE_AFTER: u32 = 3;
/// The pause grows by this much per further empty collect...
const IDLE_STEP: Duration = Duration::from_secs(5);
/// ...up to this. The relay counts a PC offline after 70 s without a collect
/// (PC_FRESH_MS) and a phone waits 25 s for an answer: a 25 s empty collect
/// plus this pause stays far inside the first, and a call that arrives during
/// the pause is still collected with most of the second left to answer it.
const MAX_IDLE_PAUSE: Duration = Duration::from_secs(10);
/// How often a loop with nothing to collect looks again, unless woken sooner.
const IDLE_CHECK: Duration = Duration::from_secs(30);

/// Relay URL, mailbox room, bearer token and owner secret.
type Target = (String, String, String, String);

struct Failure {
    state: &'static str,
    message: String,
}

/// The pause before the next collect after `empty` empty collects in a row.
fn idle_pause(empty: u32) -> Option<Duration> {
    empty
        .checked_sub(IDLE_AFTER - 1)
        .filter(|steps| *steps > 0)
        .map(|steps| (IDLE_STEP * steps).min(MAX_IDLE_PAUSE))
}

/// Sleeps for `duration`, or less when `lan.wake_relay()` is called. True when woken.
async fn pause(lan: &Lan, duration: Duration) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(duration) => false,
        _ = lan.relay_woken() => true,
    }
}

/// Runs for the life of the app. It idles while sync is paused, no relay is
/// set or no device is paired, and pauses between collects while the mailbox
/// stays empty. Saved data (`changes`) and Settings actions wake it at once.
pub async fn run(lan: Lan, mut changes: broadcast::Receiver<()>) {
    let Ok(client) = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Memoria relay client")
        .build()
    else {
        return;
    };
    let waker = lan.clone();
    tokio::spawn(async move {
        // Lagged still means data changed; only a closed channel ends this.
        while !matches!(changes.recv().await, Err(broadcast::error::RecvError::Closed)) {
            waker.wake_relay();
        }
    });
    let mut backoff = 1;
    let mut empty = 0u32;
    loop {
        let Some(target) = lan.relay_target() else {
            backoff = 1;
            empty = 0;
            pause(&lan, IDLE_CHECK).await;
            continue;
        };
        match collect(&client, &target).await {
            Ok(message) => {
                backoff = 1;
                lan.set_relay_status("connected", None);
                if let Some(message) = message {
                    empty = 0;
                    let (lan, client) = (lan.clone(), client.clone());
                    tokio::spawn(async move { answer(&lan, &client, &target, message).await });
                } else {
                    empty = empty.saturating_add(1);
                    if let Some(duration) = idle_pause(empty)
                        && pause(&lan, duration).await
                    {
                        empty = 0;
                    }
                }
            }
            Err(failure) => {
                lan.set_relay_status(failure.state, Some(failure.message));
                if pause(&lan, Duration::from_secs(backoff)).await {
                    // A settings change may have fixed the problem: retry promptly.
                    backoff = 1;
                } else {
                    backoff = (backoff * 2).min(60);
                }
            }
        }
    }
}

/// Waits for the next request in this PC's mailbox. None when the wait ends empty.
async fn collect(client: &reqwest::Client, (url, room, token, owner): &Target) -> Result<Option<Value>, Failure> {
    let response = client
        .get(format!("{url}/v1/rooms/{room}/next"))
        .bearer_auth(token)
        .header(OWNER_HEADER, owner)
        .timeout(COLLECT_TIMEOUT + Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| Failure {
            state: "offline",
            message: "The relay cannot be reached. Check the address and this PC's internet connection.".into(),
        })?;
    match response.status().as_u16() {
        200 => response.json::<Value>().await.map(Some).map_err(|_| Failure {
            state: "error",
            message: "The relay sent something unreadable. Deploy the relay from this version of Memoria.".into(),
        }),
        204 => Ok(None),
        403 => Err(Failure {
            state: "error",
            message: "Another PC already answers through this relay mailbox.".into(),
        }),
        404 | 405 => Err(Failure {
            state: "error",
            message: "That address is not a Memoria relay. Check it in Settings.".into(),
        }),
        _ => Err(Failure {
            state: "offline",
            message: "The relay is not answering right now. Memoria keeps trying.".into(),
        }),
    }
}

/// Runs one relayed request and posts the reply, sealed exactly as on Wi-Fi.
async fn answer(lan: &Lan, client: &reqwest::Client, (url, room, token, owner): &Target, message: Value) {
    let Some(id) = message
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
    else {
        return;
    };
    let path = message.get("path").and_then(Value::as_str).unwrap_or("");
    let body = message.get("body").cloned().unwrap_or(Value::Null);
    let (status, body) = match tokio::time::timeout(ANSWER_TIMEOUT, lan.relayed(path, body)).await {
        Ok(Ok(body)) => (200, body),
        // The same wording as a Wi-Fi reply: nothing internal leaves the PC.
        Ok(Err(error)) if error.status >= 500 => (
            error.status,
            json!({ "error": "PC sync could not save data. Check the PC and try again." }),
        ),
        Ok(Err(error)) => (error.status, json!({ "error": error.message })),
        Err(_) => (408, json!({ "error": "The request took too long." })),
    };
    let _ = client
        .post(format!("{url}/v1/rooms/{room}/reply/{id}"))
        .bearer_auth(token)
        .header(OWNER_HEADER, owner)
        .timeout(Duration::from_secs(30))
        .json(&json!({ "status": status, "body": body }))
        .send()
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_pauses_start_after_three_empty_collects_and_stay_short() {
        assert_eq!(idle_pause(0), None);
        assert_eq!(idle_pause(1), None);
        assert_eq!(idle_pause(2), None);
        assert_eq!(idle_pause(3), Some(Duration::from_secs(5)));
        assert_eq!(idle_pause(4), Some(Duration::from_secs(10)));
        assert_eq!(idle_pause(5), Some(MAX_IDLE_PAUSE));
        assert_eq!(idle_pause(u32::MAX), Some(MAX_IDLE_PAUSE));
        // A 25 s empty collect plus the longest pause keeps the PC well inside
        // the relay's 70 s freshness window.
        assert!(Duration::from_secs(25) + MAX_IDLE_PAUSE < Duration::from_secs(70));
    }
}
