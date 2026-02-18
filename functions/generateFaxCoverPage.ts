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
      recipient_name = '',
      recipient_fax = '',
      sender_name = user.full_name || '',
      sender_fax = '',
      subject = 'Clinical Document',
      message = '',
      document_count = 1,
      document_name = 'Document'
    } = body;

    const coverPageData = {
      date: new Date().toLocaleDateString(),
      sender_name,
      sender_fax,
      recipient_name,
      recipient_fax,
      subject,
      message,
      document_count,
      document_name,
      from_facility: 'CareMetric AI',
      total_pages: document_count + 1, // +1 for cover page
      confidentiality_notice: 'This facsimile contains confidential medical information. If you are not the intended recipient, please delete immediately.'
    };

    console.log('[generateFaxCoverPage] Generated cover page for:', recipient_name);

    return Response.json({
      success: true,
      cover_page_data: coverPageData
    });

  } catch (error) {
    console.error('[generateFaxCoverPage] Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});