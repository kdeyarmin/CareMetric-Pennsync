// Display vocabulary for signature requests as manageSignatureRequests reports
// them. Status is derived on the server from the member documents.

export const REQUEST_STATUS = Object.freeze({
  awaiting_signatures: { label: 'Awaiting signatures', className: 'bg-amber-100 text-amber-900' },
  partially_signed: { label: 'Partially signed', className: 'bg-sky-100 text-sky-900' },
  sealing: { label: 'Sealing', className: 'bg-indigo-100 text-indigo-900' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-900' },
  cancelled: { label: 'Canceled', className: 'bg-slate-200 text-slate-800' },
  expired: { label: 'Expired', className: 'bg-red-100 text-red-900' },
});

export const OPEN_REQUEST_STATUSES = Object.freeze(['awaiting_signatures', 'partially_signed', 'sealing']);

export const SIGNER_ROLES = Object.freeze([
  { value: 'patient', label: 'Patient' },
  { value: 'caregiver', label: 'Caregiver' },
  { value: 'legal_representative', label: 'Legal representative' },
  { value: 'witness', label: 'Witness' },
  { value: 'provider', label: 'Provider' },
]);

export const DOCUMENT_TYPES = Object.freeze([
  { value: 'consent', label: 'Consent' },
  { value: 'hipaa', label: 'HIPAA acknowledgment' },
  { value: 'treatment_agreement', label: 'Treatment agreement' },
  { value: 'financial_agreement', label: 'Financial agreement' },
  { value: 'advance_directive', label: 'Advance directive' },
  { value: 'release', label: 'Release of information' },
  { value: 'custom_request', label: 'Custom request' },
  { value: 'other', label: 'Other' },
]);

export const LINK_STATUS = Object.freeze({
  active: 'Link sent',
  delivery_pending: 'Sending',
  delivery_indeterminate: 'Delivery needs review',
  delivery_rejected: 'Delivery failed',
  claimed: 'Signing',
  consumed: 'Finished',
  revoked: 'Link replaced or revoked',
  expired: 'Link expired',
});

export function requestStatusLabel(status) {
  return REQUEST_STATUS[status]?.label || 'Unknown';
}

export function signerRoleLabel(role) {
  return SIGNER_ROLES.find((entry) => entry.value === role)?.label || 'Signer';
}

export function isOpenRequest(request) {
  return OPEN_REQUEST_STATUSES.includes(request?.status);
}

/** Calendar date N days from today in the browser's local calendar. */
export function localDatePlusDays(days, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
