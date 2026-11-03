# Submission23: the annual reading as the sixth Celestao GOLD product (not deployed)

World source `754ef44`, two commits after `d5d7912`, the version live now (Worker `8ff52b03`). **Not deployed.** Production has no Celestao checkout and no fortune order yet.

Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md). Then:

- [patches/](patches/): the commits, plus the diff from `d5d7912`.
- [source/](source/): final versions of the 17 modified files, and 15 unchanged files needed to read them. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives their blob ids.
- [evidence/](evidence/): test results at `754ef44`.
- [REDACTIONS.md](REDACTIONS.md): what differs from the private repository.

**This is the first time the Celestao payment overlay and World's server side of its checkout are public.** No earlier Swarm review has read them.

Submissions 19 to 22 cover the Genesis GOLD ledger on another branch. That branch is not in this source and is not deployed; migration number 0022 is reserved for it. The public snapshot is identified by the commit of this repository that contains this folder.
