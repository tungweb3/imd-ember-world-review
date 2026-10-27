Mutation checks run locally on 2026-10-27 (each fix undone, its test re-run, the file restored):

- intendedEffect exact-one rule (8cb7d66): `mine.length===1` -> `>=1`: "a delegated batch that also did something else of the same kind for this sender is not exactly the intended effect" fails.
- pending note hash (64396ae): paymentHash back to "any phase but sending": "only the payment's own hash starts a note" fails.
- cross-tab sync (64396ae): storage listener removed: "another tab changing a note reaches this tab" fails.
- deploy .env re-check (64396ae): envRefusal after the build removed: "a real deploy re-checks ... env-added" fails.
- retired route (64396ae): the 404 for /fast-credit bypassed: "the fast-credit route is retired" fails.