/**
 * The four crossable reads, and the one line that closes them.
 *
 * `20260920590000_chart_agency.sql` carries a copy of four functions that
 * already live in `20260920580000_contract_operational_tables.sql`, because a
 * merged migration is never edited in place (D88) and a forward one has to
 * restate the whole body. A copy that is TYPED drifts in the one direction
 * nothing measures, so it is derived from the merged file instead — the shape
 * `tools-pennsync-record-catchup.mjs` uses for the same reason.
 *
 * `--emit` prints the four forward bodies. `contract-chart-agency.test.mjs`
 * re-derives them and fails if the shipped migration is not exactly this.
 */
import { readFileSync } from 'node:fs';

export const OPERATIONAL = 'services/authority-store/supabase/record-migrations/'
  + '20260920580000_contract_operational_tables.sql';

/**
 * Each read, with the LAST line of its own `where` clause. The term goes after
 * that line and nothing else moves. `contract_care_plan_list` is not here:
 * `care_plan` has no `agency_id`, so its tenancy is the chart and the contract
 * already joins `patient`.
 */
export const CROSSABLE = Object.freeze([
  { name: 'contract_task_list', alias: 't',
    anchor: '      and (p_exclude_status is null or t."status" is distinct from p_exclude_status)' },
  { name: 'contract_face_to_face_list', alias: 'e',
    anchor: '      and (p_referral_id is null or e."referral_id" = p_referral_id)' },
  { name: 'contract_document_record_list', alias: 'd',
    anchor: '        or pg_catalog.lower(coalesce(d."created_by", \'\')) = v_email)' },
  { name: 'contract_note_conversion_list', alias: 'n',
    anchor: '        or pg_catalog.lower(coalesce(n."created_by", \'\')) = v_email)' },
]);

export const term = alias =>
  `      and "pennsync_records".chart_not_elsewhere(${alias}."patient_id", p_agency)`;

/** The body as the merged migration holds it, and not one byte further. */
export function originalBody(sql, name) {
  const open = sql.indexOf(`create function "pennsync_records".${name}(`);
  if (open < 0) throw new Error(`no such contract: ${name}`);
  const close = sql.indexOf('\nend $contract$;\n', open);
  if (close < 0) throw new Error(`unterminated: ${name}`);
  return sql.slice(open, close + '\nend $contract$;\n'.length);
}

export function forwardBody(body, { alias, anchor }) {
  if (!body.startsWith('create function ')) throw new Error('unexpected opening');
  if (!body.includes(`${anchor}\n`)) throw new Error(`anchor not found: ${anchor}`);
  return `create or replace ${body.slice('create '.length)
    .replace(`${anchor}\n`, `${anchor}\n${term(alias)}\n`)}`;
}

export function forwardBodies(sql) {
  return CROSSABLE.map(contract =>
    forwardBody(originalBody(sql, contract.name), contract)).join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('tools-chart-agency-forward.mjs')
  && process.argv[2] === '--emit') {
  process.stdout.write(forwardBodies(readFileSync(OPERATIONAL, 'utf8')));
}
