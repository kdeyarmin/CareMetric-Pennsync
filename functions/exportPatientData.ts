import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { format, start_date, end_date, patient_ids } = await req.json();

    if (!format || !['csv', 'pdf'].includes(format)) {
      return Response.json({ error: 'Invalid format. Use "csv" or "pdf"' }, { status: 400 });
    }

    // Fetch patients
    const patients = patient_ids && patient_ids.length > 0
      ? await Promise.all(patient_ids.map(id => base44.entities.Patient.filter({ id })))
      : await base44.entities.Patient.list('-updated_date', 500);
    
    const patientList = patients.flat();

    // Fetch visits within date range
    const visitsPromises = patientList.map(async (patient) => {
      let visits = await base44.entities.Visit.filter({ patient_id: patient.id }, '-visit_date');
      
      if (start_date || end_date) {
        visits = visits.filter(v => {
          const visitDate = new Date(v.visit_date);
          if (start_date && visitDate < new Date(start_date)) return false;
          if (end_date && visitDate > new Date(end_date)) return false;
          return true;
        });
      }
      
      return { patient, visits };
    });

    const patientVisitsData = await Promise.all(visitsPromises);

    // Fetch compliance audits
    const auditsPromises = patientVisitsData.map(async ({ patient, visits }) => {
      const visitIds = visits.map(v => v.id);
      const audits = [];
      
      for (const visitId of visitIds) {
        const visitAudits = await base44.entities.ComplianceAudit.filter({ visit_id: visitId });
        audits.push(...visitAudits);
      }
      
      return { patient, visits, audits };
    });

    const fullData = await Promise.all(auditsPromises);

    if (format === 'csv') {
      // Generate CSV
      const csvRows = [];
      
      // Headers
      csvRows.push([
        'Patient ID',
        'Patient Name',
        'DOB',
        'Phone',
        'Email',
        'Status',
        'Primary Diagnosis',
        'Visit Date',
        'Visit Type',
        'Visit Status',
        'Compliance Score',
        'Audit Status'
      ].join(','));

      // Data rows
      fullData.forEach(({ patient, visits, audits }) => {
        const patientName = `${patient.first_name} ${patient.last_name}`;
        
        if (visits.length === 0) {
          // Patient with no visits
          csvRows.push([
            patient.id,
            `"${patientName}"`,
            patient.date_of_birth || '',
            patient.phone || '',
            patient.email || '',
            patient.status || '',
            `"${patient.primary_diagnosis || ''}"`,
            '', '', '', '', ''
          ].join(','));
        } else {
          visits.forEach(visit => {
            const audit = audits.find(a => a.visit_id === visit.id);
            
            csvRows.push([
              patient.id,
              `"${patientName}"`,
              patient.date_of_birth || '',
              patient.phone || '',
              patient.email || '',
              patient.status || '',
              `"${patient.primary_diagnosis || ''}"`,
              visit.visit_date || '',
              visit.visit_type || '',
              visit.status || '',
              audit ? audit.compliance_score : '',
              audit ? audit.status : ''
            ].join(','));
          });
        }
      });

      const csvContent = csvRows.join('\n');
      
      return new Response(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename=patient_export_${new Date().toISOString().split('T')[0]}.csv`
        }
      });
    } else {
      // Generate PDF
      const doc = new jsPDF();
      let yPos = 20;

      // Title
      doc.setFontSize(18);
      doc.text('Patient Data Export Report', 20, yPos);
      yPos += 10;

      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 20, yPos);
      yPos += 5;
      doc.text(`Date Range: ${start_date || 'All'} to ${end_date || 'All'}`, 20, yPos);
      yPos += 10;

      // Summary
      doc.setFontSize(12);
      doc.text('Summary', 20, yPos);
      yPos += 7;
      doc.setFontSize(10);
      doc.text(`Total Patients: ${patientList.length}`, 20, yPos);
      yPos += 5;
      
      const totalVisits = fullData.reduce((sum, { visits }) => sum + visits.length, 0);
      doc.text(`Total Visits: ${totalVisits}`, 20, yPos);
      yPos += 5;
      
      const totalAudits = fullData.reduce((sum, { audits }) => sum + audits.length, 0);
      doc.text(`Total Audits: ${totalAudits}`, 20, yPos);
      yPos += 15;

      // Patient Details
      fullData.forEach(({ patient, visits, audits }) => {
        if (yPos > 270) {
          doc.addPage();
          yPos = 20;
        }

        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text(`${patient.first_name} ${patient.last_name}`, 20, yPos);
        doc.setFont(undefined, 'normal');
        yPos += 7;

        doc.setFontSize(9);
        doc.text(`DOB: ${patient.date_of_birth || 'N/A'} | Phone: ${patient.phone || 'N/A'}`, 20, yPos);
        yPos += 5;
        doc.text(`Status: ${patient.status || 'N/A'} | Diagnosis: ${patient.primary_diagnosis || 'N/A'}`, 20, yPos);
        yPos += 7;

        if (visits.length > 0) {
          doc.setFontSize(10);
          doc.text('Recent Visits:', 25, yPos);
          yPos += 5;

          visits.slice(0, 5).forEach(visit => {
            if (yPos > 270) {
              doc.addPage();
              yPos = 20;
            }

            const audit = audits.find(a => a.visit_id === visit.id);
            doc.setFontSize(8);
            doc.text(`- ${visit.visit_date}: ${visit.visit_type} (${visit.status})`, 30, yPos);
            
            if (audit) {
              doc.text(`Compliance: ${audit.compliance_score}/100`, 130, yPos);
            }
            yPos += 4;
          });

          if (visits.length > 5) {
            doc.text(`+ ${visits.length - 5} more visits`, 30, yPos);
            yPos += 4;
          }
        } else {
          doc.setFontSize(9);
          doc.text('No visits in selected date range', 25, yPos);
          yPos += 5;
        }

        yPos += 5;
      });

      const pdfBytes = doc.output('arraybuffer');

      return new Response(pdfBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename=patient_export_${new Date().toISOString().split('T')[0]}.pdf`
        }
      });
    }

  } catch (error) {
    console.error('Export error:', error);
    return Response.json(
      { error: 'Failed to export data', details: error.message },
      { status: 500 }
    );
  }
});