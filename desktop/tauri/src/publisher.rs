//! Exact-byte Ed25519 envelopes, with separate domains and durable replay stamps.
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

#[cfg(not(test))]
pub const KEY: &str = "7dd4999088b64d4f5a446440f4ba6f2581154b11d9d3dc991ccf45e130e9a9c6";
pub const RELEASE: &str = "memoria-release-v1";
pub fn verify(envelope: &Value, context: &str, previous: Option<&Value>) -> Result<(Value, Value), String> {
    #[cfg(not(test))]
    let key = KEY.to_string();
    #[cfg(test)]
    let key = hex::encode(
        ed25519_dalek::SigningKey::from_bytes(&[42; 32])
            .verifying_key()
            .to_bytes(),
    );
    verify_key(envelope, context, previous, &key)
}
fn verify_key(envelope: &Value, context: &str, previous: Option<&Value>, key: &str) -> Result<(Value, Value), String> {
    let invalid = || "Publisher signature is missing or invalid. No update was installed.".to_string();
    let payload = envelope["payload"]
        .as_str()
        .filter(|p| p.len() <= 2_000_000)
        .ok_or_else(invalid)?;
    let bytes = STANDARD.decode(payload).map_err(|_| invalid())?;
    let key: [u8; 32] = hex::decode(key)
        .map_err(|_| invalid())?
        .try_into()
        .map_err(|_| invalid())?;
    let key = VerifyingKey::from_bytes(&key).map_err(|_| invalid())?;
    let signature = hex::decode(envelope["signature"].as_str().ok_or_else(invalid)?).map_err(|_| invalid())?;
    let signature = Signature::from_slice(&signature).map_err(|_| invalid())?;
    key.verify_strict(&bytes, &signature).map_err(|_| invalid())?;
    let signed: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    let sequence = signed["sequence"].as_u64().ok_or_else(invalid)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| invalid())?
        .as_millis() as u64;
    if signed["context"] != context || sequence < 1_793_836_800_000 || sequence > now + 300_000 {
        return Err(invalid());
    }
    let digest = hex::encode(Sha256::digest(&bytes));
    if let Some(previous) = previous {
        let last = previous["sequence"].as_u64().ok_or_else(invalid)?;
        if sequence < last || (sequence == last && previous["digest"] != digest) {
            return Err("This signed update is older than the last accepted publication.".into());
        }
    }
    Ok((
        signed["data"].clone(),
        json!({ "sequence": sequence, "digest": digest }),
    ))
}
pub fn accept(file: &Path, stamp: &Value) -> Result<(), String> {
    crate::store::write_json(file, stamp).map_err(|e| e.to_string())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    pub fn signed(data: Value, sequence: u64) -> (Value, String) {
        let key = SigningKey::from_bytes(&[42; 32]);
        let bytes = serde_json::to_vec(&json!({ "context": RELEASE, "sequence": sequence, "data": data })).unwrap();
        (
            json!({ "payload": STANDARD.encode(&bytes), "signature": hex::encode(key.sign(&bytes).to_bytes()) }),
            hex::encode(key.verifying_key().to_bytes()),
        )
    }
    #[test]
    fn rejects_tampering_wrong_context_unsigned_and_replay() {
        let (mut file, key) = signed(json!({"version":"4.1.0"}), 1_793_836_800_001);
        let (_, stamp) = verify_key(&file, RELEASE, None, &key).unwrap();
        assert!(verify_key(&file, RELEASE, Some(&stamp), &key).is_ok());
        assert!(verify_key(&file, "memoria-event-feed-v1", None, &key).is_err());
        assert!(verify_key(&json!({}), RELEASE, None, &key).is_err());
        let (older, _) = signed(json!({"version":"4.0.1"}), 1_793_836_800_000);
        assert!(verify_key(&older, RELEASE, Some(&stamp), &key)
            .unwrap_err()
            .contains("older"));
        file["payload"] = json!(STANDARD.encode(b"modified"));
        assert!(verify_key(&file, RELEASE, None, &key).is_err());
    }
}
