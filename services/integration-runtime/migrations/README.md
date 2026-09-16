# Integration state migration history

The two initial migrations were applied through the Supabase connector before the interrupted Git push. They created only `cm_integration_jobs`, `cm_integration_files`, the four service-only integration RPCs and the private integration bucket plus its restrictive browser exclusion. They are not claimed to have been recovered as original files in this branch. Do not blindly recreate these resources on the existing project.

The recovery readback confirmed empty tables, enabled RLS, revoked browser access, exact service-only RPC identities, private bucket and restrictive policy. Exact installed SQL definitions can be exported read-only from PostgreSQL for a fresh-environment bootstrap; a new environment must not be treated as provisioned merely from this directory.

003_result_retention.sql records the later applied retention migration. Its rollback-only hosted test verified that unexpired ciphertext stays intact, expired ciphertext is cleared, completed idempotency evidence remains, a retry cannot start another paid job, and browser roles cannot invoke cleanup. The new named hourly job was then registered and read back active. No customer data existed in these new tables during the test. Cleanup is bounded to 1000 rows per run; 24-hour logical result expiry is immediate, while physical clearing can lag by the schedule or a larger backlog.
