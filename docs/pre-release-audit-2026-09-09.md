# Pre-release checks — 2026-09-09

The review covered the browser app, shared validation, file sync, Windows launcher,
updater, release scripts, dependencies, and local Git history.
Claude Code provided two independent reviews of the launcher and sync changes.

## Corrections

| Area                 | Defect and correction                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launcher credentials | Loopback cookies exposed credentials to other local ports. The app now sends an authorization header. Browser tokens expire with the launcher process.                                                     |
| Launch tickets       | Captured proofs remained valid after the replay cache expired. Signed timestamps now limit proof validity.                                                                                                 |
| Local HTTP server    | A path prefix check permitted access to adjacent `dist*` directories. The server now checks path boundaries and resolved paths.                                                                            |
| Browser policy       | The desktop server lacked a CSP. Both builds now restrict scripts, frames, connections, and MIME interpretation. The theme script uses a hash.                                                             |
| File sync            | Validation after data repair could overwrite a damaged or newer file. Validation now occurs first. Files above 10 MB cannot enter the parser.                                                              |
| Sync races           | Pending reads could restore disconnected files. Connection versions now prevent stale operations. A peer's older subset no longer prevents a necessary write.                                              |
| Stored data          | Older code could remove fields from a newer schema. The app now refuses newer schemas. Unreadable desktop state remains intact.                                                                            |
| Updater              | Downloads could exceed the memory limit before the size check. Downloads now stream to disk with a byte limit and a body deadline.                                                                         |
| Windows paths        | Apostrophes could break PowerShell commands. Archive commands now escape literal paths.                                                                                                                    |
| Release process      | Cached Node binaries now receive another checksum check. Workflow tags pass through environment variables. Actions use fixed commit hashes. Checkout credentials do not remain available to build scripts. |

## Dependency checks

The initial audit reported nine affected dependency entries: six high and three moderate.
The production-only audit reported zero entries. These npm findings concerned development dependencies.

Compatible dependency updates and Vitest **4.1.11** removed all reported entries.
Vitest identifies this version as a fix for its file-read advisory.
See the [maintainer advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9).

CI and release downloads now use Node **24.21.0**.
The [official release index](https://nodejs.org/dist/index.json) listed this version as the latest Node 24 release on the review date.
CI rejects moderate or higher npm advisories. Dependabot checks npm dependencies and GitHub Actions each week.

## Performance

- Hidden countdowns now stop their intervals. A 60-second hidden interval produced zero countdown renders in the regression test.
- Game titles use font weight 600. The build no longer includes their unused weight 500 files. All character subsets remain available.
- The font cleanup decreased the standalone HTML file from 2,097,386 to 1,655,204 bytes, a 21% reduction.
- The PWA precache decreased from 1,582.17 to 1,373.52 KiB, a 13% reduction.
- Update downloads no longer require a complete archive in memory.
- Failed event connections use a limited retry interval. Authorization failures stop retries and show a recovery message.

## Verification

All final checks passed with Node 24.21.0:

- `npm run check`: lint, format, types, 425 tests, production build, CSP hash, and PWA budget.
- `npm run audit`: zero reported vulnerabilities, including development dependencies.
- `npm run package` and `npm run build:single`: both downloads built successfully.
- `npm run check:release`: both downloads passed the isolated browser check.
- Archive inspection: 122 entries, no unexpected private files, and a matching SHA-256 checksum.

The checks use temporary application data and isolated browser contexts.
The release check exercises shortcut startup, data persistence, window reuse,
live events, CSP, and the standalone HTML file.
Both workflows now run this check before artifact delivery.

The browser suite passed 80 cases. Its viewport rules skipped 46 cases.
The credential-pattern scan covered 111 locally reachable commits, 987 text blobs,
and 161 tracked files. It found no matches for the credential patterns checked.
This pattern scan does not prove that every possible secret is absent.

## Remaining limits

- Release checksums detect damage. They do not provide an independent publisher signature. The updater trusts access to the GitHub release account.
- Code with the same operating-system privileges can read the app's data files. The launcher does not provide a sandbox against that code.
- The first upgrade from cookie authorization requires a full launcher restart. Existing old processes cannot use the new ticket protocol.
- Automated browser checks used Chromium on Windows. They do not establish Firefox, Safari, or physical mobile-device coverage.
- The review did not publish a release or change GitHub repository settings.

## Search summary

- Commands: `npm audit`, `npm view`, `webcmd web fetch`, web fetch, `Invoke-RestMethod`, and `git ls-remote`.
- Sources: the Vitest maintainer advisory, Node release index, and the four action repositories named in the workflows.
- Webcmd could not fetch the GitHub advisory or Node release page. The review used direct official sources instead.
- No browser search fallback was necessary.
