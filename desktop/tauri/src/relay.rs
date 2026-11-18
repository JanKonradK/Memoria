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

use crate::lan::Lan;

/// How long the relay holds a collect request open; a little under the HTTP timeout.
const COLLECT_TIMEOUT: Duration = Duration::from_secs(40);
/// One relayed request gets as long as a Wi-Fi one.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(15);

type Target = (String, String, String);

struct Failure {
    state: &'static str,
    message: String,
}

/// Runs for the life of the app. It idles while sync is paused or no relay is set.
pub async fn run(lan: Lan) {
    let Ok(client) = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Memoria relay client")
        .build()
    else {
        return;
    };
    let mut backoff = 1;
    loop {
        let Some(target) = lan.relay_target() else {
            backoff = 1;
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue;
        };
        match collect(&client, &target).await {
            Ok(message) => {
                backoff = 1;
                lan.set_relay_status("connected", None);
                if let Some(message) = message {
                    let (lan, client) = (lan.clone(), client.clone());
                    tokio::spawn(async move { answer(&lan, &client, &target, message).await });
                }
            }
            Err(failure) => {
                lan.set_relay_status(failure.state, Some(failure.message));
                tokio::time::sleep(Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(60);
            }
        }
    }
}

/// Waits for the next request in this PC's mailbox. None when the wait ends empty.
async fn collect(client: &reqwest::Client, (url, room, token): &Target) -> Result<Option<Value>, Failure> {
    let response = client
        .get(format!("{url}/v1/rooms/{room}/next"))
        .bearer_auth(token)
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
async fn answer(lan: &Lan, client: &reqwest::Client, (url, room, token): &Target, message: Value) {
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
        .timeout(Duration::from_secs(30))
        .json(&json!({ "status": status, "body": body }))
        .send()
        .await;
}
