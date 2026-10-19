# Ember World Audit11: f5a3b8f9 fixes

Producing World source `5dedb6f160ba29f123bf1fd719e92b0ad9c5dc32`. Start with CURRENT_STATUS.md, SCOPE.md,
world-source/docs/audit10-f5a3b8f9-remediation.md and the manifests. Original
report, exact bounded patch and eight baseline red reproductions are retained.
Older evidence is historical, not this source's acceptance.

Node24/Python3: install the world-source and contracts exact lockfiles; run
npm run verify:source, npm run verify:privacy and npm test at the packet root.
No models/media, private database, credentials or private Git history is exported.
No public-chain transaction or real wallet signature is needed for these tests.
This local packet does not publish a GitHub ref or pay/submit an Audit.
