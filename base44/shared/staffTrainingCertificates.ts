export async function staffTrainingCertificates(entities, items, emails, identities) {
  if (!items.length) return items;
  const ids = new Set(items.map(row => row.id));
  const scopedEmails = emails.filter(email => ids.has(identities.get(String(email).trim().toLowerCase())?.id));
  const certificates = await entities.TrainingCertificate.aggregate({
    query: { user_id: { $in: scopedEmails }, revoked: { $ne: true }, issued_at: { $exists: true, $lte: new Date().toISOString() }, certificate_id: { $exists: true, $nin: ['', null] } },
    groupBy: 'user_id', limit: 1000,
  });
  if (certificates.truncated) throw new Error('Staff certificate summary exceeds the reporting limit.');
  const totals = new Map();
  for (const row of certificates.rows) {
    const identity = identities.get(String(row.user_id || '').trim().toLowerCase());
    if (!identity || !ids.has(identity.id)) throw new Error('Certificate staff identity could not be verified.');
    totals.set(identity.id, (totals.get(identity.id) || 0) + (Number(row.count) || 0));
  }
  return items.map(row => ({ ...row, certificates_earned: totals.get(row.id) || 0 }));
}