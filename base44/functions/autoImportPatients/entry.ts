import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    const body = await req.json();
    const text = body.fileContent;
    
    if (!text) {
      return Response.json({ error: 'No file content provided', success: false }, { status: 400 });
    }
    const lines = text.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      return Response.json({ error: 'Empty file' }, { status: 400 });
    }

    // Parse CSV
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const headers = parseCSVLine(lines[0]);
    const rows = lines.slice(1).map(line => parseCSVLine(line));

    // Auto-map columns based on header names
    const columnMapping = {};
    const skipColumns = ['company', 'top_unit', 'parent_unit', 'sub_unit', 'branch_name', 'patient_team_name'];
    
    const fieldAliases = {
      // Name fields
      'patient': 'first_name',
      'patient_first_name': 'first_name',
      'firstname': 'first_name',
      'first_name': 'first_name',
      'fname': 'first_name',
      'patient_last_name': 'last_name',
      'lastname': 'last_name',
      'last_name': 'last_name',
      'lname': 'last_name',
      'surname': 'last_name',
      'name': 'last_name',
      'middle_name': 'middle_name',
      
      // Basic info
      'dob': 'date_of_birth',
      'date_of_birth': 'date_of_birth',
      'mrn': 'medical_record_number',
      'medical_record_number': 'medical_record_number',
      'phone': 'phone',
      'email': 'email',
      'address': 'address',
      'gender': 'gender',
      
      // Payor
      'payor': 'payor',
      'payer': 'payor',
      'primary_payor': 'payor',
      'insurance_type': 'payor',
      
      // Emergency contact
      'emergency_contact_name': 'emergency_contact_name',
      'emergency_name': 'emergency_contact_name',
      'emergency_contact_phone': 'emergency_contact_phone',
      'emergency_phone': 'emergency_contact_phone',
      'emergency_contact_relationship': 'emergency_contact_relationship',
      'emergency_relationship': 'emergency_contact_relationship',
      
      // Physician
      'physician': 'physician_name',
      'physician_name': 'physician_name',
      'doctor_name': 'physician_name',
      'physician_phone': 'physician_phone',
      'doctor_phone': 'physician_phone',
      'physician_email': 'physician_email',
      
      // Caregiver
      'caregiver_name': 'caregiver_name',
      'caregiver_phone': 'caregiver_phone',
      'caregiver_email': 'caregiver_email',
      
      // Medical
      'primary_diagnosis': 'primary_diagnosis',
      'diagnosis': 'primary_diagnosis',
      'dx': 'primary_diagnosis',
      'secondary_diagnoses': 'secondary_diagnoses',
      'allergies': 'allergies',
      'allergy': 'allergies',
      'icd_code': 'icd_code',
      'icd10_code': 'icd_code',
      
      // Admission
      'admitted_date': 'admission_date',
      'admission_date': 'admission_date',
      'soc_date': 'admission_date',
      'discharge_date': 'discharge_date',
      'admission_source': 'admission_source',
      'discharge_disposition': 'discharge_disposition',
      
      // Service
      'organization_type': 'care_type',
      'care_type': 'care_type',
      'service_type': 'care_type',
      'current_admission_status': 'status',
      'status': 'status',
      'patient_status': 'status',
      
      // Insurance
      'insurance_primary_provider': 'insurance_primary_provider',
      'primary_insurance': 'insurance_primary_provider',
      'insurance_primary_policy': 'insurance_primary_policy',
      'policy_number': 'insurance_primary_policy',
      'insurance_secondary_provider': 'insurance_secondary_provider',
      'secondary_insurance': 'insurance_secondary_provider'
    };

    headers.forEach((header, idx) => {
      const normalized = header.toLowerCase().replace(/[^a-z0-9_]/g, '_').trim();
      const lowerHeader = header.toLowerCase().trim();
      
      if (skipColumns.includes(normalized)) return;
      
      // Try direct match first
      if (fieldAliases[normalized]) {
        columnMapping[idx] = fieldAliases[normalized];
        return;
      }
      
      // Special case: if header contains "last" and "name", map to last_name
      if (lowerHeader.includes('last') && lowerHeader.includes('name')) {
        columnMapping[idx] = 'last_name';
        return;
      }
      
      // Special case: if header contains "first" and "name", map to first_name
      if (lowerHeader.includes('first') && lowerHeader.includes('name')) {
        columnMapping[idx] = 'first_name';
        return;
      }
      
      // Try partial matches for common patterns
      for (const [alias, field] of Object.entries(fieldAliases)) {
        if (normalized.includes(alias) || alias.includes(normalized)) {
          columnMapping[idx] = field;
          return;
        }
      }
    });

    const results = { success: 0, failed: 0, errors: [], patients: [] };
    
    // Helper function to add delay between operations
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const patient = {};

      Object.entries(columnMapping).forEach(([colIndex, fieldKey]) => {
        const value = row[colIndex]?.trim();
        if (!value) return;

        if (fieldKey === 'first_name') {
          // Split full name if needed
          const nameParts = value.split(' ').filter(p => p);
          if (nameParts.length > 1) {
            patient.first_name = nameParts[0];
            patient.last_name = nameParts.slice(1).join(' ');
          } else {
            patient.first_name = value;
          }
        } else if (fieldKey === 'last_name') {
          patient.last_name = value;
        } else if (fieldKey === 'care_type') {
          const valueLower = value.toLowerCase();
          if (valueLower.includes('home') || valueLower.includes('health')) {
            patient.care_type = 'home_health';
          } else if (valueLower.includes('hospice')) {
            patient.care_type = 'hospice';
          } else {
            patient.care_type = 'home_health';
          }
        } else if (fieldKey === 'status') {
          const valueLower = value.toLowerCase();
          if (valueLower.includes('active') || valueLower === 'a') {
            patient.status = 'active';
          } else if (valueLower.includes('discharge')) {
            patient.status = 'discharged';
          } else if (valueLower.includes('hospital')) {
            patient.status = 'hospitalized';
          } else {
            patient.status = 'active';
          }
        } else if (fieldKey === 'admission_source') {
          const valueLower = value.toLowerCase();
          if (valueLower.includes('home')) patient.admission_source = 'home';
          else if (valueLower.includes('hospital')) patient.admission_source = 'hospital';
          else if (valueLower.includes('snf') || valueLower.includes('skilled')) patient.admission_source = 'skilled_nursing_facility';
          else if (valueLower.includes('rehab')) patient.admission_source = 'rehab';
          else patient.admission_source = 'other';
        } else if (fieldKey === 'discharge_disposition') {
          const valueLower = value.toLowerCase();
          if (valueLower.includes('home')) patient.discharge_disposition = 'home';
          else if (valueLower.includes('hospital')) patient.discharge_disposition = 'hospital';
          else if (valueLower.includes('snf') || valueLower.includes('skilled')) patient.discharge_disposition = 'skilled_nursing_facility';
          else if (valueLower.includes('deceased') || valueLower.includes('death')) patient.discharge_disposition = 'deceased';
          else patient.discharge_disposition = 'other';
        } else if (fieldKey === 'insurance_primary_provider') {
          if (!patient.insurance_primary) patient.insurance_primary = {};
          patient.insurance_primary.provider = value;
        } else if (fieldKey === 'insurance_primary_policy') {
          if (!patient.insurance_primary) patient.insurance_primary = {};
          patient.insurance_primary.policy_number = value;
        } else if (fieldKey === 'insurance_secondary_provider') {
          if (!patient.insurance_secondary) patient.insurance_secondary = {};
          patient.insurance_secondary.provider = value;
        } else if (fieldKey === 'secondary_diagnoses') {
          // Parse comma-separated values into array
          patient.secondary_diagnoses = value.split(',').map(d => d.trim()).filter(d => d);
        } else {
          patient[fieldKey] = value;
        }
      });

      // Ensure we have required fields including MRN
      if (!patient.first_name || !patient.last_name || !patient.medical_record_number) {
        results.failed++;
        const missingFields = [];
        if (!patient.first_name) missingFields.push('first_name');
        if (!patient.last_name) missingFields.push('last_name');
        if (!patient.medical_record_number) missingFields.push('medical_record_number (MRN)');
        
        results.errors.push({
          row: i + 1,
          patient: `Row ${i + 1}`,
          error: `Missing required field(s): ${missingFields.join(', ')}`
        });
        continue;
      }

      try {
        const created = await base44.asServiceRole.entities.Patient.create(patient);
        results.success++;
        results.patients.push(created);
        
        // Add delay to prevent rate limiting (200ms between creates)
        if (i < rows.length - 1) {
          await delay(200);
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: i + 1,
          patient: `${patient.first_name} ${patient.last_name}`,
          error: error.message
        });
        
        // If rate limit error, add longer delay
        if (error.message && error.message.toLowerCase().includes('rate limit')) {
          await delay(1000);
        }
      }
    }

    return Response.json({
      success: true,
      results
    });

  } catch (error) {
    console.error('Auto import error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});