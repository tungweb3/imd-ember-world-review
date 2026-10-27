Mutation checks run locally on 2026-10-28 at World source be7d3b0: each fix undone once, its test file re-run, the file restored. Every mutation made its test file fail (17 of 17).

be7d3b0 (Swarm audit 1ac5269f findings, plus the independent review of the first draft)
- Finding 1, lower-nonce payment refused again (`||lowerPayment` removed): "the wallet's own hash mined under another nonce ..." fails.
- Review D1, the lower direction accepting any revert or repeatable call (`lowerPayment` widened to `same||effect||r.status==='0x0'`): the same test fails (a lower-nonce revert of another call and a lower-nonce identical stake are released).
- Finding 3, higher nonce without proof locked again: the same test fails.
- Finding 2, no learning while the transaction has no receipt: "a renumbered send that is sped up or cancelled ..." fails.
- Finding 2, no learning from the wallet's pending copy when a receipt exists: the same test fails.
- Finding 2, learning in any direction (the upward check removed): the same test fails.
- Review D2, a stale tab judging by the old nonce (`||stored.nonce!==tx.nonce` removed): the same test fails.
- Finding 4, the effect computed for the wallet's own hash only: "a routed transaction without exactly the intended effect ..." fails (the pasted routed speed-up is "replaced" again).
- Finding 6, no paid order in the controller state: "a payment confirmed after a reload names the order it paid ..." and the finding 4 test fail.
- Finding 6, the panel ignoring the paid order: "after a reload the confirmed payment's order comes from the controller" fails.
- Finding 5, the panel marking only the sent hash: "a note made after a pasted replacement was confirmed is marked mined and kept" fails.
- Finding 7, the NODE_OPTIONS blocklist of Submission16 restored: the L-5 environment test fails (quoted, snapshot and OpenSSL forms).
- Review D3, the underscore form of --max-old-space-size refused: the same test fails.
- Finding 8, CLOUDFLARE_API_BASE_URL / CF_API_BASE_URL not refused: the same test fails.
- Finding 8, WRANGLER_CI_OVERRIDE_NAME not refused: the same test fails.
- Finding 8, the account variable not recorded (`targetEnv` removed): "a real deploy re-checks ...: clean" fails.
- Finding 9, VITE_ matched without case on Windows: the L-5 environment test fails (run on Windows).

Findings 5 and 6 in WorldGoldPanel.tsx are React effects; their tests replay the effect order against pendingGoldCredit.ts and assert the effect in the source rather than running the panel.
