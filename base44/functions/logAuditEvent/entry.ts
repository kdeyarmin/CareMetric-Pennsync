import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    let user;
    try {
        const base44 = createClientFromRequest(req);
        user = await base44.auth.me();

        if (!user) {
            console.error('[logAuditEvent] Unauthorized access attempt');
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { 
            action, 
            entity_type, 
            entity_id, 
            affected_data,
            previous_data,
            ip_address,
            user_agent,
            description 
        } = body;

        if (!action || !entity_type) {
            console.error('[logAuditEvent] Missing required fields: action or entity_type', { action: !!action, entity_type: !!entity_type });
            return Response.json({ error: 'action and entity_type are required' }, { status: 400 });
        }

        // Determine sensitivity level
        const sensitiveTables = ['Patient', 'Visit', 'HealthRecord', 'User', 'TelehealthMessage', 'Message', 'Immunization'];
        const isSensitive = sensitiveTables.includes(entity_type);

        // Create audit trail entry
        const auditEntry = await base44.asServiceRole.entities.AuditTrail.create({
            user_email: user.email,
            user_name: user.full_name,
            user_role: user.role,
            action: action,
            entity_type: entity_type,
            entity_id: entity_id || null,
            affected_data: affected_data || null,
            previous_data: previous_data || null,
            ip_address: ip_address || null,
            user_agent: user_agent || null,
            description: description || null,
            is_sensitive: isSensitive,
            timestamp: new Date().toISOString()
        });

        console.log('[logAuditEvent] Audit logged:', { action, entity_type, user: user.email });

        return Response.json({ 
            success: true, 
            audit_id: auditEntry.id 
        });

    } catch (error) {
        console.error('[logAuditEvent] Error:', {
            message: error.message,
            stack: error.stack,
            userEmail: user?.email
        });
        return Response.json({ 
            error: 'Failed to log audit event',
            details: error.message 
        }, { status: 500 });
    }
});