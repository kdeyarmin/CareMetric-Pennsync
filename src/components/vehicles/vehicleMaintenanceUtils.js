export const SERVICE_TYPES = Object.freeze({
  oil_change: 'Oil / filter change', tires: 'Tires / rotation', brakes: 'Brakes',
  inspection: 'Inspection / emissions', scheduled_maintenance: 'Scheduled maintenance',
  repair: 'Repair', other: 'Other service',
});
export const VEHICLE_STATUSES = Object.freeze({ active: 'Active', out_of_service: 'Out of service', retired: 'Retired' });
export const REVIEW_STATUSES = Object.freeze({ pending: 'Not yet reviewed', reviewed: 'Reviewed', needs_follow_up: 'Needs follow-up' });

export function todayLocal(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function parseCostCents(value) {
  const input = String(value ?? '').trim();
  if (!input) return undefined;
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) throw new Error('Enter a cost such as 89.95, or leave it blank if unknown.');
  const [dollars, cents = ''] = input.split('.');
  const result = Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 100000000) throw new Error('Cost must be no more than $1,000,000.');
  return result;
}
export function money(cents) {
  return cents == null ? 'Not entered' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
export function serviceDate(value) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${month}/${day}/${year}` : 'Not entered';
}
export function vehicleTitle(vehicle) {
  return [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ');
}
export function summarizeEntries(entries, baseline = 0) {
  return entries.reduce((summary, entry) => ({
    entries: summary.entries + 1,
    knownCostCents: summary.knownCostCents + (Number.isSafeInteger(entry.cost_cents) ? entry.cost_cents : 0),
    missingCosts: summary.missingCosts + (entry.cost_cents == null ? 1 : 0),
    awaitingReview: summary.awaitingReview + (entry.review_status !== 'reviewed' ? 1 : 0),
    odometer: Math.max(summary.odometer, Number.isFinite(entry.odometer) ? entry.odometer : 0),
  }), { entries: 0, knownCostCents: 0, missingCosts: 0, awaitingReview: 0, odometer: baseline || 0 });
}
