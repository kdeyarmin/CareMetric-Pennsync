import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const isAdminLike = user.role === 'admin'
      || user.account_type === 'agency_admin'
      || user.account_type === 'super_admin';
    if (!isAdminLike) {
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
    console.error('autoImportPatients failed:', error);
    return Response.json({
      success: false,
      error: 'Internal server error',
    }, { status: 500 });
  }
});