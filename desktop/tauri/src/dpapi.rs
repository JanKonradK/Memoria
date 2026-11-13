//! Windows DPAPI: secrets on disk readable only by this Windows account.
//! Other platforms store them as they are; the desktop app ships for Windows.

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    fn run(input: &[u8], protect: bool) -> Option<Vec<u8>> {
        let source = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(input.len()).ok()?,
            pbData: input.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        // SAFETY: both blobs are valid for the call; the output buffer is
        // allocated by Windows and released with LocalFree below.
        let ok = unsafe {
            if protect {
                CryptProtectData(
                    &source,
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            } else {
                CryptUnprotectData(
                    &source,
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            }
        };
        if ok == 0 || output.pbData.is_null() {
            return None;
        }
        // SAFETY: Windows returned `cbData` bytes at `pbData`.
        let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
        unsafe { LocalFree(output.pbData as _) };
        Some(bytes)
    }

    pub fn protect(secret: &[u8]) -> Option<Vec<u8>> {
        run(secret, true)
    }

    pub fn unprotect(blob: &[u8]) -> Option<Vec<u8>> {
        run(blob, false)
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn protect(_: &[u8]) -> Option<Vec<u8>> {
        None
    }

    pub fn unprotect(_: &[u8]) -> Option<Vec<u8>> {
        None
    }
}

pub use imp::{protect, unprotect};

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn round_trips_and_does_not_store_the_secret_in_the_clear() {
        let secret = b"0123456789abcdef0123456789abcdef";
        let blob = super::protect(secret).unwrap();
        assert!(!blob.windows(secret.len()).any(|window| window == secret));
        assert_eq!(super::unprotect(&blob).unwrap(), secret);
        assert!(super::unprotect(b"not a blob").is_none());
    }
}
