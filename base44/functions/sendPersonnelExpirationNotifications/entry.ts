import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const reminderOffsets = [90, 60, 30, 14];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: opt-in lockdown for this privileged scheduled job (mirrors
    // processTrainingRenewals / syncFaxStatuses). When INTERNAL_FN_SECRET is set,
    // require an admin OR the internal-secret header; the no-identity cron path is
    // allowed only while no secret is configured.
    const me = await base44.auth.me().catch(() => null);
    const isAdmin = me?.role === 'admin';
    const internalSecret = Deno.env.get('INTERNAL_FN_SECRET');
    if (internalSecret) {
      if (!isAdmin && req.headers.get('x-internal-secret') !== internalSecret) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (me && !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const today = new Date();
    // Constrain to the relevant expiration window BEFORE the row cap, then sort
    // ascending. A plain ascending list would let a historical backlog of
    // already-expired credentials (which accumulates without bound over time)
    // fill the 1000-row cap and starve the upcoming expirations this job exists
    // to notify about. The window spans recently-expired (so the status->expired
    // flip below still fires) through the furthest reminder horizon (90 days).
    const windowStart = new Date(today); windowStart.setDate(today.getDate() - 90);
    const windowEnd = new Date(today); windowEnd.setDate(today.getDate() + 90);
    const startStr = windowStart.toISOString().split('T')[0];
    const endStr = windowEnd.toISOString().split('T')[0];
    const items = await base44.asServiceRole.entities.PersonnelCredential.filter(
      { expiration_date: { $gte: startStr, $lte: endStr } },
      'expiration_date',
      1000
    );
    const users = await base44.asServiceRole.entities.User.list('-created_date', 400);
    let notificationsSent = 0;
    const notificationsToCreate = [];
    const updates = [];
    const emailPromises = [];

    for (const item of items) {
      if (!item.expiration_date || !item.user_id) continue;
      const expiration = new Date(`${item.expiration_date}T00:00:00Z`);
      const daysUntilExpiration = Math.ceil((expiration.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const sentOffsets = Array.isArray(item.reminder_offsets_sent) ? item.reminder_offsets_sent : [];

      if (daysUntilExpiration < 0 && item.status !== 'expired') {
        updates.push(base44.asServiceRole.entities.PersonnelCredential.update(item.id, { status: 'expired' }));
      }

      // Fire AT or BELOW an unsent tier rather than on an exact-day match, so a
      // missed cron run (downtime/deploy/DST) doesn't skip a tier permanently;
      // per-record reminder_offsets_sent still prevents re-sending a fired tier.
      // Only remind before expiration (the status->expired update is above).
      const dueOffsets = daysUntilExpiration >= 0
        ? reminderOffsets.filter((o) => daysUntilExpiration <= o && !sentOffsets.includes(o))
        : [];
      if (dueOffsets.length === 0) continue;

      const employee = users.find((user) => user.email === item.user_id);
      const agencyAdmins = users.filter((user) => user.account_type === 'agency_admin' && (!employee?.agency_name || user.agency_name === employee.agency_name));

      notificationsToCreate.push({
        user_email: item.user_id,
        title: `${item.title} expires in ${daysUntilExpiration} days`,
        message: `Your ${item.item_type} "${item.title}" expires on ${new Date(item.expiration_date).toLocaleDateString()}. Please upload a renewed copy to your personnel file.`,
        type: 'compliance_alert',
        priority: daysUntilExpiration <= 30 ? 'high' : 'medium',
        action_url: '/PersonnelFile',
        action_label: 'Open personnel file',
        metadata: { personnel_credential_id: item.id, days_until_expiration: daysUntilExpiration }
      });

      emailPromises.push(() => 
        base44.asServiceRole.integrations.Core.SendEmail({
          to: item.user_id,
          subject: `${item.title} expires in ${daysUntilExpiration} days`,
          body: `Your ${item.item_type} "${item.title}" expires on ${new Date(item.expiration_date).toLocaleDateString()}. Please upload a renewed copy to your personnel file for approval.`,
          from_name: 'Penn Sync HR'
        }).catch(err => console.error("Email failed:", err.message))
      );

      for (const manager of agencyAdmins) {
        notificationsToCreate.push({
          user_email: manager.email,
          title: `Employee personnel file item expires in ${daysUntilExpiration} days`,
          message: `${item.user_name || item.user_id} has a ${item.item_type} item (${item.title}) expiring on ${new Date(item.expiration_date).toLocaleDateString()}.`,
          type: 'compliance_alert',
          priority: daysUntilExpiration <= 30 ? 'high' : 'medium',
          action_url: '/PersonnelFile',
          action_label: 'Review personnel file',
          metadata: { personnel_credential_id: item.id, employee_email: item.user_id, days_until_expiration: daysUntilExpiration }
        });

        emailPromises.push(() => 
          base44.asServiceRole.integrations.Core.SendEmail({
            to: manager.email,
            subject: `Personnel file expiration reminder: ${item.user_name || item.user_id}`,
            body: `${item.user_name || item.user_id} has a ${item.item_type} item (${item.title}) expiring on ${new Date(item.expiration_date).toLocaleDateString()}.`,
            from_name: 'Penn Sync HR'
          }).catch(err => console.error("Manager email failed:", err.message))
        );
      }

      updates.push(
        base44.asServiceRole.entities.PersonnelCredential.update(item.id, {
          reminder_offsets_sent: [...sentOffsets, ...dueOffsets],
          last_reminder_sent_at: new Date().toISOString()
        })
      );
      notificationsSent++;
    }

    if (notificationsToCreate.length > 0) {
      await base44.asServiceRole.entities.Notification.bulkCreate(notificationsToCreate);
    }
    
    // Process updates concurrently
    await Promise.all(updates);

    // Process emails in chunks to respect rate limits and save time
    for (let i = 0; i < emailPromises.length; i += 10) {
      const chunk = emailPromises.slice(i, i + 10);
      await Promise.all(chunk.map(fn => fn()));
    }

    return Response.json({ success: true, notifications_sent: notificationsSent });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});