# Code signing and winget

Neither is set up yet. Both are steps for the maintainer, outside this repository.

## Code signing

`Memoria-setup-x64.exe` and `Memoria.exe` are not signed, so Windows SmartScreen shows "Windows protected your PC" until enough people have run a given file. Signing both removes the warning once the certificate has a reputation.

Options:

- **SignPath Foundation:** free code signing for open-source projects, run from GitHub Actions. Requires applying with the repository.
- **Azure Trusted Signing:** a monthly fee and identity validation; signs from GitHub Actions with `azure/trusted-signing-action`.
- **A certificate from a CA** (for example Certum's open-source certificate) used with `signtool`.

Whichever is used, sign `Memoria.exe` before `scripts/package-release.mjs` zips and stages it, and sign the installer after `makensis` builds it, so the checksums and the publisher manifest (`docs/publisher-trust.md`) cover the signed files.

## winget

Once a release with the installer is published, a manifest can be submitted to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs). The simplest way is `wingetcreate`:

```powershell
winget install Microsoft.WingetCreate
wingetcreate new https://github.com/JanKonradK/Memoria/releases/download/v<version>/Memoria-setup-x64.exe
```

Answer its questions with these values:

| Field             | Value                              |
| ----------------- | ---------------------------------- |
| PackageIdentifier | `JanKonradK.Memoria`               |
| InstallerType     | `nullsoft`                         |
| Scope             | `user`                             |
| Silent switch     | `/S` (NSIS default)                |
| ProductCode       | `Memoria` (the uninstall key name) |
| License           | as in the repository               |

For each later release, `wingetcreate update JanKonradK.Memoria --version <version> --urls <installer url> --submit` opens the pull request. winget users then get updates with `winget upgrade`; the in-app updater keeps working either way, and `Install-Shortcut.ps1` keeps the installed version current in Settings → Apps so winget sees the right version after an in-app update.
