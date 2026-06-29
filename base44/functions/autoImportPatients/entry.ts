import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ success: false, error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { fileContent, reportType } = await req.json();

    if (!fileContent) {
      return Response.json({ success: false, error: 'No file content provided' }, { status: 400 });
    }

    const response = await base44.functions.invoke('processPatientFileUpdate', {
      file_content: fileContent,
      report_type: reportType,
    });

    return Response.json(response.data || response);
  } catch (error) {
    return Response.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
});