import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const today = new Date();
    // Constrain to the relevant expiration window BEFORE the row cap, then sort
    // ascending. A plain ascending list would let a historical backlog of
    // already-expired credentials (which accumulates without bound over time)
    // fill the 5000-row cap and starve the upcoming renewals this job exists to
    // notify about. The window spans recently-expired (for the digest) through
    // the furthest reminder horizon (90 days out).
    const windowStart = new Date(today); windowStart.setDate(today.getDate() - 90);
    const windowEnd = new Date(today); windowEnd.setDate(today.getDate() + 90);
    const startStr = windowStart.toISOString().split('T')[0];
    const endStr = windowEnd.toISOString().split('T')[0];
    const credentials = await base44.asServiceRole.entities.PersonnelCredential.filter(
      { expiration_date: { $gte: startStr, $lte: endStr } },
      'expiration_date',
      5000
    );

    const notificationsSent = [];

    // Collect items per-admin so admins get a consolidated upcoming-expiration digest.
    const adminDigestItems = [];

    for (const cred of credentials) {
      if (!cred.expiration_date || cred.status === 'expired') continue;

      const expirationDate = new Date(cred.expiration_date);
      const daysUntilExpiry = Math.floor((expirationDate - today) / (1000 * 60 * 60 * 24));

      // Anything expiring within 90 days (or already expired) goes into the admin digest.
      if (daysUntilExpiry <= 90) {
        adminDigestItems.push({
          user_name: cred.user_name || cred.user_id,
          title: cred.title,
          item_type: cred.item_type,
          expiration_date: cred.expiration_date,
          daysUntilExpiry,
        });
      }

      // Send renewal request at 90, 60, 30, 14, and 7 days before expiration.
      // Determine which tiers are newly crossed in ONE pass. Iterating and
      // updating per-offset previously read a stale local `remindersSent`, so a
      // credential first seen at <=7 days fired all four tiers at once (and the
      // per-iteration write overwrote the tracking, causing repeats every run).
      const reminderOffsets = [90, 60, 30, 14, 7];
      const remindersSent = cred.reminder_offsets_sent || [];
      const dueOffsets = reminderOffsets.filter(
        (offset) => daysUntilExpiry <= offset && !remindersSent.includes(offset)
      );

      if (dueOffsets.length > 0) {
        const userRecord = await base44.asServiceRole.entities.User.filter({ email: cred.user_id });

        if (userRecord && userRecord.length > 0) {
          const userName = userRecord[0].full_name || cred.user_id;

          // One consolidated email per run; the body already shows the real
          // days remaining. Per-credential try/catch so one failed send (bad
          // address, provider error) doesn't strand every later reminder.
          try {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: cred.user_id,
            subject: `🔔 Credential Renewal Required: ${cred.title}`,
            body: `Dear ${userName},

Your ${cred.title} is expiring soon and requires renewal.

Credential: ${cred.title}
Issued By: ${cred.issuing_organization || 'N/A'}
Expiration Date: ${new Date(cred.expiration_date).toLocaleDateString()}
Days Remaining: ${daysUntilExpiry}

Please take action:
1. Go to your Personnel File in the app
2. Upload your renewed credential document
3. Submit for admin approval

Failure to renew before expiration may affect your assignment eligibility.

If you need assistance, please contact your supervisor.

Thank you,
Credential Management System`
          });

          // Record every newly-crossed tier so they are never re-sent.
          await base44.asServiceRole.entities.PersonnelCredential.update(cred.id, {
            reminder_offsets_sent: [...remindersSent, ...dueOffsets],
            last_reminder_sent_at: new Date().toISOString()
          });

          notificationsSent.push({
            user_id: cred.user_id,
            credential: cred.title,
            days_until_expiry: daysUntilExpiry,
            offsets: dueOffsets
          });
          } catch (sendErr) {
            console.error(`Failed to send renewal reminder for credential ${cred.id}:`, sendErr?.message || sendErr);
          }
        }
      }
    }

    // Send a consolidated 90-day expiration digest to all admins.
    let adminDigestSent = 0;
    if (adminDigestItems.length > 0) {
      const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
      adminDigestItems.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

      const rows = adminDigestItems.map((i) => {
        const when = i.daysUntilExpiry < 0
          ? `EXPIRED ${Math.abs(i.daysUntilExpiry)} days ago`
          : `${i.daysUntilExpiry} days remaining`;
        return `• ${i.user_name} — ${i.title} (${i.item_type}) — expires ${new Date(i.expiration_date).toLocaleDateString()} (${when})`;
      }).join('\n');

      for (const admin of admins) {
        try {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: admin.email,
            subject: `🗂️ Personnel Expiration Digest — ${adminDigestItems.length} item(s) within 90 days`,
            body: `The following personnel file items are expired or expiring within the next 90 days:\n\n${rows}\n\nReview them in the Personnel File → Credential Compliance report.`
          });
          adminDigestSent++;
        } catch (digestErr) {
          console.error(`Failed to send admin digest to ${admin.email}:`, digestErr?.message || digestErr);
        }
      }
    }

    return Response.json({
      success: true,
      notifications_sent: notificationsSent.length,
      admin_digests_sent: adminDigestSent,
      details: notificationsSent
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});