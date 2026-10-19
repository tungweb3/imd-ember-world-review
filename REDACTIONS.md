# Privacy and projection boundaries

This local candidate intentionally excludes production databases, saved preview SQLite, sessions, tokens, .dev.vars, env files, SSH credentials, wallet secrets, dependency folders and original machine paths. Public owner/treasury wallet addresses are necessary authorization configuration already supplied by the user; they are not private keys. Test code uses explicitly synthetic short bridge secrets, randomized in-process keys and the public Hardhat mnemonic; none is a production credential.

Compiler receipt machine metadata is sanitized. All portable path and filename adaptations are enumerated with hashes in manifests/portable-adaptations.json. Business server/API/SQL/client source bytes remain exact unless the manifest explicitly lists a fixture runtime path adaptation. No claim is made that a selected source packet contains the whole World or all renderer tests.

Offline filename/secret-pattern checks plus a reviewed file whitelist are performed locally. This is not proof that no secret can exist. No Git history is included in this packet, and no remote repository has been modified.
