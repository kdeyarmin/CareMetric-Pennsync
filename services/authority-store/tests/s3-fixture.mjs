export const s3Fields = (overrides = {}) => ({
  patient_name: 'Synthetic Agency A One', priority: 'normal', document_type: 'manual',
  status: 'new', requires_manual_review: true, manually_confirmed: false, ...overrides,
});
export const s3Tables = ['s3_referral', 's3_receipt'];
