# Privacy and projection record

Selected financial source files are copied byte for byte from the manifest's committed product candidate. No redaction is applied to those selected source bytes. The dependency closure excludes the full-Worker test and its unrelated AI Market/administrator imports rather than masking wallet-role data and claiming an unchanged full application.

The World integration is a zero-context `git diff` over an explicit file allowlist. Full World source, deployment/account configuration, prior Git parents, unchanged unrelated lines, private history and unrelated test bodies are not copied. Before/after hashes identify the actual private files without exposing their contents. A patch is partial context and cannot reproduce the complete World test gate by itself.

Contract tooling is a separate documented portable projection. It replaces local absolute dependency paths with package-root-relative resolution and supplies a public original-token fixture plus a verified official compiler payload. Solidity source and creation/runtime artifacts must remain exact; altered tooling and sanitized build metadata must be identified separately. Raw local build/runtime receipts containing machine paths are excluded.

No real wallet key, recovery phrase, signature, bearer token, API/bridge/session secret, production database, player/name ledger, VPS snapshot, backup key, funded-chain state or administrator-role list is allowed. The canonical EMBEO address, its public bytecode/ABI and immutable single payment treasury are required public protocol data and are permitted.

Synthetic test accounts, repeated-character test addresses/hashes, generated throwaway EOA keys and the publicly known `test test test test test test test test test test test junk` EDR mnemonic may appear only in clearly labelled in-process test fixtures. They have no production authority or assets. No generated private key is saved as review evidence.

The offline scanner reports only file paths and rule names. A clean pattern scan is not a proof that no sensitive content exists; manually inspect every selected file and scan every object in the eventual isolated public Git tree. Runtime-only `node_modules` junctions, generated local test receipts and ignored evidence are never publication inputs. No Git initialization or remote publication is part of preparing this local tree.
