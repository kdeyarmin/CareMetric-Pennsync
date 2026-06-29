/**
 * Fuzzy patient-matching score for OASIS document → patient-record linking.
 *
 * Pure, deterministic scoring extracted from OASISAnalyzer so the multi-strategy
 * matching algorithm (name similarity with typo/phonetic tolerance, DOB, phone,
 * and address verification) can be unit-tested without rendering the ~3.1k-LOC
 * page. No React, no network — all extracted values are passed in as arguments.
 *
 * The two identity hints that previously came from component state — `extractedPhone`
 * and `extractedAddress` — are now explicit parameters; callers compute them from
 * the analysis result exactly as before.
 *
 * @param {string} extractedName  Patient name parsed from the document.
 * @param {object} patient        Candidate patient record (first_name, last_name, date_of_birth, phone, address).
 * @param {string} [extractedDOB] DOB parsed from the document.
 * @param {string} [extractedPhone] Phone parsed from the document.
 * @param {string} [extractedAddress] Address parsed from the document.
 * @returns {{ confidence: number, matchFactors: string[], dobMatch: boolean, addressMatch: boolean, phoneMatch: boolean, matchQuality: 'poor'|'fair'|'good'|'very_good'|'excellent', verifiedIdentifiers: number }}
 */
export function calculatePatientMatchScore(extractedName, patient, extractedDOB, extractedPhone, extractedAddress) {
  let confidence = 0;
  const matchFactors = [];
  let dobMatch = false;

  const extractedNameRaw = String(extractedName ?? '');
  const extractedNameClean = extractedNameRaw.toLowerCase().replace(/[^a-z\s]/g, '').trim();
  const nameParts = extractedNameClean.split(/\s+/).filter(p => p.length > 1);

  const fullName = `${patient.first_name || ''} ${patient.last_name || ''}`.trim().toLowerCase();
  const firstName = (patient.first_name || '').toLowerCase();
  const lastName = (patient.last_name || '').toLowerCase();

  // Levenshtein distance for typo tolerance
  const levenshteinDistance = (a, b) => {
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }
    return matrix[b.length][a.length];
  };

  const similarity = (a, b) => {
    const distance = levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length);
    return maxLen > 0 ? ((maxLen - distance) / maxLen) * 100 : 0;
  };

  // Strategy 1: Exact full name match
  if (fullName === extractedNameClean) {
    confidence += 50;
    matchFactors.push('Exact name match');
  } else {
    // Check similarity with typo tolerance
    const fullNameSimilarity = similarity(fullName, extractedNameClean);
    if (fullNameSimilarity >= 90) {
      confidence += 45;
      matchFactors.push('Near-exact match (minor typo tolerance)');
    } else if (fullNameSimilarity >= 80) {
      confidence += 35;
      matchFactors.push('High name similarity');
    }
  }

  // Strategy 2: Handle "LastName, FirstName" format
  if (extractedNameRaw.includes(',')) {
    const [lastPart, firstPart] = extractedNameRaw.split(',').map(s => s.trim().toLowerCase().replace(/[^a-z\s]/g, ''));
    const lastSim = similarity(lastPart, lastName);
    const firstSim = similarity(firstPart, firstName);

    if (lastSim >= 90 && firstSim >= 90) {
      confidence += 45;
      matchFactors.push('Comma-separated format match');
    } else if (lastSim >= 80 && firstSim >= 80) {
      confidence += 35;
      matchFactors.push('Comma-separated format (partial)');
    }
  }

  // Strategy 3: Component name matching
  if (nameParts.length >= 2) {
    let firstNameMatched = false;
    let lastNameMatched = false;

    nameParts.forEach(part => {
      const firstSim = similarity(part, firstName);
      const lastSim = similarity(part, lastName);

      if (firstSim >= 90) {
        firstNameMatched = true;
        confidence += 20;
      } else if (firstSim >= 80) {
        firstNameMatched = true;
        confidence += 15;
      }

      if (lastSim >= 90) {
        lastNameMatched = true;
        confidence += 20;
      } else if (lastSim >= 80) {
        lastNameMatched = true;
        confidence += 15;
      }
    });

    if (firstNameMatched && lastNameMatched) {
      matchFactors.push('First and last name matched');
    } else if (lastNameMatched) {
      matchFactors.push('Last name matched');
    } else if (firstNameMatched) {
      matchFactors.push('First name matched');
    }
  }

  // Strategy 4: Initial matching (e.g., "J. Smith")
  const initials = nameParts.map(p => p.charAt(0)).join('');
  const patientInitials = (firstName.charAt(0) + lastName.charAt(0));
  // Require both patient initials to be present. A blank patient record yields
  // "" (or a 1-char string), and `initials.includes("")` is always true — which
  // would award an "Initials match" to any extracted name against an empty record.
  if (patientInitials.length === 2 && (initials === patientInitials || initials.includes(patientInitials))) {
    confidence += 10;
    matchFactors.push('Initials match');
  }

  // Strategy 5: Soundex/phonetic matching for common misspellings
  const soundex = (str) => {
    const code = str.toUpperCase().charAt(0);
    const mapping = { B: 1, F: 1, P: 1, V: 1, C: 2, G: 2, J: 2, K: 2, Q: 2, S: 2, X: 2, Z: 2, D: 3, T: 3, L: 4, M: 5, N: 5, R: 6 };
    return code + str.slice(1).toUpperCase().replace(/[^A-Z]/g, '').split('').map(c => mapping[c] || '').filter((v, i, a) => i === 0 || v !== a[i - 1]).join('').substring(0, 3).padEnd(3, '0');
  };

  if (lastName.length >= 3 && nameParts.length > 0) {
    const lastPartSoundex = soundex(nameParts[nameParts.length - 1]);
    const lastNameSoundex = soundex(lastName);
    if (lastPartSoundex === lastNameSoundex) {
      confidence += 10;
      matchFactors.push('Phonetic match (sounds like)');
    }
  }

  // Phone Number Matching (HIGH VALUE)
  let phoneMatch = false;
  if (extractedPhone && patient.phone) {
    const normalizePhone = (phone) => phone.replace(/\D/g, '');
    const extractedPhoneNorm = normalizePhone(extractedPhone);
    const patientPhoneNorm = normalizePhone(patient.phone);

    if (extractedPhoneNorm === patientPhoneNorm && extractedPhoneNorm.length >= 10) {
      confidence += 25;
      phoneMatch = true;
      matchFactors.push('✓ Phone number verified');
    } else if (extractedPhoneNorm.length >= 10 && patientPhoneNorm.length >= 10) {
      // Check last 4 digits (common for verification)
      if (extractedPhoneNorm.slice(-4) === patientPhoneNorm.slice(-4)) {
        confidence += 10;
        matchFactors.push('Phone last 4 digits match');
      }
    }
  }

  // DOB Verification (CRITICAL - can add or subtract confidence)
  let addressMatch = false;

  if (extractedDOB && patient.date_of_birth) {
    // Parse each DOB into Y/M/D components so verification doesn't depend on the
    // two sources sharing a digit ORDER. The document DOB is typically US
    // MM/DD/YYYY while the patient record is ISO YYYY-MM-DD; comparing raw digit
    // strings (the previous approach) made the SAME person's DOB look different
    // across formats — suppressing correct links and weakening this critical
    // identity check exactly when formats differ.
    const parseDobParts = (dob) => {
      const s = String(dob || '').trim();
      const isValidParts = (y, mo, d) => {
        const parsed = new Date(Date.UTC(y, mo - 1, d));
        return (
          !Number.isNaN(parsed.getTime()) &&
          parsed.getUTCFullYear() === y &&
          parsed.getUTCMonth() + 1 === mo &&
          parsed.getUTCDate() === d
        );
      };
      const pivotYear = (year) => {
        const candidate = 2000 + Number(year);
        const referenceYear = new Date().getUTCFullYear();
        return candidate > referenceYear ? candidate - 100 : candidate;
      };
      let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // ISO YYYY-MM-DD
      if (m) {
        const parts = { y: +m[1], mo: +m[2], d: +m[3] };
        return isValidParts(parts.y, parts.mo, parts.d) ? parts : null;
      }
      m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);     // US MM/DD/YYYY
      if (m) {
        const parts = { y: +m[3], mo: +m[1], d: +m[2] };
        return isValidParts(parts.y, parts.mo, parts.d) ? parts : null;
      }
      m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})(?!\d)/); // US MM/DD/YY
      if (m) {
        const parts = { y: pivotYear(m[3]), mo: +m[1], d: +m[2] };
        return isValidParts(parts.y, parts.mo, parts.d) ? parts : null;
      }
      const yearOnly = s.match(/(\d{4})/);                      // year-only fallback
      if (yearOnly) return { y: +yearOnly[1], mo: null, d: null };
      return null;
    };

    const eDob = parseDobParts(extractedDOB);
    const pDob = parseDobParts(patient.date_of_birth);

    if (eDob && pDob) {
      const haveFullDates =
        eDob.mo != null && eDob.d != null && pDob.mo != null && pDob.d != null;
      if (haveFullDates && eDob.y === pDob.y && eDob.mo === pDob.mo && eDob.d === pDob.d) {
        confidence += 30;
        dobMatch = true;
        matchFactors.push('✓ Date of birth verified');
      } else if (eDob.y === pDob.y) {
        confidence += 10;
        matchFactors.push('Birth year matches');
      } else {
        confidence -= 20;
        matchFactors.push('⚠ Date of birth does NOT match');
      }
    }
  }

  // Address Verification (MODERATE-HIGH VALUE) - Enhanced
  if (extractedAddress && patient.address) {
    const normalizeAddress = (addr) => addr.toLowerCase()
      .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|place|pl|parkway|pkwy|way|apartment|apt|unit|ste|suite|#)\b/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const extractedAddrNorm = normalizeAddress(extractedAddress);
    const patientAddrNorm = normalizeAddress(patient.address);

    // Strategy 1: Exact normalized match
    if (extractedAddrNorm === patientAddrNorm && extractedAddrNorm.length >= 10) {
      confidence += 20;
      addressMatch = true;
      matchFactors.push('✓ Address exact match');
    } else {
      // Strategy 2: Street number + street name match
      const extractedStreetNum = extractedAddress.match(/^\d+/)?.[0];
      const patientStreetNum = patient.address.match(/^\d+/)?.[0];

      if (extractedStreetNum && extractedStreetNum === patientStreetNum) {
        // Derive the street name, skipping the house number and keeping an optional
        // leading directional (n/s/e/w) as part of the key — otherwise "123 N Main"
        // and "123 N Oak" both reduce to the directional "n" and falsely match.
        const streetKeyOf = (normalized) => {
          const tokens = normalized.split(/\s+/).filter(Boolean);
          let i = 0;
          while (i < tokens.length && /^\d+$/.test(tokens[i])) i++; // skip house number
          let dir = '';
          if (i < tokens.length && /^[nsew]$/.test(tokens[i])) { dir = tokens[i]; i++; }
          while (i < tokens.length && /^\d+$/.test(tokens[i])) i++; // skip stray numbers
          const name = tokens[i];
          if (!name) return undefined;
          return dir ? `${dir} ${name}` : name;
        };
        const extractedStreetName = streetKeyOf(extractedAddrNorm);
        const patientStreetName = streetKeyOf(patientAddrNorm);

        if (extractedStreetName && patientStreetName && similarity(extractedStreetName, patientStreetName) >= 80) {
          confidence += 18;
          addressMatch = true;
          matchFactors.push('✓ Street number and name match');
        } else if (extractedStreetName && patientStreetName) {
          confidence += 12;
          addressMatch = true;
          matchFactors.push('Street number matches');
        }
      }

      // Strategy 3: Overall similarity
      if (!addressMatch && extractedAddrNorm.length >= 10) {
        const addrSimilarity = similarity(extractedAddrNorm, patientAddrNorm);
        if (addrSimilarity >= 85) {
          confidence += 15;
          addressMatch = true;
          matchFactors.push('Address very similar');
        } else if (addrSimilarity >= 70) {
          confidence += 10;
          addressMatch = true;
          matchFactors.push('Address similar');
        } else if (addrSimilarity >= 60) {
          confidence += 5;
          matchFactors.push('Address partial match');
        }
      }

      // Strategy 4: Zip code match (if present)
      const extractedZip = extractedAddress.match(/\b\d{5}\b/)?.[0];
      const patientZip = patient.address.match(/\b\d{5}\b/)?.[0];
      if (extractedZip && extractedZip === patientZip) {
        confidence += 8;
        matchFactors.push('Zip code match');
      }
    }
  }

  // Cap confidence at 100
  confidence = Math.min(100, Math.max(0, confidence));

  // Calculate match quality level
  let matchQuality = 'poor';
  if (confidence >= 85) matchQuality = 'excellent';
  else if (confidence >= 70) matchQuality = 'very_good';
  else if (confidence >= 55) matchQuality = 'good';
  else if (confidence >= 40) matchQuality = 'fair';

  // Count verified identifiers for additional context
  const verifiedIdentifiers = [dobMatch, phoneMatch, addressMatch].filter(Boolean).length;

  return {
    confidence: Math.round(confidence),
    matchFactors,
    dobMatch,
    addressMatch,
    phoneMatch,
    matchQuality,
    verifiedIdentifiers
  };
}
