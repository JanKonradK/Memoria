# Publisher and device trust

## Publisher key

The app contains one Ed25519 public key. Its SHA-256 fingerprint is:

`bbce3a9a1fefdd8c6e92182a5e5d585279d09497cd78544af4f0692760ea9b58`

The private key stays outside the repository. The default file is `%USERPROFILE%\.memoria\publisher-key.pem`.
`MEMORIA_SIGNING_KEY_FILE` selects another file. `MEMORIA_SIGNING_KEY` supplies PEM text in CI.
The script `node scripts/signing-key.mjs` creates a key pair. It refuses to replace an existing key.
It prints only the public key, its fingerprint, and the private key location.

Before a release, add the PEM text to the GitHub Actions secret `MEMORIA_SIGNING_KEY`.
Use a protected environment with manual approval where possible. Keep a separate, secure backup of the private key.
Do not put the private key in a repository, artifact, log, or issue.

## Signed files

An envelope contains a base64 payload and a hexadecimal Ed25519 signature.
The signature covers the exact payload bytes. The payload contains `context`, `sequence`, and `data`.
The sequence is the publication time in milliseconds since the Unix epoch.
Changed content needs a greater sequence. Each reader retains the last sequence and the payload digest locally.
The reader rejects an older sequence, or different content at the same sequence. Identical files remain valid for offline use.
The initial lower limit is November 5, 2026. Files more than five minutes in the future are invalid.

- Event feeds use `memoria-event-feed-v1`. `npm run export:events` signs the export.
- The release notes contain a copy of the signed envelope. Browsers read this copy through the GitHub API.
- Releases use `memoria-release-v1`. The manifest contains the version, tag, asset digests, and Windows file digests.
- `npm run package` signs the Windows release. `node scripts/sign-release.mjs` signs the complete release after Android and HTML builds.
- `npm run check:events` checks the signature and the feed content without access to a private key.

The Windows updater verifies the signature before extraction. It checks all staged files before the app closes.
After the app exits, a signed native helper checks the files again. Read locks prevent changes during installation.
The installer copies only signed file names. An elevated process cannot start an update.
Android receives the APK digest only after JavaScript verifies the signed manifest. Android also checks the APK application signature.

The release retains `SHA256SUMS.txt` and the previous asset names. Version 3.3.1 can thus install version 4.0.0.
The old updater does not check publisher signatures. Version 4.0.0 and later require them.
Local replay records do not survive deletion of app data. Publisher key rotation needs a new trusted app release.

## Encrypted LAN sync

Each PC retains an X25519 private key in `devices.json`. Each phone creates a private key when it pairs.
The PC retains the public key of each paired phone. The phone retains its private key and the PC fingerprint locally.
The QR payload includes the PC fingerprint. Manual pairing requires the same fingerprint and the eight-digit code.
Devices paired before Beta 0.4 must pair again.

Application encryption avoids self-signed certificate pinning in the Capacitor WebView and native HTTP bridge.
HTTP carries only public handshake fields and authenticated ciphertext. No sync data or pairing code crosses the network as plaintext.

1. The phone requests `/hello`. The PC supplies its public key and a random challenge.
2. The phone checks the public key against the fingerprint from the PC screen.
3. X25519 establishes a shared secret. HKDF-SHA256 binds both public keys and derives separate request and reply keys.
4. XChaCha20-Poly1305 encrypts the request with a random 24-byte nonce.
5. The PC consumes the challenge once, then authenticates the request before any state change.
6. The encrypted reply binds the route, challenge, and request nonce. The phone authenticates the reply before use.

Challenges expire after one minute. The PC permits eight pending challenges per address and 256 overall.
Code attempts retain the previous limits: five per address per minute and 30 overall.
Revocation removes the phone public key. The old phone cannot change data.
This design uses static device keys. It does not provide forward secrecy if a private device key is later stolen.
Local keys rely on the operating system account and app storage permissions.

The implementation uses [noble curves](https://github.com/paulmillr/noble-curves), noble hashes and noble ciphers in JavaScript.
Rust uses x25519-dalek, ed25519-dalek, HKDF, and [RustCrypto XChaCha20-Poly1305](https://docs.rs/chacha20poly1305/0.10.1/chacha20poly1305/).
