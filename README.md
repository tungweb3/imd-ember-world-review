# Ember World shared GOLD local Audit candidate

This is the selected source projection prepared for the user-authorized GitHub publication and Swarm review of local candidate 57ce2d598eedf2ded2a2080582efcd29b4214adb. It has not been submitted to a paid audit or deployed. See SCOPE.md, REQUIREMENTS.md and LOCAL_TESTS.md before making any release conclusion.

Install Node 24 and run npm ci separately in contracts and world-source with their exact lockfiles. Run node tools/verify-source.mjs, then node tools/run-review-tests.mjs. Python 3.12 stdlib: cd aimarket and python -m unittest -v test_world_trial. For native local D1 run world-source/scripts/world-gold-native-d1.mjs from world-source after installing its locked dependencies. No public RPC or real wallet is required by these commands.

The selected World context is not a standalone full World web build. Full artwork/assets and unrelated renderer tests are intentionally excluded; their separate full-workspace evidence is recorded in LOCAL_TESTS.md. Portable package reproduction is reported separately from original workspace test results.
