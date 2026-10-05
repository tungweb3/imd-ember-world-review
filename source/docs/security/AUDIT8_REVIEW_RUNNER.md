# Audit8 reviewer reproduction

Use a fresh checkout of the pinned public review commit and **Node.js 24.x** (`package.json` supports `>=24 <25`). From the directory containing `package.json`:

```sh
node --version
npm ci --ignore-scripts
npm run test:review -- --check
npm run test:review
```

These commands use the repository's existing, exact lockfile, including `viem@2.56.9`. Do not install a global viem, add a placeholder module, patch a fixture manually, or substitute dependencies from a private checkout. `--ignore-scripts` is the supported clean install mode; the review tests need no dependency lifecycle scripts. No package or dependency version was upgraded for the runner. A package script addition does not require resolving the lockfile again.

`npm run test:review -- --list` prints the exact file list. The runner retains the previous **17/17 review files**, adds the three exact Audit8 reproduction files (`auth-audit8`, `ownership-audit8`, `clock-skew-audit8`), and includes causal-oracle, artifact-hygiene and runner regression files: **23 test files** in total. It executes `node --test --test-reporter=tap --test-concurrency=3` with all 23 explicit relative paths. A missing file, unsupported Node version or missing/mismatched local viem stops the command before testing. Child tests discard every environment key ending in `_SOURCE` and `NODE_OPTIONS`. An actual scan of test modules currently finds `AUTH_R7_SOURCE`, `AUTH_REFERENCE_SOURCE`, `R8_SOURCE`, `V11_SOURCE` and `AUDIT8_SOURCE`; the regression checks that all five are removed, and a future-selector control checks suffix handling. The supported review command cannot silently select a private source tree or a global preload.

The existing independent Auth oracle keeps its original 13 kernels and **500 deterministic seeds**. A separate Audit8 gate adds **90 deterministic schedules**, 30 each for passive provider discovery, lock/reconciliation failure followed by same-account unlock, and an ordinary cross-tab hint while a valid signing prompt is open. The new pure policy oracle imports only the existing pure oracle. It does not read production lifecycle/planner code to decide expected authority. The driver executes actual AuthClient and Worker handlers with in-memory SQLite and staged response headers, shared cookies and body delivery. Per-gate counts, normalized unique digests and real effects are printed in TAP diagnostics. Empty replays and missing signature completion cannot satisfy the new oracle. Seed counts are not counts of unique permutations.

## Optional, contained artifacts

The default command persists **zero scheduler artifacts** and creates no sibling `evidence` directory. To preserve sanitized, replayable traces, explicitly select a child of the checkout's ignored `tmp` directory. For PowerShell:

```powershell
$env:AUTH_REFERENCE_ARTIFACT_DIR = 'tmp/auth-reference-scheduler'
npm run test:review
Remove-Item Env:AUTH_REFERENCE_ARTIFACT_DIR
```

For a POSIX shell:

```sh
AUTH_REFERENCE_ARTIFACT_DIR=tmp/auth-reference-scheduler npm run test:review
```

Artifacts use fixed names such as `core500-RESULT.json`, `audit8-90-RESULT.json` and `core500-failure-original.json`; they contain no timestamp/UUID run names, sourceRoot, executable path or elapsed-time field. Input hashes use relative source paths. Requests, nonce/token aliases and explicit actions retain their replay meaning. Original and minimized failure files are separate. An external directory, `tmp` itself, a symlink/junction escape, or a non-regular output file is rejected. Files from a previous failed run may remain; before an independent recorded run, clean only the scheduler's recognized namespace:

```sh
node --input-type=module -e "import {createArtifactStore} from './tests/auth-artifacts.mjs'; console.log(createArtifactStore({sourceDir:'.',requestedDir:'tmp/auth-reference-scheduler'}).cleanup())"
```

The cleanup leaves reviewer notes and unrecognized files intact. The optional output is a local reviewer working artifact, not an addition to the public source manifest.

### Artifact closure policy

The artifact store uses `lstat` to observe both existing and dangling links. It checks the canonical source directory and each directory from `source/tmp` to the configured artifact root, rejects symbolic links/junctions and non-directory parents, and rejects every non-regular final output entry. Missing directories are created individually and then rechecked. A normal existing regular file is explicitly **replaced**, rather than truncated in place; an outside hard-link alias retains its original bytes.

Each write validates its parent chain, serializes/sanitizes the value, and validates again because serialization may invoke caller getters. It creates an exclusive regular temporary sibling using `O_EXCL|O_CREAT` and `O_NOFOLLOW` where supported, verifies directory and file identities, writes through the obtained descriptor, flushes/closes it, and rechecks parents/final entry/temp identity before renaming the complete sibling. There is no fallback to opening or writing the final path. Windows does not expose `O_NOFOLLOW`; exclusive creation remains required there. A failed write removes its temporary file only while the observed parent/file identities remain unchanged.

The sanitizer masks arbitrary-root POSIX, drive-letter, UNC and `file://` local paths, including nested error strings and paths with spaces or parentheses. Quoted paths have an explicit endpoint. A bare absolute path in freeform diagnostic prose has an ambiguous endpoint, so the policy conservatively masks its remaining line segment; whitespace and parentheses do not end the path. This can remove trailing diagnostic prose on that same ambiguous segment. Network URL spans remain exact, and subsequent diagnostic lines and separate structured fields remain intact. Put a relative identifier in a separate field/line, or quote the absolute path, when it must remain available after that diagnostic. The policy preserves relative paths, action/event ordering, nonce/token aliases, classifications, and a finite list of actual scheduler protocol route identifiers (including `/api/me/home?fresh=1`). It does not exempt a generic `path` field or a whole object from masking.

Single-letter URL-like prefixes are treated as Windows drive paths: `C://` and `D:///` do not receive URL protection. Windows rooted single-backslash paths are masked in whole values, nested diagnostics and quoted strings. Drive-relative values such as `C:relative` remain relative. Protected network URL schemes require at least two characters.

Run the assertion-based verifier from the checkout:

```sh
node scripts/verify-artifact-closure.mjs
```

It prints machine-readable JSON and returns **exit 0 only when all 13 closure assertion groups pass**, including real dangling/existing file links, parent/final directory links, non-regular targets, regular replacement, deterministic target/parent substitution, persisted spaced/parenthesized path masking, and a saved complete trace replay through the actual Worker/SQLite driver. Any failed assertion or link-creation capability error returns **exit 1**; there are no skipped symlink controls. Windows must permit real file-symlink creation for these mandatory checks; a directory junction does not substitute for a file-symlink fixture. The normal review suite also executes these controls in `auth-artifacts.test.mjs` and prints its actual new total.

For a separately recorded negative calibration only, the verifier accepts `--artifact-source ../baseline`. This selects only that checkout's actual `tests/auth-artifacts.mjs`; the causal replay driver and its dependencies remain those of the current checkout. The supported `test:review` command has no alternate-source selection.

The filesystem trust assumption is a privately controlled artifact fixture/checkout on a local filesystem. Node has no portable directory-descriptor-relative `openat`/rename API: repeated parent identity checks reduce observed check/use substitutions but do not prove safety against a hostile process swapping directory ancestry between the final check and the OS operation. NFS/SMB exclusivity, all Windows reparse-point types, adversarial concurrent ancestry replacement, and crash durability of directory metadata are not certified by this bounded verifier. These limits must stay explicit in closure evidence. See [Node 24 filesystem flags](https://nodejs.org/docs/latest-v24.x/api/fs.html#file-system-flags).

## Failure replay

Replay the saved original trace against this same checkout:

```sh
node scripts/replay-auth-trace.mjs --replay tmp/auth-reference-scheduler/core500-failure-original.json
node scripts/replay-auth-trace.mjs --replay tmp/auth-reference-scheduler/audit8-90-failure-original.json --minimize tmp/auth-reference-scheduler/audit8-90-failure-minimized.json
```

The CLI recognizes the Audit8 oracle marker and replays its complete explicit actions without selecting new randomized deliveries. Minimization preserves the original failure file and retains a deletion only when the same invariant and witness recur in the actual driver. The same old-source seed should pass against a repaired checkout. An old explicit action trace can omit a new canonical read introduced by the fix; that replay reports `HARNESS-TRACE-INCOMPLETE` rather than inventing extra deliveries or claiming a product-policy regression. Repeat the original failing version only in a separately selected, local negative-control experiment. That experiment is distinct from the supported review command, which always selects this checkout.

## Scope and limits

These are synthetic, offline tests. They do not fund wallets, transact, deploy, or access production databases. The Worker route and its SQL body are one scheduler execution step; this is not proof of every internal D1 transaction interleaving. Provider, timer and visibility delivery are injected. Real wallet/browser UI, browser cookie implementation differences, process termination, WAF, live Cloudflare bindings and live production traffic require separate checks. Exact Ownership/proof and client clock regressions are included in their own files, not counted as Auth oracle seeds. A passing test command is evidence of these bounded checks, not a certification or a zero-vulnerability claim. Withheld 3D models, scene modules and unrelated UI/assets are unnecessary for this command; this snapshot does not claim to be a complete standalone frontend build.
