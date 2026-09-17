import { differenceInCalendarDays } from 'date-fns';
import { parseLocalDate } from '@/lib/dateLocal';

export const EMPTY_REPORT_ROWS = Object.freeze([]);
export const REPORT_READ_OPTIONS = Object.freeze({ retry: false });

const optionalText = value => value == null || typeof value === 'string';
const optionalNumber = value => value == null || (typeof value === 'number' && Number.isFinite(value));
const fields = {
  users: { text: ['email', 'full_name', 'role'] },
  notes: { text: ['nurse_email', 'visit_type'], date: ['created_date'], number: ['conversion_time_ms', 'quality_score', 'rough_note_compliance', 'enhanced_note_compliance'] },
  audits: { text: ['nurse_email'], date: ['audit_date', 'created_date'], number: ['compliance_score'] },
  assignments: { text: ['assigned_to_user_id', 'course_id', 'status', 'pass_fail_result'], date: ['completion_date'], number: ['score_percentage'] },
  modules: { text: ['title', 'course_id', 'category'] },
  recommendations: { boolean: ['addressed'] },
};

function validReportDate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match || !parseLocalDate(match[1])) return false;
  if (match[2] && (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59)) return false;
  return parseLocalDate(value) !== null;
}

export function readReportRows(value, kind) {
  const shape = Object.hasOwn(fields, kind) ? fields[kind] : null;
  const ids = new Set();
  if (!shape || !Array.isArray(value) || value.some(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || typeof row.id !== 'string' || !row.id || row.id.trim() !== row.id || ids.has(row.id)
      || !(shape.text || []).every(key => optionalText(row[key]))
      || !(shape.number || []).every(key => optionalNumber(row[key]))
      || !(shape.boolean || []).every(key => row[key] == null || typeof row[key] === 'boolean')
      || !(shape.date || []).every(key => row[key] == null || row[key] === '' || validReportDate(row[key]))) return true;
    if (kind === 'notes' && !row.created_date) return true;
    if (kind === 'audits' && !row.audit_date && !row.created_date) return true;
    ids.add(row.id);
    return false;
  })) throw new Error('REPORT_READ_INVALID');
  return value;
}

export function reportRangeAvailable(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  const from = parseLocalDate(start);
  const to = parseLocalDate(end);
  if (!from || !to) return false;
  const span = differenceInCalendarDays(to, from);
  return span >= 0 && span < 366;
}

export function measuredAverage(rows, pick) {
  const values = rows.map(pick).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function displayMeasurement(value, unit = '', decimals = 1) {
  return value == null || !Number.isFinite(Number(value)) ? 'Not measured' : `${Number(value).toFixed(decimals)}${unit}`;
}
