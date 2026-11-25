//! The "DS" request signature HoYoLAB's overseas web pages send, and the MD5
//! it is built from. MD5 is written out here (RFC 1321) rather than pulled in
//! as a crate: it signs a public, non-secret request header and is never used
//! to protect anything.

/// The salt HoYoLAB's overseas web client mixes into its DS header (genshin.py's
/// `DS_SALT[Region.OVERSEAS]`). A wrong salt makes every signed call fail, so
/// `ds_matches_a_known_answer` pins it.
pub const HOYOLAB_OS_SALT: &str = "6s25p5ox5y14umn1p61aqyyvbvvl3lrt";

const SHIFTS: [u32; 64] = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, //
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, //
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, //
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/// floor(abs(sin(i + 1)) * 2^32), per RFC 1321 section 3.4.
const K: [u32; 64] = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501, //
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, //
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8, //
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, //
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, //
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, //
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1, //
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

/// The MD5 digest of `input` as 32 lowercase hex characters.
pub fn md5_hex(input: &[u8]) -> String {
    let mut state: [u32; 4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    let bit_len = (input.len() as u64).wrapping_mul(8);
    let mut message = input.to_vec();
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_len.to_le_bytes());

    for block in message.as_chunks::<64>().0 {
        let mut words = [0u32; 16];
        for (word, bytes) in words.iter_mut().zip(block.as_chunks::<4>().0) {
            *word = u32::from_le_bytes(*bytes);
        }
        let [mut a, mut b, mut c, mut d] = state;
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let rotated = a
                .wrapping_add(f)
                .wrapping_add(K[i])
                .wrapping_add(words[g])
                .rotate_left(SHIFTS[i]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(rotated);
        }
        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
    }

    state
        .iter()
        .flat_map(|word| word.to_le_bytes())
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// `count` random ASCII letters, as genshin.py's `ds.py` draws the `r` nonce
/// (`random.choices(string.ascii_letters, k=6)`). Bytes past the last whole
/// multiple of 52 are redrawn, so every letter is equally likely.
fn random_letters(count: usize) -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const LIMIT: u8 = (256 / CHARS.len() * CHARS.len()) as u8;
    let mut out = String::with_capacity(count);
    let mut bytes = [0u8; 16];
    while out.len() < count {
        rand::fill(&mut bytes[..]);
        for byte in bytes.iter().filter(|b| **b < LIMIT) {
            if out.len() == count {
                break;
            }
            out.push(CHARS[*byte as usize % CHARS.len()] as char);
        }
    }
    out
}

fn ds_for(time: u64, random: &str) -> String {
    let digest = md5_hex(format!("salt={HOYOLAB_OS_SALT}&t={time}&r={random}").as_bytes());
    format!("{time},{random},{digest}")
}

/// `"{unix seconds},{6 random letters},{md5}"` for the DS header.
pub fn hoyolab_ds_os() -> String {
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    ds_for(time, &random_letters(6))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md5_matches_rfc_1321_vectors() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"a"), "0cc175b9c0f1b6a831c399e269772661");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(md5_hex(b"message digest"), "f96b697d7cb7938d525a2f31aaf161d0");
        assert_eq!(
            md5_hex(b"12345678901234567890123456789012345678901234567890123456789012345678901234567890"),
            "57edf4a22be3c955ac49da2e2107b67a"
        );
    }

    #[test]
    fn ds_has_time_random_and_digest() {
        let ds = hoyolab_ds_os();
        let parts: Vec<&str> = ds.split(',').collect();
        assert_eq!(parts.len(), 3);
        assert!(parts[0].parse::<u64>().unwrap() > 1_600_000_000);
        assert_eq!(parts[1].len(), 6);
        assert!(parts[1].bytes().all(|b| b.is_ascii_alphabetic()));
        assert_eq!(parts[2].len(), 32);
        assert!(parts[2].bytes().all(|b| b.is_ascii_hexdigit()));
        let expected = md5_hex(format!("salt={HOYOLAB_OS_SALT}&t={}&r={}", parts[0], parts[1]).as_bytes());
        assert_eq!(parts[2], expected);
        assert_eq!(ds_for(1, "abcdef"), format!("1,abcdef,{}", md5_hex(format!("salt={HOYOLAB_OS_SALT}&t=1&r=abcdef").as_bytes())));
    }

    /// Pins the salt: these digests were computed independently (Node's
    /// `crypto.createHash('md5')`) from genshin.py's overseas salt.
    #[test]
    fn ds_matches_a_known_answer() {
        assert_eq!(HOYOLAB_OS_SALT, "6s25p5ox5y14umn1p61aqyyvbvvl3lrt");
        assert_eq!(
            ds_for(1_700_000_000, "AbCdEf"),
            "1700000000,AbCdEf,52762c606b53f6830e4692f53664105e"
        );
        assert_eq!(ds_for(1, "abcdef"), "1,abcdef,17926259eeb14bf6d1311c3e42f57c8c");
    }

    #[test]
    fn nonces_are_letters_of_the_asked_length() {
        for count in [0, 1, 6, 40] {
            let nonce = random_letters(count);
            assert_eq!(nonce.len(), count);
            assert!(nonce.bytes().all(|b| b.is_ascii_alphabetic()));
        }
    }
}
