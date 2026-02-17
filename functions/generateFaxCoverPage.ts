import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      patient_id,
      document_id,
      recipient_number,
      sender_number,
      recipient_name,
      sender_name,
      subject,
      notes
    } = body;

    let patientData = null;
    let documentData = null;

    // Fetch patient data if provided
    if (patient_id) {
      try {
        const patients = await base44.entities.Patient.filter({ id: patient_id });
        patientData = patients?.[0];
      } catch (e) {
        console.warn('[generateFaxCoverPage] Patient fetch failed:', e.message);
      }
    }

    // Fetch document metadata if provided
    if (document_id) {
      try {
        const docs = await base44.entities.PatientDocument.filter({ id: document_id });
        documentData = docs?.[0];
      } catch (e) {
        console.warn('[generateFaxCoverPage] Document fetch failed:', e.message);
      }
    }

    // Build cover page data
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York'
    });

    // Auto-generate subject if not provided
    let autoSubject = subject || '';
    if (!autoSubject && documentData) {
      const parts = [];
      if (documentData.document_category) parts.push(documentData.document_category.replace(/_/g, ' '));
      if (patientData) parts.push(`Patient: ${patientData.first_name} ${patientData.last_name}`);
      if (documentData.extracted_data?.date_of_service) parts.push(documentData.extracted_data.date_of_service);
      autoSubject = parts.join(' - ') || 'Medical Documents';
    }

    const coverPageData = {
      date: dateStr,
      time: timeStr,
      to: {
        name: recipient_name || '',
        fax_number: recipient_number || '',
        company: ''
      },
      from: {
        name: sender_name || user.full_name || '',
        fax_number: sender_number || user.sending_fax_number || '',
        company: user.agency_name || '',
        phone: user.phone_number || ''
      },
      subject: autoSubject,
      patient: patientData ? {
        name: `${patientData.first_name || ''} ${patientData.last_name || ''}`.trim(),
        dob: patientData.date_of_birth || '',
        mrn: patientData.mrn || patientData.id
      } : null,
      document: documentData ? {
        category: documentData.document_category || '',
        summary: documentData.ai_summary || ''
      } : null,
      message: notes || '',
      page_count: 'TBD',
      urgency: 'normal',
      include_hipaa_notice: true,
      hipaa_notice: 'CONFIDENTIALITY NOTICE: This facsimile transmission contains confidential information that is intended only for the use of the individual or entity to which it is addressed. If you are not the intended recipient, you are hereby notified that any disclosure, copying, distribution, or taking of any action in reliance on the contents of this information is strictly prohibited. If you have received this facsimile in error, please notify the sender immediately and destroy the original.'
    };

    return Response.json({
      success: true,
      cover_page_data: coverPageData
    });

  } catch (error) {
    console.error('[generateFaxCoverPage] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});