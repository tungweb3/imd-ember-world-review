# Future Mint boundary (outside World's scope)

A boundary for a later page, written down from the Swarm retest e48d0a96 (its G-1..G-3 and S-2) and the review's F-8.
It is not a review of the Genesis Mint and does not describe its code: nothing here reviews or changes the Mint's code,
contracts, signatures or transaction flow. The three World reviews (4bd31cfb, and the re-reviews e48d0a96 and 519db624)
examined World only; they say nothing about a Mint, and their results must not be read as evidence about one.

## What World does today (the facts a Mint page would inherit)

- The only wallet methods the page calls are `eth_accounts`, `eth_requestAccounts` and `personal_sign` of the server-built
  SIWE sign-in message (checked line by line before the wallet sees it). No transaction, no token or NFT approval, no
  Permit or Permit2, no typed-data signature.
- The session is the `__Host-imd_session` cookie (HttpOnly, Secure, SameSite=Lax, Path=/, 7 days, no renewal), stored
  server-side only as its SHA-256. `Path=/` means every page on imdember.com sends it.
- What a session grants in World: session functionality and owner mode for the seats `ownerOf` proves on Ethereum
  mainnet (the house and local move), plus selected persistent Member M1 profile writes for `EOA`/`ECDSA` sessions.
  The session is not strictly read-only. M1 names are social labels, never ownership or Mint proof.
  `CONTRACT`/`ERC1271` and unknown verification types cannot bootstrap or write M1 under the temporary AUD4 policy;
  their login and reads remain available. No asset transaction or approval is authorized by any World session.
- One origin shares its CSP, its `__Host-` cookies, its local storage and a wallet's "connected site" permission (F-8).

## G-1 — a World session is never a Mint authorization

World's SIWE session proves that someone controlled the wallet's key (or, for a contract wallet, that the contract said
yes) when they signed in, up to 7 days ago. It is not consent to mint, to pay, or to sign anything else. A Mint needs its
own authorization design and its own confirmation step that the player sees for each mint (what is minted, on which
chain and contract, for how much), and it must not treat a live World session as that consent.

## G-2 — re-evaluate for Mint what World accepts

- **SIWE relay (S-1, the review's F-1):** a real signature of a real challenge, obtained on a phishing page, still gives a
  7-day World session. The existing shared boundary remains: an EOA session can now write its public M1 name and start
  the rename cooldown. Exact SIWE checking and Origin checks do not defeat a relay that obtains a real signature.
  A Mint must decide how it stops a relayed sign-in from reaching anything that costs the player.
- **Contracts that accept any signature (F-2):** under ERC-1271 the contract decides who signs for it; a permissive one
  lets anyone sign in as it. World records such sessions (`CONTRACT`/`ERC1271`); AUD4 temporarily disables their
  persistent M1 writes, including login-time profile touches, with `CONTRACT_WRITE_NOT_ENABLED`. This also restricts
  legitimate smart wallets until a reviewed additional write-authority policy exists; it does not repair permissive
  contract authentication or change `ownerOf` house authority. A Mint must decide which smart-contract wallets it
  supports and what an ERC-1271 sign-in may do there.
- **Eligibility:** World's "a seat counts" rule (held now, agent online in the last 24 hours, proved per read and cached
  30 s) is a display rule; Mint eligibility needs its own rule and its own proof at the moment of minting.

## G-3 — changes a Mint brings are reviewed separately

Any change to the CSP, to the shared `__Host-` cookies or local storage, to the wallet RPC methods the site calls, or to
the transaction flow is reviewed on its own, together with the Mint, before it ships; World's reviews do not cover it.

## S-2 — same-origin Mint checklist

A Mint page on this origin inherits the cookie, the CSP, the storage and the wallet's connection. Its own review covers at
least:

- [ ] Mint-specific authorization
- [ ] contract address
- [ ] chain ID
- [ ] transaction parameters
- [ ] approvals
- [ ] Permit / Permit2
- [ ] transaction simulation
- [ ] recipient
- [ ] amount / quantity
- [ ] replay
- [ ] smart-contract wallet behavior
- [ ] session reuse
- [ ] same-origin cookie exposure
- [ ] CSP changes

Mint needs its own dedicated review before it goes live. This page lists the questions; it answers none of them.
