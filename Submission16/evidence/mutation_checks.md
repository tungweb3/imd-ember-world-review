Mutation checks run locally on 2026-10-27 at World source 38a21a3: each fix undone once, its test file re-run, the file restored. Every mutation made its test file fail (11 of 11).

38a21a3 (Swarm audit 351b0573 findings, plus the independent review of the first draft)
- Finding 3, higher-nonce rule dropped (`nonce(record.nonce)&&nonce(tx.nonce)&&BigInt(record.nonce)>BigInt(tx.nonce)&&` removed): "the wallet's own hash mined under another nonce ..." fails (an older identical payment, or a record with no nonce, is accepted again).
- Finding 3, strict nonce restored (`&&!renumbered` removed): the same test fails (the renumbered own hash is locked for good again).
- Finding 4, the send keeps the previous hash (`hash:null,sentHash:null` removed from send()): "a payment prompt that fails after an approval shows no stale hash and can be acknowledged" fails.
- Finding 10, `sentHash:null` removed from initial(): "a new intent starts without the previous sent hash" fails.
- Findings 4 and 5, the GOLD panel's recovery block disabled: "the GOLD panel offers the staking pane's recovery for an unresolved payment" fails.
- Finding 1, after-expiry margin back to 30 minutes: "a payment that mined late but unseen by this browser keeps its note until it can be final" fails.
- Finding 7, node_modules not re-checked after the build: "a real deploy re-checks ...: deps-added" fails (the package added during the build is uploaded).
- Finding 7, node_modules not compared after the upload: "a real deploy re-checks ...: deps-while-uploading" fails (the record says clean).
- Finding 8, CLOUDFLARE_ENV / WRANGLER_BUILD_* / preloading NODE_OPTIONS refusal removed: "a real deploy re-checks ...: cloudflare-env" fails.
- Finding 11, VITE_ prefix matched without case on every platform: the L-5 environment test fails (its Linux case).
- Finding 12, lockfile link entries no longer skipped: the L-5 dependency test fails (its "link" case).

Finding 6 (one note per payment and phase in WorldGoldPanel.tsx) is a React effect; its test asserts the guard and its dependency list in the source rather than running the panel.
