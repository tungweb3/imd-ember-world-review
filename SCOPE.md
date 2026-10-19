# Selected review scope

Fixed World source `e5f17432152670e5516f09fade16f2720b86dcb4`. Full existing selected economy, shared GOLD,
Mint integration, inventory, campaign and authenticated provider scope is
retained. Added helper and both regression files are byte-exact. Source and
auxiliary manifests pin every file; unchanged contracts, Mint and Python
provider sources retain their existing provenance/adaptations.

Review the entire chain of admission, signature, debit, delivery and recovery.
The public packet is curated; it omits unrelated World3D/AV assets and full
frontend/deployment tests that require the private source/assets/history.
Those run independently in the producing checkout. No app-facing or production
secret/config values are introduced by this patch.
