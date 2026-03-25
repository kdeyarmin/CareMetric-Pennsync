import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { policy_id, manual = false } = await req.json();

    // Get policy
    const policies = await base44.asServiceRole.entities.DataArchivePolicy.filter(
      { id: policy_id }
    );

    if (policies.length === 0) {
      return Response.json({ error: 'Policy not found' }, { status: 404 });
    }

    const policy = policies[0];

    if (!policy.is_active) {
      return Response.json({ error: 'Policy is not active' }, { status: 400 });
    }

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retention_days);

    // Archive records based on policy
    let archivedCount = 0;
    
    try {
      // Fetch records older than retention period
      const records = await base44.asServiceRole.entities[policy.entity_type].filter({
        updated_date: { $lt: cutoffDate.toISOString() },
        ...(policy.archive_conditions?.status ? { status: policy.archive_conditions.status } : {})
      });

      for (const record of records) {
        // Create archive record
        const archived = await base44.asServiceRole.entities.ArchivedRecord.create({
          original_entity_type: policy.entity_type,
          original_entity_id: record.id,
          archived_data: record,
          archive_policy_id: policy_id,
          archived_by: manual ? user.email : 'system',
          archived_date: new Date().toISOString(),
          original_created_date: record.created_date,
          retention_until: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          status: 'archived',
          metadata: {
            entity_type: policy.entity_type,
            archive_policy: policy.policy_name
          }
        });

        archivedCount++;
      }

      // Update policy statistics
      await base44.asServiceRole.entities.DataArchivePolicy.update(policy_id, {
        last_run: new Date().toISOString(),
        records_archived: (policy.records_archived || 0) + archivedCount
      });

      // Log audit event
      await base44.asServiceRole.entities.AuditTrail.create({
        timestamp: new Date().toISOString(),
        user_email: user.email,
        action: manual ? 'manual_data_archival' : 'automatic_data_archival',
        entity_type: 'DataArchivePolicy',
        entity_id: policy_id,
        changes: {
          records_archived: archivedCount,
          cutoff_date: cutoffDate.toISOString()
        },
        details: {
          policy_name: policy.policy_name,
          entity_type: policy.entity_type
        }
      });

      return Response.json({
        success: true,
        archived_count: archivedCount,
        policy_name: policy.policy_name,
        cutoff_date: cutoffDate.toISOString(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`Error archiving ${policy.entity_type}:`, error);
      return Response.json({
        error: `Failed to archive ${policy.entity_type}`,
        details: error.message
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in executeDataArchival:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});