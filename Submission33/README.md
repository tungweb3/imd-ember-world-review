# Submission33: fixes for audit 88a680a7 (World 7672dc5, Celestao 2b5f1c2; the Celestao part deployed before review)

World source `7672dc5` and Celestao source `2b5f1c2`. Submission32 was reviewed in job `88a680a7`: 3 Low, 3 Info. Four findings are fixed, two are disclosed and not changed. The Celestao page fix is **already live** (image `59cf266f154b`); the World changes are tests and the Celestao mirror only, so the live World Worker is unchanged (`deba7cc`, version `c9a77feb`).

Read [AUDIT_REQUEST.md](AUDIT_REQUEST.md) first.

- [patches/](patches/): the World commit after Submission32 and its diff from `0c15374`; the Celestao commits `382a266`..`2b5f1c2`.
- [source/](source/): final versions of the 5 World files changed since `0c15374`, and 78 unchanged files carried over from Submission32.
- [celestao/](celestao/): the 3 Celestao web files of `2b5f1c2`, as deployed.
- [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json): SHA-256 and private blob ids of everything in `source/` and `celestao/`.
- [evidence/](evidence/): test results, removal checks and the read-only stuck-order query.
- [REDACTIONS.md](REDACTIONS.md): what differs from the private repositories.
