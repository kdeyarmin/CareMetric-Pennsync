import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const payload = await req.json();
    const { signature_ids, start_date, end_date, document_type, format = 'json' } = payload;

    // Build query filter
    let signatures;
    if (signature_ids && signature_ids.length > 0) {
      signatures = await Promise.all(
        signature_ids.map(id => 
          base44.asServiceRole.entities.DigitalSignature.filter({ id }).then(r => r[0])
        )
      );
      signatures = signatures.filter(Boolean);
    } else {
      signatures = await base44.asServiceRole.entities.DigitalSignature.list('-created_date', 1000);
      
      // Apply filters
      if (start_date) {
        signatures = signatures.filter(s => new Date(s.created_date) >= new Date(start_date));
      }
      if (end_date) {
        signatures = signatures.filter(s => new Date(s.created_date) <= new Date(end_date));
      }
      if (document_type) {
        signatures = signatures.filter(s => s.document_type === document_type);
      }
    }

    // Generate comprehensive audit report
    const auditReport = {
      report_generated: new Date().toISOString(),
      generated_by: user.email,
      total_signatures: signatures.length,
      filter_criteria: { start_date, end_date, document_type },
      signatures: signatures.map(sig => ({
        signature_id: sig.id,
        document_type: sig.document_type,
        document_id: sig.document_id,
        signer: {
          name: sig.signer_name,
          email: sig.signer_email,
          role: sig.signed_by_role || 'provider'
        },
        signature_details: {
          method: sig.signature_method,
          timestamp: sig.created_date,
          ip_address: sig.ip_address,
          user_agent: sig.user_agent,
          verification_status: sig.verification_status
        },
        security: {
          mfa_verified: sig.mfa_verified || false,
          mfa_method: sig.mfa_method || 'none',
          consent_agreed: !!sig.consent_text
        },
        witness: sig.witness_email ? {
          email: sig.witness_email,
          has_signature: !!sig.witness_signature_data
        } : null,
        audit_trail: sig.audit_trail || [],
        metadata: sig.metadata || {}
      })),
      compliance_summary: {
        total_with_mfa: signatures.filter(s => s.mfa_verified).length,
        total_with_witness: signatures.filter(s => s.witness_email).length,
        by_document_type: signatures.reduce((acc, s) => {
          acc[s.document_type] = (acc[s.document_type] || 0) + 1;
          return acc;
        }, {}),
        by_role: signatures.reduce((acc, s) => {
          const role = s.signed_by_role || 'provider';
          acc[role] = (acc[role] || 0) + 1;
          return acc;
        }, {})
      }
    };

    if (format === 'csv') {
      // Generate CSV
      const csvRows = [
        ['Signature ID', 'Document Type', 'Signer Name', 'Signer Email', 'Date', 'IP Address', 'MFA Verified', 'Status'].join(',')
      ];
      
      signatures.forEach(sig => {
        csvRows.push([
          sig.id,
          sig.document_type,
          sig.signer_name,
          sig.signer_email,
          sig.created_date,
          sig.ip_address,
          sig.mfa_verified ? 'Yes' : 'No',
          sig.verification_status
        ].join(','));
      });

      return new Response(csvRows.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="signature_audit_${Date.now()}.csv"`
        }
      });
    }

    // Return JSON by default
    return Response.json({
      success: true,
      audit_report: auditReport
    });

  } catch (error) {
    console.error('Error generating audit log:', error);
    return Response.json({
      error: 'Failed to generate audit log',
      details: error.message
    }, { status: 500 });
  }
});