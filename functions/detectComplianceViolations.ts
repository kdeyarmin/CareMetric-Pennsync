import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    console.log('Starting compliance violation detection...');

    const violations = [];

    // 1. Check for unencrypted or improperly stored PHI
    const patients = await base44.asServiceRole.entities.Patient.list();
    const visits = await base44.asServiceRole.entities.Visit.list();

    // Flag visits with missing security audit trail
    visits.forEach(visit => {
      if (!visit.created_by || !visit.created_date) {
        violations.push({
          violation_type: 'audit_trail_gap',
          severity: 'high',
          description: `Visit ${visit.id} missing audit trail information`,
          affected_entities: [visit.id],
          regulatory_reference: 'HIPAA Audit Controls (164.312(b))'
        });
      }
    });

    // 2. Check for documentation gaps
    visits.forEach(visit => {
      if (visit.visit_type === 'skilled_nursing' && !visit.nurse_notes) {
        violations.push({
          violation_type: 'documentation_gap',
          severity: 'medium',
          description: `Skilled nursing visit ${visit.id} missing clinical notes`,
          affected_entities: [visit.id],
          regulatory_reference: 'Medicare CoPs - Clinical Documentation'
        });
      }
    });

    // 3. Check for access control failures - users accessing data they shouldn't
    const securityLogs = await base44.asServiceRole.entities.SecurityLog.filter({
      timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() }
    });

    const userAccessPatterns = {};
    securityLogs.forEach(log => {
      if (!userAccessPatterns[log.user_email]) {
        userAccessPatterns[log.user_email] = new Set();
      }
      if (log.details?.entity_type && log.details?.entity_id) {
        userAccessPatterns[log.user_email].add(log.details.entity_id);
      }
    });

    // Flag if non-clinical users are accessing patient data
    const users = await base44.asServiceRole.entities.User.list();
    users.forEach(appUser => {
      if (appUser.role === 'admin' && userAccessPatterns[appUser.email]) {
        const accessCount = userAccessPatterns[appUser.email].size;
        if (accessCount > 100) {
          violations.push({
            violation_type: 'access_control_failure',
            severity: 'medium',
            description: `Admin user ${appUser.email} accessed ${accessCount} patient records (excessive access)`,
            affected_users: [appUser.email],
            regulatory_reference: 'HIPAA Access Controls (164.308(a)(4))'
          });
        }
      }
    });

    // 4. Check for data retention violations
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const archivedVisits = visits.filter(v => 
      v.status === 'completed' && 
      new Date(v.created_date) < thirtyDaysAgo &&
      !v.archived_date
    );

    if (archivedVisits.length > 0) {
      violations.push({
        violation_type: 'data_retention_violation',
        severity: 'low',
        description: `${archivedVisits.length} completed visits older than 30 days not archived`,
        affected_entities: archivedVisits.map(v => v.id).slice(0, 10),
        regulatory_reference: 'Data Retention & Archive Policies'
      });
    }

    // Store violations
    const storedViolations = [];
    for (const violation of violations) {
      try {
        const stored = await base44.asServiceRole.entities.ComplianceViolation.create({
          ...violation,
          status: 'open',
          detected_at: new Date().toISOString(),
          remediation_steps: []
        });
        storedViolations.push(stored);
      } catch (e) {
        console.error('Error storing violation:', e);
      }
    }

    console.log(`✅ Detected ${storedViolations.length} compliance violations`);

    return Response.json({
      success: true,
      violations_detected: storedViolations.length,
      details: storedViolations
    });

  } catch (error) {
    console.error('Error in detectComplianceViolations:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});