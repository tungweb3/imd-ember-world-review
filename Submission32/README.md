# Submission32: paid delivery from Workers, and the Celestao wait text (World 0c15374, Celestao 382a266; deployed before review)

World source `0c15374` and Celestao source `382a266`. **Both are already live**, at the owner's choice, because the first real paid order was stuck: World `deba7cc` (Worker version `c9a77feb`; `0c15374` only adds the overlay mirror, which is not in the Worker bundle) and Celestao image `db6ade9629ba`.

Read [AUDIT_REQUEST.md](AUDIT_REQUEST.md) first.

- [patches/](patches/): the World commits after Submission31 and their diff from `69ad4b5`; the Celestao commit `382a266`.
- [source/](source/): final versions of the 9 World files changed since `69ad4b5`, and 73 unchanged files carried over from Submission31.
- [celestao/](celestao/): the 3 Celestao web files of `382a266`, as deployed.
- [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json): SHA-256 and private blob ids of everything in `source/` and `celestao/`.
- [evidence/](evidence/): test results and the production timeline.
- [REDACTIONS.md](REDACTIONS.md): what differs from the private repositories.
