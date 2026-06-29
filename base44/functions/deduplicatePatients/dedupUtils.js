// Pure, dependency-free helpers for patient deduplication scoring.
//
// Kept free of Deno/Base44 runtime APIs so they can be unit tested with
// `node --test` and imported by the edge function in entry.ts. This is the
// scoring/normalization contract used to decide whether two existing patient
// records are the same person.

// Common nicknames map
export const NICKNAMES = {
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
export const areNicknames = (name1, name2) => {
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
export const levenshteinDistance = (str1, str2) => {
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
export const calculateSimilarity = (str1, str2) => {
  if (!str1 || !str2) return 0;
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  return maxLength === 0 ? 100 : ((maxLength - distance) / maxLength) * 100;
};

// Parse date components from various formats (digit-based; used for the
// fuzzy "variation" checks such as reversed month/day and year typos).
export const parseDateComponents = (dateStr) => {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/\D/g, '');

  // Try 8-digit formats (YYYYMMDD or MMDDYYYY)
  if (cleaned.length === 8) {
    // Check if first 4 digits look like a year (19xx or 20xx)
    const first4 = parseInt(cleaned.substring(0, 4));
    if (first4 >= 1900 && first4 <= 2100) {
      // YYYYMMDD format
      return {
        year: cleaned.substring(0, 4),
        month: cleaned.substring(4, 6),
        day: cleaned.substring(6, 8)
      };
    } else {
      // MMDDYYYY format
      return {
        year: cleaned.substring(4, 8),
        month: cleaned.substring(0, 2),
        day: cleaned.substring(2, 4)
      };
    }
  }

  return null;
};

// Normalize a DOB in any of the formats we see (ISO, M/D/Y with 2- or 4-digit
// years, or 8 packed digits) to a canonical YYYY-MM-DD string, or null when it
// can't be parsed. Two-digit years are pivoted into the past so a DOB like
// "04/15/45" resolves to 1945-04-15, matching the import-side behavior. This
// lets the exact-match check recognize the same date written two different
// ways (e.g. "1945-04-15" vs "04/15/1945"), which a raw digit compare missed.
export const normalizeDob = (value, referenceYear = new Date().getUTCFullYear()) => {
  if (!value && value !== 0) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const pivotYear = (year) => {
    if (year.length !== 2) return year;
    const candidate = 2000 + Number(year);
    return String(candidate > referenceYear ? candidate - 100 : candidate);
  };

  const isValidYmd = (y, m, d) => {
    const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return false;
    return date.getUTCMonth() + 1 === Number(m) && date.getUTCDate() === Number(d);
  };

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-');
    return isValidYmd(y, m, d) ? raw : null;
  }

  const slashMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
  if (slashMatch) {
    let [, month, day, year] = slashMatch;
    year = pivotYear(year);
    month = month.padStart(2, '0');
    day = day.padStart(2, '0');
    return isValidYmd(year, month, day) ? `${year}-${month}-${day}` : null;
  }

  // 8 packed digits, reuse the YYYYMMDD / MMDDYYYY heuristic.
  const components = parseDateComponents(raw);
  if (components && isValidYmd(components.year, components.month, components.day)) {
    return `${components.year}-${components.month}-${components.day}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

// Normalize names (remove commas and extra spaces)
const normalizeName = (str) => str?.toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ').trim() || '';

// Calculate match score between two patients
export const calculateMatchScore = (p1, p2) => {
  let score = 0;
  const matches = [];

  // Name matching with fuzzy logic
  const firstName1 = normalizeName(p1.first_name);
  const firstName2 = normalizeName(p2.first_name);
  const lastName1 = normalizeName(p1.last_name);
  const lastName2 = normalizeName(p2.last_name);
  const fullName1 = `${firstName1} ${lastName1}`;
  const fullName2 = `${firstName2} ${lastName2}`;

  // Calculate name similarities first
  const firstNameSimilarity = calculateSimilarity(firstName1, firstName2);
  const lastNameSimilarity = calculateSimilarity(lastName1, lastName2);
  const fullNameSimilarity = calculateSimilarity(fullName1, fullName2);

  // Exact match
  if (fullName1 === fullName2) {
    score += 40;
    matches.push('name_exact');
  }
  // Nickname matching
  else if (areNicknames(firstName1, firstName2) && lastNameSimilarity >= 95) {
    score += 38;
    matches.push('nickname_match');
  }
  // Fuzzy match on full name (lowered threshold to 80%)
  else {
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

    if (firstNameSimilarity >= 90 && lastNameSimilarity >= 90) {
      score += 30;
      matches.push('name_components_similar');
    } else if (firstNameSimilarity >= 85 || lastNameSimilarity >= 95) {
      score += 20;
      matches.push('name_partial_strong');
    } else if (firstNameSimilarity === 100 || lastNameSimilarity === 100) {
      score += 15;
      matches.push('name_partial');
    }

    // Check for initials vs full name (e.g., "J. Smith" vs "John Smith")
    if (firstName1.length === 1 && firstName2.startsWith(firstName1) && lastNameSimilarity >= 95) {
      score += 25;
      matches.push('initial_vs_full_name');
    } else if (firstName2.length === 1 && firstName1.startsWith(firstName2) && lastNameSimilarity >= 95) {
      score += 25;
      matches.push('initial_vs_full_name');
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

    // Canonicalize to ISO so the same date written in different formats
    // (or with a 2-digit year) is still recognized as an exact match.
    const iso1 = normalizeDob(p1.date_of_birth);
    const iso2 = normalizeDob(p2.date_of_birth);
    const exactMatch = (iso1 && iso2) ? iso1 === iso2 : dob1Str === dob2Str;

    if (exactMatch) {
      score += 30;
      matches.push('dob_exact');
    } else {
      // Parse date components. Prefer the canonical ISO (handles 2-digit years
      // and slash formats) so the variation checks below aren't silently
      // skipped for the messy data this fuzzy layer exists to catch; fall back
      // to the raw 8-digit heuristic only when normalization failed.
      const isoToComponents = (iso) => {
        if (!iso) return null;
        const [year, month, day] = iso.split('-');
        return { year, month, day };
      };
      const dob1 = isoToComponents(iso1) || parseDateComponents(p1.date_of_birth);
      const dob2 = isoToComponents(iso2) || parseDateComponents(p2.date_of_birth);

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
