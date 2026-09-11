# Backup and restore rehearsal

| | |
| --- | --- |
| **BACKUP + RESTORE REHEARSAL** | **PASS** — executed, verified |
| **`db:backup` verify lane** | **BLOCKED_ENVIRONMENT** — precise reason below |
| **`db:restore:rehearsal` verify lane** | **BLOCKED_ENVIRONMENT** — depends on the above |

The capability is proven. The repository's *lane* still cannot run, and the two
are reported separately rather than one being used to excuse the other.

## How it was executed

The host has no PostgreSQL client tools and §22 forbids installing them
automatically. The container already ships them, which also satisfies the
rule that the client must not be older than the server:

```
docker exec mohalla-postgres pg_dump --version
pg_dump (PostgreSQL) 18.6 (Debian 18.6-1.pgdg13+2)
```

| Step | Command | Result |
| --- | --- | --- |
| Backup | `pg_dump --format=custom --no-owner` inside the container | **6,678,575 bytes** |
| Target | `createdb mohalla_restore_rehearsal` — a **new, disposable** database | created |
| Restore | `pg_restore --no-owner --dbname …_rehearsal` | exit 0 |
| Teardown | `DROP DATABASE mohalla_restore_rehearsal` | dropped |

**The active database was never a restore target.** The restore went into a
database created for the purpose and destroyed afterwards; `mohalla` was
verified untouched at 8,704 users after teardown.

Synthetic QA data only — this database contains nothing but fixtures created by
this stage and its predecessors.

## What was verified, beyond an exit code

### Row counts, every table that matters

| Table | Source | Restored |
| --- | --- | --- |
| users | 8,704 | **8,704** |
| profiles | 8,481 | **8,481** |
| posts | 7,455 | **7,455** |
| comments | 403 | **403** |
| conversations | 908 | **908** |
| messages | 980 | **980** |
| moderation_cases | 2,444 | **2,444** |
| notifications | 3,539 | **3,539** |
| audit_log | 2,904 | **2,904** |
| pgmigrations | 24 | **24** |

### Schema and migration level

| | Source | Restored |
| --- | --- | --- |
| Latest migration | `0024_otp_hmac_transition` | **`0024_otp_hmac_transition`** |
| Tables | 39 | **39** |
| Indexes | 111 | **111** |
| Constraints | 376 | **376** |

### Relationships, not just rows

A backup that restores rows but loses the joins is a backup that restores
nothing usable.

| Join | Source | Restored |
| --- | --- | --- |
| posts → users | 7,455 | **7,455** |
| comments → posts | 403 | **403** |
| messages → conversations | 980 | **980** |
| post_media → media | 112 | **112** |

And in the restored copy: **0 orphan posts, 0 orphan messages**.

Audit rows survive in full (2,904), which matters more than most tables — a
backup that dropped the append-only record would defeat the reason it exists.

## Why the verify lanes are still blocked

`packages/db/scripts/backup.mjs` resolves `pg_dump` from `PG_DUMP_BIN` or PATH
and invokes it with `spawnSync(..., { shell: false })`.

A shim delegating to the container was written and tried. It **cannot** work,
for a good reason: `spawnSync` without a shell cannot execute a Windows `.cmd`,
and the script disables the shell deliberately —

> `spawnSync` WITHOUT A SHELL, so the connection URL — which contains a
> password — …

That is the right call and this QA pass will not weaken it to make a lane go
green. Closing the lane needs one of:

1. PostgreSQL client tools on the host PATH (§22 forbids installing them here);
2. a change to the backup script to understand a containerised client — a
   change to **release tooling**, not a QA fix, and the owner's call.

So the lane reason is now precise. It was previously recorded as
`spawnSync pg_dump ENOENT`, which is true but reads like a missing binary; the
binary exists, one process boundary away, and the blocker is how the script is
allowed to reach it.

## Not claimed

- No production or real data was involved at any point.
- The rehearsal proves the **dump/restore pair on this schema**; it does not
  prove an operational runbook, retention, offsite storage, encryption at rest
  or restore-time objectives, none of which were in scope here.
- `RESTORE_TARGET_URL` was not used; the isolated target was created and
  destroyed directly.
