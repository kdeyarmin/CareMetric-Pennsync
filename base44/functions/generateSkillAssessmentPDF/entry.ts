import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
import { jsPDF } from 'npm:jspdf@2.5.2';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { assessment } = await req.json();

    if (!assessment) {
      return Response.json({ error: 'Assessment data required' }, { status: 400 });
    }

    const doc = new jsPDF();
    let y = 20;

    // Fetch and add logo
    try {
      const logoUrl = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png';
      const logoResponse = await fetch(logoUrl);
      const logoBlob = await logoResponse.blob();
      const logoArrayBuffer = await logoBlob.arrayBuffer();
      const logoBase64 = btoa(String.fromCharCode(...new Uint8Array(logoArrayBuffer)));
      const logoDataUrl = `data:image/png;base64,${logoBase64}`;
      
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, 210, 35, 'F');
      doc.addImage(logoDataUrl, 'PNG', 15, 8, 20, 20);
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont(undefined, 'bold');
      doc.text('Skill Assessment Report', 105, 18, { align: 'center' });
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      doc.text('AI-Powered Documentation Skills Analysis', 105, 27, { align: 'center' });
    } catch (error) {
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, 210, 35, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont(undefined, 'bold');
      doc.text('Skill Assessment Report', 105, 18, { align: 'center' });
    }

    doc.setTextColor(0, 0, 0);
    y = 45;

    // User Info
    doc.setFillColor(243, 244, 246);
    doc.rect(10, y, 190, 20, 'F');
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(`Nurse: ${user.full_name || 'User'}`, 15, y + 8);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, y + 15);
    y += 30;

    // Skill Profile
    if (assessment.skill_profile && assessment.skill_profile.length > 0) {
      doc.setFillColor(99, 102, 241);
      doc.rect(10, y, 190, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Skill Profile', 15, y + 6);
      doc.setTextColor(0, 0, 0);
      y += 12;

      assessment.skill_profile.forEach(skill => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        
        const levelColors = {
          expert: [34, 197, 94],
          proficient: [59, 130, 246],
          developing: [234, 179, 8],
          beginner: [239, 68, 68]
        };
        const color = levelColors[skill.level] || [107, 114, 128];
        
        doc.setFillColor(249, 250, 251);
        doc.roundedRect(10, y, 190, 15, 2, 2, 'F');
        doc.setDrawColor(229, 231, 235);
        doc.roundedRect(10, y, 190, 15, 2, 2, 'S');
        
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text(skill.skill_name, 15, y + 6);
        
        doc.setFillColor(...color);
        doc.roundedRect(15, y + 9, 30, 4, 1, 1, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.text((skill.level || 'unknown').toUpperCase(), 17, y + 12);
        doc.setTextColor(0, 0, 0);
        
        y += 18;
      });
      y += 5;
    }

    // Strengths
    if (assessment.strengths && assessment.strengths.length > 0) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      
      doc.setFillColor(34, 197, 94);
      doc.rect(10, y, 190, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Key Strengths', 15, y + 6);
      doc.setTextColor(0, 0, 0);
      y += 12;

      assessment.strengths.forEach(strength => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        const lines = doc.splitTextToSize(`✓ ${strength}`, 180);
        doc.text(lines, 15, y + 4);
        y += lines.length * 5 + 3;
      });
      y += 5;
    }

    // Growth Opportunities
    if (assessment.growth_opportunities && assessment.growth_opportunities.length > 0) {
      if (y > 220) {
        doc.addPage();
        y = 20;
      }
      
      doc.setFillColor(234, 179, 8);
      doc.rect(10, y, 190, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Growth Opportunities', 15, y + 6);
      doc.setTextColor(0, 0, 0);
      y += 12;

      assessment.growth_opportunities.forEach(opp => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }
        
        doc.setFillColor(254, 252, 232);
        doc.roundedRect(10, y, 190, 20, 2, 2, 'F');
        doc.setDrawColor(250, 204, 21);
        doc.roundedRect(10, y, 190, 20, 2, 2, 'S');
        
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(opp.area, 15, y + 6);
        doc.setFont(undefined, 'normal');
        const lines = doc.splitTextToSize(opp.suggestion, 175);
        doc.text(lines, 15, y + 12);
        
        y += 23;
      });
      y += 5;
    }

    // Recommended Pathways
    if (assessment.recommended_pathways && assessment.recommended_pathways.length > 0) {
      if (y > 220) {
        doc.addPage();
        y = 20;
      }
      
      doc.setFillColor(147, 51, 234);
      doc.rect(10, y, 190, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Recommended Training Pathways', 15, y + 6);
      doc.setTextColor(0, 0, 0);
      y += 12;

      assessment.recommended_pathways.forEach(pathway => {
        if (y > 265) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(`• ${pathway}`, 15, y + 4);
        y += 7;
      });
    }

    // Footer
    const pageCount = doc.internal.pages.length - 1;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFillColor(249, 250, 251);
      doc.rect(0, 282, 210, 15, 'F');
      doc.setTextColor(107, 114, 128);
      doc.setFontSize(8);
      doc.text(`PennSync - Skill Assessment Report - Page ${i} of ${pageCount}`, 105, 290, { align: 'center' });
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=Skill_Assessment_${(user.full_name || 'User').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`
      }
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});