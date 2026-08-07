import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
// internal IPs / metadata. The allowlist is hardcoded (always-on, fail-closed)
// rather than env-configured; add a host here if file storage ever moves.
const FILE_URL_ALLOWED_HOSTS = ['qtrypzzcjebvfcihiynt.supabase.co', 'base44.app', 'base44.io'];
function isSafeFetchUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254'].includes(host)) return false;
  if (host.endsWith('.internal') || host.endsWith('.local')) return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (!FILE_URL_ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return false;
  return true;
}

// Fetch that re-validates every redirect hop against isSafeFetchUrl. With the
// default redirect:'follow' the guard only checks the FIRST URL, so an
// allowlisted host that 3xx-redirects to an internal/metadata IP would still be
// fetched (SSRF). Returns null if a hop resolves to a disallowed host.
async function safeFetchFollow(initialUrl) {
  let response;
  let nextUrl = initialUrl;
  for (let hop = 0; hop < 4; hop++) {
    response = await fetch(nextUrl, { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;
      const resolved = new URL(location, nextUrl).toString();
      if (!isSafeFetchUrl(resolved)) return null;
      nextUrl = resolved;
      continue;
    }
    break;
  }
  return response;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { 
      pdf_template_url, 
      patient_info,
      patient_id,
      document_type,
      template_id,
      field_mappings = []
    } = await req.json();

    if (!pdf_template_url || !patient_info) {
      return Response.json({ 
        error: 'Missing required fields: pdf_template_url, patient_info' 
      }, { status: 400 });
    }

    // Fetch additional patient data if mappings require it
    let patientData = null;
    let visitData = null;

    if (patient_id && field_mappings.length > 0) {
      try {
        const [claimed] = await base44.asServiceRole.entities.Patient
          .filter({ id: patient_id }, '', 1).catch(() => []);
        if (!claimed) {
          return Response.json({ error: 'Patient not found' }, { status: 404 });
        }
        const isSuperAdmin = user.account_type === 'super_admin';
        const isAgencyScopedAdmin =
          user.account_type === 'agency_admin'
          || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
        const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
        const isAssigned = Array.isArray(claimed.assigned_nurses)
          && claimed.assigned_nurses.includes(user.email);
        if (!isPlatformAdmin && !isAgencyScopedAdmin && claimed.created_by !== user.email && !isAssigned) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (isAgencyScopedAdmin) {
          if (!user.agency_name) {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
          }
          const agencyUsers = await base44.asServiceRole.entities.User
            .list('-created_date', 5000).catch(() => []);
          const agencyEmails = new Set(
            (agencyUsers || [])
              .filter((u) => u.agency_name === user.agency_name && u.email)
              .map((u) => u.email),
          );
          const inAgency = (claimed.created_by && agencyEmails.has(claimed.created_by))
            || (Array.isArray(claimed.assigned_nurses)
              && claimed.assigned_nurses.some((e) => agencyEmails.has(e)));
          if (!inAgency) {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
          }
        }
        patientData = claimed;

        // Get latest visit if needed
        if (field_mappings.some(m => m.data_source === 'visit')) {
          const visits = await base44.asServiceRole.entities.Visit.filter(
            { patient_id },
            '-visit_date',
            1
          );
          if (visits.length > 0) visitData = visits[0];
        }
      } catch (e) {
        console.warn('Error fetching additional data:', e.message);
      }
    }

    if (!isSafeFetchUrl(pdf_template_url)) {
      return Response.json({ error: 'Invalid or disallowed pdf_template_url' }, { status: 400 });
    }
    // Fetch the PDF template (re-validating any redirect hop)
    const pdfResponse = await safeFetchFollow(pdf_template_url);
    if (!pdfResponse) {
      return Response.json({ error: 'Redirect to a disallowed host blocked' }, { status: 400 });
    }
    if (!pdfResponse.ok) {
      throw new Error(`Failed to fetch PDF template: ${pdfResponse.statusText}`);
    }
    const pdfBytes = await pdfResponse.arrayBuffer();

    // Load the PDF
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    // Helper to get nested value from object
    const getNestedValue = (obj, path) => {
      return path.split('.').reduce((current, key) => {
        if (key.includes('[')) {
          const arrayKey = key.split('[')[0];
          const index = parseInt(key.split('[')[1].split(']')[0]);
          return current?.[arrayKey]?.[index];
        }
        return current?.[key];
      }, obj);
    };

    // Try to fill PDF form fields first (if it's a fillable PDF)
    try {
      const form = pdfDoc.getForm();
      const fields = form.getFields();
      
      // Build dynamic field mappings based on template configuration
      const dynamicMappings = {};
      
      // Add patient_info mappings
      Object.entries(patient_info).forEach(([key, value]) => {
        dynamicMappings[key] = value;
        dynamicMappings[key.charAt(0).toUpperCase() + key.slice(1)] = value;
      });
      
      // Add custom field mappings from template
      field_mappings.forEach(mapping => {
        let value;
        
        switch (mapping.data_source) {
          case 'patient':
            value = patientData ? getNestedValue(patientData, mapping.field_path) : null;
            break;
          case 'visit':
            value = visitData ? getNestedValue(visitData, mapping.field_path) : null;
            break;
          case 'custom':
            value = patient_info[mapping.field_path] || mapping.default_value;
            break;
        }
        
        if (value !== null && value !== undefined) {
          // Format value based on field type
          if (mapping.field_type === 'date' && value) {
            value = new Date(value).toLocaleDateString();
          } else if (mapping.field_type === 'checkbox') {
            value = value ? 'Yes' : 'No';
          }
          
          dynamicMappings[mapping.pdf_field_name] = String(value);
        } else if (mapping.default_value) {
          dynamicMappings[mapping.pdf_field_name] = mapping.default_value;
        }
      });
      
      // Add current date
      dynamicMappings['date'] = new Date().toLocaleDateString();
      dynamicMappings['Date'] = new Date().toLocaleDateString();

      fields.forEach(field => {
        const fieldName = field.getName();
        const value = dynamicMappings[fieldName];
        
        if (value) {
          try {
            const textField = form.getTextField(fieldName);
            textField.setText(String(value));
          } catch (e) {
            console.warn(`Could not fill field ${fieldName}:`, e.message);
          }
        }
      });

      // Flatten the form to prevent editing
      form.flatten();
    } catch (e) {
      console.warn('No fillable form fields found or error filling them:', e.message);
      
      // If no form fields, add text overlays on the first page
      const fontSize = 11;
      const lineHeight = 14;
      let yPosition = height - 150;

      const addText = (label, value, x = 60) => {
        if (value) {
          firstPage.drawText(`${label}: ${value}`, {
            x,
            y: yPosition,
            size: fontSize,
            font: helveticaFont,
            color: rgb(0, 0, 0),
          });
          yPosition -= lineHeight;
        }
      };

      // Add patient info as text overlay
      addText('Patient Name', patient_info.patient_name);
      addText('Date of Birth', patient_info.date_of_birth);
      
      if (patient_info.address) {
        addText('Address', `${patient_info.address}, ${patient_info.city || ''} ${patient_info.state || ''} ${patient_info.zip_code || ''}`.trim());
      }
      
      addText('Phone', patient_info.phone);
      addText('Email', patient_info.email);
      
      yPosition -= 5; // Extra spacing
      addText('Emergency Contact', patient_info.emergency_contact_name);
      addText('Emergency Phone', patient_info.emergency_contact_phone);
      
      yPosition -= 5;
      addText('Physician', patient_info.physician_name);
      addText('Physician Phone', patient_info.physician_phone);
      
      yPosition -= 5;
      addText('Insurance', patient_info.insurance_provider);
      addText('Policy Number', patient_info.insurance_policy);
      
      yPosition -= 5;
      addText('Admission Date', patient_info.admission_date);
    }

    // Save the modified PDF
    const preparedPdfBytes = await pdfDoc.save();

    // Upload to Base44 storage
    const blob = new Blob([preparedPdfBytes], { type: 'application/pdf' });
    const fileName = `prepared-${document_type || 'document'}-${patient_id || 'patient'}-${Date.now()}.pdf`;
    const file = new File([blob], fileName, { type: 'application/pdf' });

    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

    // Log the activity
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'pdf_prepared',
      details: {
        document_type,
        patient_id,
        patient_name: patient_info.patient_name,
        prepared_pdf: uploadResult.file_url
      },
      page: 'pdf_preparation'
    });

    return Response.json({
      success: true,
      prepared_pdf_url: uploadResult.file_url,
      patient_info
    });

  } catch (error) {
    console.error('PDF preparation error:', error);
    return Response.json({ 
      error: 'Failed to prepare PDF' 
    }, { status: 500 });
  }
});