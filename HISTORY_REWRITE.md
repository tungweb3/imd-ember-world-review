# History rewrite of main (2026-11-09)

On 2026-11-09 the history of `main` was rewritten to remove account identifiers and a personal e-mail address that had been published by mistake:

- `SubmissionN/source/wrangler.jsonc` in Submission28 to Submission31 is now masked the same way as Submission13 and Submission32 (the account comment, `account_id` and `database_id`); their `SOURCE_MANIFEST.json` entries carry `masked: true` and the SHA-256 of the masked copy, which equals the Submission32 copy.
- The author and committer e-mail of the four commits of Submission19 to Submission22 is now the GitHub noreply address.

Nothing else changed: every other file is byte-identical, and commit messages and dates are kept. Commits up to Submission19 `c7f2d4d` keep their ids. Later commits got new ids:

| Old id | New id | Commit |
|---|---|---|
| `4ef9329` | `025afd7` | Submission32: paid delivery from Workers (redirect:'manual') and the C… |
| `e42b9f1` | `2e1ba27` | Submission31: fixes for audit 48111df0 (3 Info), published for the rec… |
| `f8be803` | `6ae855a` | Submission30: fixes for audit 85163d96 of the 鼠道修仙 GOLD store … |
| `848bb41` | `4eb01ee` | Submission29: fixes for audit 64b1ce06 of the 鼠道修仙 GOLD store … |
| `06e391d` | `c553b37` | Submission28: fixes for audit 447bb70d, two links to 鼠道修仙, and… |
| `0fd094a` | `34eec20` | Submission27: fixes for audit 447bb70d on Submission26 (World a3abbf7,… |
| `9dc6831` | `6b4f246` | Submission26: the Submission25 scope again, its reviewers' fixes, priv… |
| `4565a1e` | `f404b15` | Submission25: per-grant signature, fixes for audit 37a926e3, and pre-s… |
| `4343691` | `fe5a262` | Submission24: fixes for audit 521bc017 and an administrator GOLD grant… |
| `adc6061` | `833a9f3` | Submission23: the annual reading as the sixth Celestao GOLD product (W… |
| `01a70ce` | `8d0f88a` | Submission22: remediation of audit 93dae57f (World 7d09bda, not deploy… |
| `7024d8f` | `ad4ddee` | Submission21: fixes for audit e3e9b712 (World 6be9ef3, not deployed) |
| `a28c1e7` | `d4ad513` | Submission20: fixes for audit 8febfeed; the paid order names its payme… |
| `bfea564` | `f4252e4` | Submission19: World source 7939c37 (repeated added-token GOLD prices r… |

Audit jobs that cite an old id refer to the commit in the same row. The other branches were not changed.
