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
      
      // Header with background
      doc.setFillColor(79, 70, 229); // Indigo
      doc.rect(0, 0, 210, 35, 'F');
      
      // Add logo
      doc.addImage(logoDataUrl, 'PNG', 15, 8, 20, 20);
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont(undefined, 'bold');
      doc.text('Bag Technique Checklist', 105, 18, { align: 'center' });
      
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      doc.text('State Survey Preparation - Infection Control Procedure', 105, 27, { align: 'center' });
    } catch (error) {
      // Fallback if logo fetch fails
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, 210, 35, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont(undefined, 'bold');
      doc.text('Bag Technique Checklist', 105, 18, { align: 'center' });
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      doc.text('State Survey Preparation - Infection Control Procedure', 105, 27, { align: 'center' });
    }
    
    doc.setTextColor(0, 0, 0);
    y = 45;

    // Helper function to draw section
    const drawSection = (title, items, color) => {
      // Section header with colored background
      doc.setFillColor(...color);
      doc.rect(15, y - 5, 180, 10, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text(title, 20, y + 1);
      y += 10;
      
      // Section content box
      const startY = y;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      
      items.forEach(item => {
        // Checkbox
        doc.setLineWidth(0.5);
        doc.rect(20, y - 3, 4, 4);
        
        // Text with wrapping
        const lines = doc.splitTextToSize(item, 160);
        doc.text(lines, 27, y);
        y += lines.length * 5;
      });
      
      // Border around section
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.rect(15, startY - 5, 180, y - startY + 5);
      y += 8;
    };

    // Before You Begin
    drawSection('Before You Begin', [
      'Review the plan of care and provider\'s orders',
      'Introduce yourself and ask patient how they\'d like to be addressed',
      'Confirm patient understanding of procedure and gain informed consent',
      'Locate a hard surface near patient (table) and trash receptacle',
      'Follow organization\'s infection control policies'
    ], [139, 92, 246]); // Purple

    // Step 1
    drawSection('Step 1: Prepare the Bag', [
      'Perform hand hygiene',
      'Remove cleansing wipes from outside pocket',
      'Clean the selected hard surface and let it dry',
      'Remove clean barrier from outside pocket and lay on dry surface',
      'Place bag on top of barrier',
      'Perform hand hygiene and open the bag',
      'Place down two barriers (clean area and dirty area)',
      'Obtain all necessary supplies and place on clean barrier',
      'Close the bag'
    ], [59, 130, 246]); // Blue

    // Step 2
    if (y > 220) {
      doc.addPage();
      y = 20;
    }
    
    drawSection('Step 2: Perform Patient Care', [
      'Perform hand hygiene and don gloves if indicated',
      'Perform patient care, placing used equipment on dirty barrier',
      'Dispose of waste in trash according to organizational policies',
      'If item forgotten: perform hand hygiene before retrieving from bag',
      'After care completion: discard all remaining disposable supplies',
      'Perform hand hygiene'
    ], [16, 185, 129]); // Green

    // New page if needed
    if (y > 200) {
      doc.addPage();
      y = 20;
    }

    // Step 3
    drawSection('Step 3: Clean Reusable Equipment', [
      'Don clean gloves',
      'Use sanitizing wipes/disinfectant per organizational policies',
      'Clean all equipment used or removed from clean barrier',
      'Follow manufacturer\'s contact time for disinfection',
      'Place cleaned equipment back on clean barrier to dry'
    ], [249, 115, 22]); // Orange

    // Step 4
    if (y > 220) {
      doc.addPage();
      y = 20;
    }
    
    drawSection('Step 4: Return Equipment to Bag', [
      'Doff used gloves using Aseptic Non Touch Technique',
      'Dispose of gloves in trash',
      'Perform hand hygiene',
      'Return cleaned items to the bag',
      'Close the bag',
      'Discard the barriers into the trash',
      'Perform hand hygiene'
    ], [99, 102, 241]); // Indigo

    // Step 5
    if (y > 220) {
      doc.addPage();
      y = 20;
    }
    
    drawSection('Step 5: Complete Procedure and Clean Up', [
      'Assess patient for tolerance of performed treatments',
      'Confirm understanding with teach-back as appropriate',
      'Document the procedure',
      'Follow up with provider on noted abnormalities as indicated'
    ], [20, 184, 166]); // Teal

    // Footer on last page
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFillColor(245, 245, 245);
      doc.rect(0, 285, 210, 12, 'F');
      doc.setTextColor(100, 100, 100);
      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.text('PennSync - Bag Technique Checklist', 20, 291);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 105, 291, { align: 'center' });
      doc.text(`Page ${i} of ${pageCount}`, 190, 291, { align: 'right' });
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Bag_Technique_Checklist.pdf"'
      }
    });
  } catch (error) {
    console.error('generateBagTechniquePDF failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});