import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { noteContent, recipientEmail, recipientType, patientName, visitType } = await req.json();

    if (!noteContent || !recipientEmail) {
      return Response.json({ 
        error: 'Missing required fields: noteContent, recipientEmail' 
      }, { status: 400 });
    }

    // Get provider practice info
    const practiceInfoResults = await base44.asServiceRole.entities.ProviderPracticeInfo.filter({
      provider_email: user.email
    });
    const practiceInfo = practiceInfoResults[0];

    // Build professional header
    let header = '';
    if (practiceInfo && practiceInfo.include_header) {
      header = `
${practiceInfo.practice_name || ''}
${practiceInfo.provider_name || user.full_name}
${practiceInfo.specialty ? `Specialty: ${practiceInfo.specialty}` : ''}
${practiceInfo.practice_address || ''}
${practiceInfo.practice_phone ? `Phone: ${practiceInfo.practice_phone}` : ''}
${practiceInfo.practice_fax ? `Fax: ${practiceInfo.practice_fax}` : ''}
${practiceInfo.practice_email ? `Email: ${practiceInfo.practice_email}` : ''}
${practiceInfo.license_number ? `License: ${practiceInfo.license_number} (${practiceInfo.license_state})` : ''}
${practiceInfo.npi_number ? `NPI: ${practiceInfo.npi_number}` : ''}

${'='.repeat(80)}
`;
    }

    // Build signature
    let signature = '';
    if (practiceInfo && practiceInfo.include_signature && practiceInfo.signature_data) {
      if (practiceInfo.signature_type === 'typed') {
        signature = `

Electronically signed by:
${practiceInfo.signature_data}
${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}
`;
      } else {
        signature = `

[Signature image attached]
Electronically signed on: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}
`;
      }
    }

    // Format email based on recipient type
    let subject, body;

    if (recipientType === 'provider') {
      subject = `Clinical Note - ${visitType || 'Visit Documentation'}`;
      body = `${header}

CLINICAL NOTE
${visitType ? `Visit Type: ${visitType}` : ''}
${patientName ? `Patient: ${patientName}` : ''}
Date: ${new Date().toLocaleDateString()}

${noteContent}
${signature}

---
This is a legally compliant clinical document generated via CareMetric AI
Provider: ${practiceInfo?.provider_name || user.full_name}
      `;
    } else {
      // Patient-friendly version
      subject = `Visit Summary from ${practiceInfo?.provider_name || user.full_name}`;
      body = `${header}

Dear ${patientName || 'Patient'},

Thank you for your visit. Below is a summary of today's appointment:

${noteContent}

If you have any questions or concerns, please don't hesitate to reach out.
${signature}

Best regards,
${practiceInfo?.provider_name || user.full_name}
${practiceInfo?.practice_name || ''}

---
This summary was sent via CareMetric AI
      `;
    }

    await base44.asServiceRole.integrations.Core.SendEmail({
      from_name: user.full_name,
      to: recipientEmail,
      subject: subject,
      body: body
    });

    return Response.json({
      success: true,
      message: `Note sent to ${recipientEmail}`
    });

  } catch (error) {
    console.error('Send note email error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});