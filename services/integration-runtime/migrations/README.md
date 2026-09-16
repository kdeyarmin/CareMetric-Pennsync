# Integration state migration history

The first two migrations were applied through Supabase before an interrupted source push. They created cm_integration_jobs, cm_integration_files, four service-only RPCs and the private bucket with a restrictive browser exclusion. Their original files were not recovered in this branch. Do not blindly recreate existing resources; a fresh environment needs a separately verified export/bootstrap of the installed definitions.

Recovery readback confirmed empty tables, RLS, revoked browser access, exact RPC identities and a private bucket. No customer files or clinical records were copied.

003_result_retention.sql records bounded cleanup of expired ciphertext. Its rollback-only hosted test preserved unexpired results, cleared expired bytes and retained completed idempotency evidence. Browser roles cannot invoke cleanup. The named hourly job was registered/read back active. Logical 24-hour expiry is immediate; physical clearing can lag the schedule or a backlog exceeding 1000 rows per run.

004_preexecution_retry.sql adds an attempt counter and a server-only daily budget. Only a job marked failed before provider execution can be reclaimed under the actor lock. A new claim invalidates the previous owner; at most three attempts are allowed and safe retries count against the daily budget. Pending, uncertain, completed and expired successful jobs remain fenced.

The first hosted rollback-only test exposed a missing p_ prefix in the insert argument. That installed function was corrected immediately while the service remained paused, then the complete test transaction passed. The current 004 file has the correct argument; 005 records the targeted repair and is a no-op for an already-correct fresh installation.

Passing hosted cases: original-job reuse, stale-claim rejection, bounded retry, daily quota, non-replay of uncertain outcomes, completed-result preservation and restricted grants. Synthetic data was rolled back; job/file/budget row counts were zero. This is not a concurrent multi-client performance test or proof of an authenticated PennSync employee round trip.
