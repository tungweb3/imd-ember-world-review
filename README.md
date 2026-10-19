# Ember World audit9: post-release review remediation

Producing World source: `1015b2c5c8663c6c4bfb46f135be84cacea1cae0`. Start with SCOPE.md,
world-source/docs/release-review-fixes-20261019.md, CURRENT_STATUS.md and the
source/auxiliary/portable-adaptation manifests. Exact English form text is in
AUDIT_OBJECTIVE.en.txt. The root itself is the curated review package.

With Node24 and Python3, install world-source dependencies from its exact lock
and contracts dependencies from their exact lock. Run `npm run verify:source`,
`npm run verify:privacy`, and `npm test`. The contracts runner rebuilds the
vendored compiler output; the financial runner selects only the declared tests.
Python tests require a writable isolated temporary directory. No user wallet,
real credentials, production database or public-chain transaction is required.

No3D/AV assets, production DBs, private history or keys are included. A real
GitHub ref must exist before the Audit form is filled; an unpublished SHA is not
a usable repository link. No report in this packet claims Swarm accepted this
version. Preserve explicit production-capacity and backup/restore limitations.
