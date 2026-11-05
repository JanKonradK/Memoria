use chacha20poly1305::{
    aead::{Aead, Payload},
    KeyInit, XChaCha20Poly1305, XNonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub fn random_hex<const N: usize>() -> String {
    let mut bytes = [0; N];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}
fn bytes32(hex: &str) -> Result<[u8; 32], String> {
    hex::decode(hex)
        .map_err(|_| "Invalid device key.")?
        .try_into()
        .map_err(|_| "Invalid device key.".into())
}
pub fn public(secret: &str) -> Result<String, String> {
    Ok(hex::encode(
        PublicKey::from(&StaticSecret::from(bytes32(secret)?)).as_bytes(),
    ))
}
pub fn fingerprint(public: &str) -> Result<String, String> {
    Ok(hex::encode(Sha256::digest(bytes32(public)?)))
}
pub fn keys(secret: &str, peer: &str, pc: &str, phone: &str) -> Result<([u8; 32], [u8; 32]), String> {
    let shared = StaticSecret::from(bytes32(secret)?).diffie_hellman(&PublicKey::from(bytes32(peer)?));
    if !shared.was_contributory() {
        return Err("Invalid device key.".into());
    }
    let salt = Sha256::digest(format!("memoria-lan-v2\n{pc}\n{phone}").as_bytes());
    let hkdf = hkdf::Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes());
    let (mut request, mut response) = ([0; 32], [0; 32]);
    hkdf.expand(b"request", &mut request).map_err(|e| e.to_string())?;
    hkdf.expand(b"response", &mut response).map_err(|e| e.to_string())?;
    Ok((request, response))
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Packet {
    pub public_key: String,
    pub challenge: String,
    pub nonce: String,
    pub ciphertext: String,
}
fn aad(path: &str, challenge: &str, reply_to: &str) -> String {
    format!("memoria-lan-v2\n{path}\n{challenge}\n{reply_to}")
}
pub fn open(key: &[u8; 32], path: &str, packet: &Packet, reply_to: &str) -> Result<Value, String> {
    let nonce: [u8; 24] = hex::decode(&packet.nonce)
        .map_err(|_| "Invalid encrypted sync packet.")?
        .try_into()
        .map_err(|_| "Invalid encrypted sync packet.")?;
    let ciphertext = hex::decode(&packet.ciphertext).map_err(|_| "Invalid encrypted sync packet.")?;
    let data = XChaCha20Poly1305::new(key.into())
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: aad(path, &packet.challenge, reply_to).as_bytes(),
            },
        )
        .map_err(|_| "Sync authentication failed. No data was changed.")?;
    serde_json::from_slice(&data).map_err(|_| "Invalid encrypted sync data.".into())
}
pub fn seal(
    key: &[u8; 32],
    path: &str,
    public_key: &str,
    challenge: &str,
    data: &Value,
    reply_to: &str,
) -> Result<Packet, String> {
    let nonce = random_hex::<24>();
    let bytes = hex::decode(&nonce).unwrap();
    let data = serde_json::to_vec(data).map_err(|e| e.to_string())?;
    let ciphertext = XChaCha20Poly1305::new(key.into())
        .encrypt(
            XNonce::from_slice(&bytes),
            Payload {
                msg: &data,
                aad: aad(path, challenge, reply_to).as_bytes(),
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(Packet {
        public_key: public_key.into(),
        challenge: challenge.into(),
        nonce,
        ciphertext: hex::encode(ciphertext),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn reads_javascript_handshake_fixture() {
        let fixture: Value = serde_json::from_str(include_str!("../../../shared/test/fixtures/lan-v2.json")).unwrap();
        let pc = fixture["pc"].as_str().unwrap();
        let phone = fixture["phone"].as_str().unwrap();
        let keys = keys(fixture["pcSecret"].as_str().unwrap(), phone, pc, phone).unwrap();
        let request: Packet = serde_json::from_value(fixture["request"].clone()).unwrap();
        let response: Packet = serde_json::from_value(fixture["response"].clone()).unwrap();
        assert_eq!(open(&keys.0, "/pair", &request, "").unwrap()["code"], "12345678");
        assert_eq!(
            open(&keys.1, "/pair", &response, &request.nonce).unwrap()["deviceId"],
            "fixture"
        );
    }
    #[test]
    fn handshake_authenticates_both_directions_and_binds_replies() {
        let (pc_secret, phone_secret) = (random_hex::<32>(), random_hex::<32>());
        let (pc, phone) = (public(&pc_secret).unwrap(), public(&phone_secret).unwrap());
        let a = keys(&pc_secret, &phone, &pc, &phone).unwrap();
        let b = keys(&phone_secret, &pc, &pc, &phone).unwrap();
        assert_eq!(a, b);
        assert_ne!(a.0, a.1);
        assert!(keys(&phone_secret, &"00".repeat(32), &pc, &phone).is_err());
        let mut request = seal(
            &b.0,
            "/pair",
            &phone,
            &random_hex::<32>(),
            &json!({"code":"12345678"}),
            "",
        )
        .unwrap();
        assert_eq!(open(&a.0, "/pair", &request, "").unwrap()["code"], "12345678");
        assert!(open(&a.0, "/sync", &request, "").is_err());
        assert!(open(&a.1, "/pair", &request, "").is_err());
        let reply = seal(
            &a.1,
            "/pair",
            &pc,
            &request.challenge,
            &json!({"deviceId":"paired"}),
            &request.nonce,
        )
        .unwrap();
        assert_eq!(
            open(&b.1, "/pair", &reply, &request.nonce).unwrap()["deviceId"],
            "paired"
        );
        assert!(open(&b.1, "/pair", &reply, "wrong request").is_err());
        let byte = u8::from_str_radix(&request.ciphertext[..2], 16).unwrap() ^ 1;
        request.ciphertext.replace_range(..2, &format!("{byte:02x}"));
        assert!(open(&a.0, "/pair", &request, "").is_err());
    }
}
