import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // This function is called by entity automations, so it runs with service role
        const payload = await req.json();
        const { event, data, old_data, payload_too_large } = payload;

        // Determine if this is sensitive data
        const sensitiveTables = ['Patient', 'Visit', 'HealthRecord', 'User', 'TelehealthMessage', 'Message', 'Immunization', 'PatientMessage'];
        const isSensitive = sensitiveTables.includes(event.entity_name);

        // Get user who made the change
        let user_email = 'system';
        let user_name = 'System';
        let user_role = 'system';

        if (data?.created_by) {
            user_email = data.created_by;
            // Try to get user details
            try {
                const users = await base44.asServiceRole.entities.User.filter({ email: user_email });
                if (users.length > 0) {
                    user_name = users[0].full_name || user_email;
                    user_role = users[0].role || 'user';
                }
            } catch (e) {
                console.log('Could not fetch user details:', e);
            }
        }

        // Prepare affected data (mask sensitive fields)
        let affected_data_masked = null;
        let previous_data_masked = null;

        if (!payload_too_large && data) {
            affected_data_masked = maskSensitiveData(event.entity_name, data);
        }

        if (!payload_too_large && old_data && event.type === 'update') {
            previous_data_masked = maskSensitiveData(event.entity_name, old_data);
        }

        // Determine action description
        const actionDescriptions = {
            create: `Created ${event.entity_name} record`,
            update: `Updated ${event.entity_name} record`,
            delete: `Deleted ${event.entity_name} record`
        };

        // Create audit trail entry
        await base44.asServiceRole.entities.AuditTrail.create({
            user_email: user_email,
            user_name: user_name,
            user_role: user_role,
            action: event.type,
            entity_type: event.entity_name,
            entity_id: event.entity_id,
            affected_data: payload_too_large ? { note: 'Data too large, fetch separately' } : affected_data_masked,
            previous_data: payload_too_large ? null : previous_data_masked,
            description: actionDescriptions[event.type],
            is_sensitive: isSensitive,
            timestamp: new Date().toISOString()
        });

        return Response.json({ success: true });

    } catch (error) {
        console.error('Auto audit failed:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// Helper function to mask sensitive data
function maskSensitiveData(entityType, data) {
    if (!data) return null;

    const masked = { ...data };
    
    // Fields to mask
    const sensitiveFields = [
        'social_security_number', 'ssn', 'tax_id',
        'credit_card', 'bank_account',
        'password', 'password_hash', 'token', 'api_key'
    ];

    // Mask sensitive fields
    for (const field of sensitiveFields) {
        if (masked[field]) {
            masked[field] = '***MASKED***';
        }
    }

    // For patient data, keep only essential identifiers
    if (entityType === 'Patient') {
        return {
            id: masked.id,
            first_name: masked.first_name,
            last_name: masked.last_name,
            medical_record_number: masked.medical_record_number,
            action: 'Patient data accessed/modified'
        };
    }

    // For user data, mask email partially
    if (entityType === 'User' && masked.email) {
        const [localPart, domain] = masked.email.split('@');
        masked.email = `${localPart.substring(0, 2)}***@${domain}`;
    }

    return masked;
}