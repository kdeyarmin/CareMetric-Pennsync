import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Common nicknames map
const NICKNAMES = {
  'william': ['bill', 'will', 'willie', 'billy'],
  'robert': ['bob', 'rob', 'bobby', 'robbie'],
  'richard': ['dick', 'rick', 'ricky', 'rich'],
  'james': ['jim', 'jimmy', 'jamie'],
  'john': ['jack', 'johnny'],
  'michael': ['mike', 'mikey', 'mick'],
  'thomas': ['tom', 'tommy'],
  'joseph': ['joe', 'joey'],
  'charles': ['charlie', 'chuck'],
  'christopher': ['chris'],
  'daniel': ['dan', 'danny'],
  'matthew': ['matt'],
  'anthony': ['tony'],
  'donald': ['don', 'donnie'],
  'kenneth': ['ken', 'kenny'],
  'steven': ['steve'],
  'edward': ['ed', 'eddie', 'ted'],
  'timothy': ['tim', 'timmy'],
  'elizabeth': ['liz', 'beth', 'betty', 'libby'],
  'margaret': ['maggie', 'meg', 'peggy'],
  'patricia': ['pat', 'patty', 'tricia'],
  'jennifer': ['jen', 'jenny'],
  'susan': ['sue', 'suzy'],
  'deborah': ['deb', 'debbie'],
  'catherine': ['cathy', 'kate', 'katie'],
  'kimberly': ['kim'],
  'rebecca': ['becky', 'becca'],
  'dorothy': ['dot', 'dottie']
};

// Check if two names are nicknames of each other
const areNicknames = (name1, name2) => {
  const n1 = name1?.toLowerCase().trim();
  const n2 = name2?.toLowerCase().trim();
  if (!n1 || !n2 || n1 === n2) return false;

  for (const [formal, nicks] of Object.entries(NICKNAMES)) {
    if ((n1 === formal && nicks.includes(n2)) || 
        (n2 === formal && nicks.includes(n1)) ||
        (nicks.includes(n1) && nicks.includes(n2))) {
      return true;
    }
  }
  return false;
};

// Levenshtein distance for fuzzy string matching
const levenshteinDistance = (str1, str2) => {
  const matrix = [];
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[str2.length][str1.length];
};

// Calculate similarity percentage
const calculateSimilarity = (str1, str2) => {
  if (!str1 || !str2) return 0;
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  return maxLength === 0 ? 100 : ((maxLength - distance) / maxLength) * 100;
};

// Parse date components from various formats
const parseDateComponents = (dateStr) => {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/\D/g, '');
  
  // Try YYYYMMDD format
  if (cleaned.length === 8) {
    return {
      year: cleaned.substring(0, 4),
      month: cleaned.substring(4, 6),
      day: cleaned.substring(6, 8)
    };
  }
  
  // Try MMDDYYYY format
  if (cleaned.length === 8) {
    return {
      year: cleaned.substring(4, 8),
      month: cleaned.substring(0, 2),
      day: cleaned.substring(2, 4)
    };
  }
  
  return null;
};

// Calculate match score between two patients
const calculateMatchScore = (p1, p2) => {
  let score = 0;
  const matches = [];

  // Normalize names (remove commas and extra spaces)
  const normalizeName = (str) => str?.toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ').trim() || '';
  
  // Name matching with fuzzy logic
  const firstName1 = normalizeName(p1.first_name);
  const firstName2 = normalizeName(p2.first_name);
  const lastName1 = normalizeName(p1.last_name);
  const lastName2 = normalizeName(p2.last_name);
  const fullName1 = `${firstName1} ${lastName1}`;
  const fullName2 = `${firstName2} ${lastName2}`;
  
  // Skip if names are too short to be reliable
  if (!firstName1 || !lastName1 || !firstName2 || !lastName2) {
    // Still check if both full names exist and match
    if (fullName1.trim() && fullName2.trim() && fullName1 === fullName2) {
      score += 40;
      matches.push('name_exact');
    }
  } else {
    // Exact full name match
    if (fullName1 === fullName2) {
      score += 40;
      matches.push('name_exact');
    } 
    // Check for name reversal (first/last swapped - common data entry error)
    else if (firstName1 === lastName2 && lastName1 === firstName2) {
      score += 35;
      matches.push('name_reversed');
    }
    // Nickname matching
    else if (areNicknames(firstName1, firstName2) && calculateSimilarity(lastName1, lastName2) >= 95) {
      score += 38;
      matches.push('nickname_match');
    }
    // Fuzzy match on full name
    else {
      const fullNameSimilarity = calculateSimilarity(fullName1, fullName2);
      if (fullNameSimilarity >= 90) {
        score += 35;
        matches.push('name_fuzzy_very_high');
      } else if (fullNameSimilarity >= 80) {
        score += 30;
        matches.push('name_fuzzy_high');
      } else if (fullNameSimilarity >= 70) {
        score += 22;
        matches.push('name_fuzzy_medium');
      }
      
      // Check individual name components
      const firstNameSimilarity = calculateSimilarity(firstName1, firstName2);
      const lastNameSimilarity = calculateSimilarity(lastName1, lastName2);
      
      // Exact last name + similar first name (common for relatives or typos)
      if (lastNameSimilarity === 100) {
        if (firstNameSimilarity >= 90) {
          score += 28;
          matches.push('same_lastname_similar_firstname');
        } else if (firstNameSimilarity >= 70) {
          score += 18;
          matches.push('same_lastname_firstname_typo');
        } else if (firstName1.charAt(0) === firstName2.charAt(0)) {
          score += 12;
          matches.push('same_lastname_same_initial');
        }
      }
      // Exact first name + similar last name
      else if (firstNameSimilarity === 100 && lastNameSimilarity >= 85) {
        score += 25;
        matches.push('same_firstname_similar_lastname');
      }
      // Both components very similar
      else if (firstNameSimilarity >= 90 && lastNameSimilarity >= 90) {
        score += 30;
        matches.push('name_components_similar');
      } else if (firstNameSimilarity >= 85 && lastNameSimilarity >= 85) {
        score += 20;
        matches.push('name_partial_strong');
      }
      
      // Check for initials vs full name (e.g., "J. Smith" vs "John Smith")
      if (firstName1.length === 1 && firstName2.startsWith(firstName1) && lastNameSimilarity >= 95) {
        score += 25;
        matches.push('initial_vs_full_name');
      } else if (firstName2.length === 1 && firstName1.startsWith(firstName2) && lastNameSimilarity >= 95) {
        score += 25;
        matches.push('initial_vs_full_name');
      }
      
      // Check for middle name/initial inclusion differences
      // e.g., "John Smith" vs "John A Smith" or "John A. Smith"
      const name1Parts = fullName1.split(' ').filter(p => p.length > 0);
      const name2Parts = fullName2.split(' ').filter(p => p.length > 0);
      if (name1Parts.length !== name2Parts.length) {
        // Check if one has middle initial/name that the other doesn't
        const shorter = name1Parts.length < name2Parts.length ? name1Parts : name2Parts;
        const longer = name1Parts.length < name2Parts.length ? name2Parts : name1Parts;
        if (shorter[0] === longer[0] && shorter[shorter.length - 1] === longer[longer.length - 1]) {
          score += 20;
          matches.push('name_middle_initial_difference');
        }
      }
    }
  }

  // Enhanced address fuzzy matching
  if (p1.address && p2.address) {
    const addr1 = normalizeName(p1.address);
    const addr2 = normalizeName(p2.address);
    const addressSimilarity = calculateSimilarity(addr1, addr2);
    
    if (addressSimilarity === 100) {
      score += 15;
      matches.push('address_exact');
    } else if (addressSimilarity >= 85) {
      score += 10;
      matches.push('address_similar');
    } else if (addressSimilarity >= 70) {
      score += 5;
      matches.push('address_partial');
    }
    
    // Check for partial street/number matches (common data entry variations)
    const addr1Parts = addr1.split(' ').filter(p => p.length > 0);
    const addr2Parts = addr2.split(' ').filter(p => p.length > 0);
    
    // Check if street number matches
    const hasNumber1 = addr1Parts.find(p => /^\d+/.test(p));
    const hasNumber2 = addr2Parts.find(p => /^\d+/.test(p));
    if (hasNumber1 && hasNumber2 && hasNumber1 === hasNumber2) {
      score += 3;
      matches.push('address_street_number');
    }
  }

  // Enhanced DOB matching with variation detection
  if (p1.date_of_birth && p2.date_of_birth) {
    const dob1Str = p1.date_of_birth.replace(/\D/g, '');
    const dob2Str = p2.date_of_birth.replace(/\D/g, '');
    
    // Exact match
    if (dob1Str === dob2Str) {
      score += 30;
      matches.push('dob_exact');
    } else {
      // Parse date components
      const dob1 = parseDateComponents(p1.date_of_birth);
      const dob2 = parseDateComponents(p2.date_of_birth);
      
      if (dob1 && dob2) {
        // Check for month/day reversal (common data entry error)
        if (dob1.year === dob2.year) {
          if (dob1.month === dob2.day && dob1.day === dob2.month) {
            score += 25;
            matches.push('dob_reversed');
          }
          // Check if same year, close month/day
          else if (Math.abs(parseInt(dob1.month) - parseInt(dob2.month)) <= 1 &&
                   Math.abs(parseInt(dob1.day) - parseInt(dob2.day)) <= 1) {
            score += 15;
            matches.push('dob_close');
          }
        }
        // Check if year is off by 1 (typo) but month/day match
        else if (Math.abs(parseInt(dob1.year) - parseInt(dob2.year)) === 1 &&
                 dob1.month === dob2.month && dob1.day === dob2.day) {
          score += 20;
          matches.push('dob_year_typo');
        }
        // Check for decade typo (e.g., 1945 vs 1955) with same month/day
        else if (Math.abs(parseInt(dob1.year) - parseInt(dob2.year)) === 10 &&
                 dob1.month === dob2.month && dob1.day === dob2.day) {
          score += 18;
          matches.push('dob_decade_typo');
        }
        // Check for century typo (e.g., 19XX vs 20XX)
        else if (dob1.year.substring(2) === dob2.year.substring(2) &&
                 dob1.month === dob2.month && dob1.day === dob2.day) {
          score += 15;
          matches.push('dob_century_typo');
        }
      }
    }
  }

  // MRN matching
  if (p1.medical_record_number && p2.medical_record_number) {
    const mrn1 = p1.medical_record_number.toString().trim();
    const mrn2 = p2.medical_record_number.toString().trim();
    
    if (mrn1 === mrn2) {
      score += 30;
      matches.push('mrn_exact');
    } else {
      // Check for similar MRNs (one digit off)
      const mrnSimilarity = calculateSimilarity(mrn1, mrn2);
      if (mrnSimilarity >= 90) {
        score += 20;
        matches.push('mrn_similar');
      }
    }
  }

  // Enhanced phone number matching
  if (p1.phone && p2.phone) {
    const phone1 = p1.phone.replace(/\D/g, '');
    const phone2 = p2.phone.replace(/\D/g, '');
    
    if (phone1 === phone2 && phone1.length >= 10) {
      score += 10;
      matches.push('phone_exact');
    } else if (phone1.length >= 10 && phone2.length >= 10) {
      // Check last 4 digits (common for patient identification)
      const last4_1 = phone1.slice(-4);
      const last4_2 = phone2.slice(-4);
      if (last4_1 === last4_2) {
        score += 5;
        matches.push('phone_last4');
      }
    }
  }

  return { score, matches };
};

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    console.log('Starting deduplication...');
    
    // Get all patients with minimal fields for faster processing
    const patients = await base44.asServiceRole.entities.Patient.list();
    console.log(`Loaded ${patients.length} patients in ${Date.now() - startTime}ms`);

    // Quick grouping by MRN and name
    const mrnGroups = new Map();
    const nameGroups = new Map();

    patients.forEach(patient => {
      // Group by MRN (exact matches only)
      if (patient.medical_record_number) {
        const mrn = patient.medical_record_number.toString().trim().toUpperCase();
        if (!mrnGroups.has(mrn)) mrnGroups.set(mrn, []);
        mrnGroups.get(mrn).push(patient);
      }

      // Group by exact name match
      const nameKey = `${patient.first_name?.toLowerCase().trim() || ''}_${patient.last_name?.toLowerCase().trim() || ''}`;
      if (nameKey !== '_') {
        if (!nameGroups.has(nameKey)) nameGroups.set(nameKey, []);
        nameGroups.get(nameKey).push(patient);
      }
    });

    console.log(`Grouped into ${mrnGroups.size} MRN groups, ${nameGroups.size} name groups`);

    const duplicateGroups = [];
    const processed = new Set();

    // Process exact MRN matches (100% confidence)
    for (const [mrn, group] of mrnGroups) {
      if (group.length > 1) {
        const unprocessed = group.filter(p => !processed.has(p.id));
        if (unprocessed.length > 1) {
          duplicateGroups.push({
            primary: unprocessed[0],
            duplicates: unprocessed.slice(1).map(p => ({
              patient: p,
              score: 100,
              matches: ['mrn_exact']
            }))
          });
          unprocessed.forEach(p => processed.add(p.id));
        }
      }
    }

    // Process exact name matches with DOB/Address checks
    let groupsProcessed = 0;
    for (const [nameKey, group] of nameGroups) {
      if (group.length > 1) {
        const unprocessed = group.filter(p => !processed.has(p.id));
        if (unprocessed.length < 2) continue;

        // Process groups up to 100 patients
        const limit = Math.min(unprocessed.length, 100);
        for (let i = 0; i < limit; i++) {
          if (processed.has(unprocessed[i].id)) continue;

          const duplicates = [];
          for (let j = i + 1; j < limit; j++) {
            if (processed.has(unprocessed[j].id)) continue;

            const { score, matches } = calculateMatchScore(unprocessed[i], unprocessed[j]);
            // Lowered threshold from 60 to 50 to catch more potential duplicates
            if (score >= 50) {
              duplicates.push({ patient: unprocessed[j], score, matches });
              processed.add(unprocessed[j].id);
            }
          }

          if (duplicates.length > 0) {
            duplicateGroups.push({ primary: unprocessed[i], duplicates });
            processed.add(unprocessed[i].id);
          }
        }
        
        groupsProcessed++;
      }

      // Check timeout every 20 groups
      if (groupsProcessed % 20 === 0 && Date.now() - startTime > 20000) {
        console.log('Approaching timeout, stopping search');
        break;
      }
    }

    console.log(`Found ${duplicateGroups.length} groups in ${Date.now() - startTime}ms`);

    // Remove duplicates with timeout protection
    const removed = [];
    const detailsArray = [];

    // Process deletions in batches to avoid timeout
    const batchSize = 5;
    for (let i = 0; i < duplicateGroups.length; i += batchSize) {
      // Check timeout
      if (Date.now() - startTime > 25000) {
        console.log('Timeout protection - stopping removal');
        break;
      }

      const batch = duplicateGroups.slice(i, i + batchSize);
      
      for (const group of batch) {
        // Sort by status (active first) then by created_date
        const allInGroup = [group.primary, ...group.duplicates.map(d => d.patient)];
        allInGroup.sort((a, b) => {
          if (a.status === 'active' && b.status !== 'active') return -1;
          if (a.status !== 'active' && b.status === 'active') return 1;
          const dateA = a.created_date ? new Date(a.created_date).getTime() : 0;
          const dateB = b.created_date ? new Date(b.created_date).getTime() : 0;
          return dateB - dateA;
        });

        const keep = allInGroup[0];
        const toRemove = allInGroup.slice(1);

        const removedFromGroup = [];
        for (const patient of toRemove) {
          try {
            // Quick deletion without checking related records first
            await base44.asServiceRole.entities.Patient.delete(patient.id).catch(async (err) => {
              // If direct delete fails, delete related records first
              const [visits, carePlans, alerts, incidents, tasks] = await Promise.all([
                base44.asServiceRole.entities.Visit.filter({ patient_id: patient.id }).catch(() => []),
                base44.asServiceRole.entities.CarePlan.filter({ patient_id: patient.id }).catch(() => []),
                base44.asServiceRole.entities.PatientAlert.filter({ patient_id: patient.id }).catch(() => []),
                base44.asServiceRole.entities.Incident.filter({ patient_id: patient.id }).catch(() => []),
                base44.asServiceRole.entities.Task.filter({ patient_id: patient.id }).catch(() => [])
              ]);

              await Promise.all([
                ...visits.map(v => base44.asServiceRole.entities.Visit.delete(v.id).catch(() => {})),
                ...carePlans.map(cp => base44.asServiceRole.entities.CarePlan.delete(cp.id).catch(() => {})),
                ...alerts.map(a => base44.asServiceRole.entities.PatientAlert.delete(a.id).catch(() => {})),
                ...incidents.map(i => base44.asServiceRole.entities.Incident.delete(i.id).catch(() => {})),
                ...tasks.map(t => base44.asServiceRole.entities.Task.delete(t.id).catch(() => {}))
              ]);
              
              await base44.asServiceRole.entities.Patient.delete(patient.id);
            });
            
            removedFromGroup.push({
              id: patient.id,
              name: `${patient.first_name} ${patient.last_name}`,
              mrn: patient.medical_record_number || 'N/A',
              match_score: group.duplicates.find(d => d.patient.id === patient.id)?.score || 100
            });
          } catch (err) {
            console.error(`Failed to delete ${patient.id}:`, err.message);
          }
        }

        removed.push(...removedFromGroup);
        detailsArray.push({
          kept: {
            id: keep.id,
            name: `${keep.first_name} ${keep.last_name}`,
            mrn: keep.medical_record_number || 'N/A',
            status: keep.status
          },
          removed: removedFromGroup
        });
      }
    }

    // Calculate confidence levels for results
    const resultsWithConfidence = detailsArray.map(detail => {
      const avgScore = detail.removed.length > 0 
        ? detail.removed.reduce((sum, r) => sum + r.match_score, 0) / detail.removed.length 
        : 100;
      
      let confidence = 'High';
      if (avgScore < 70) confidence = 'Medium';
      if (avgScore < 50) confidence = 'Low';
      
      return {
        ...detail,
        confidence,
        average_match_score: Math.round(avgScore)
      };
    });

    return Response.json({
      success: true,
      duplicate_groups_found: duplicateGroups.length,
      patients_removed: removed.length,
      removed_patients: removed,
      details: resultsWithConfidence
    });
  } catch (error) {
    console.error('Deduplication error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack,
      details: 'Check function logs for more information'
    }, { status: 500 });
  }
});