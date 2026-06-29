const PAYER_NOISE_REGEX = /medicare|hmo|ppo|upmc|anthem|aetna|gateway|security blue|freedom blue|bcbs|blue cross|blue shield|payor|pps/i;

const cleanPart = (value) => String(value || "").replace(/\s+/g, " ").replace(/,$/, "").trim();

const parseCommaName = (value) => {
  const raw = String(value || "").trim();
  if (!raw.includes(",")) return null;

  const [lastName, remainder = ""] = raw.split(",");
  const cleanedLast = cleanPart(lastName);
  const cleanedRemainder = cleanPart(remainder);
  const nameBits = cleanedRemainder.split(/\s+/).filter(Boolean);
  if (!cleanedLast || nameBits.length === 0) return null;

  if (PAYER_NOISE_REGEX.test(cleanedRemainder)) {
    return {
      first: cleanedLast,
      middle: "",
      last: "",
    };
  }

  return {
    first: cleanPart(nameBits[0]),
    middle: cleanPart(nameBits.slice(1).join(" ")),
    last: cleanedLast,
  };
};

const sanitizePieces = (pieces) => pieces.filter(Boolean).filter((piece) => !PAYER_NOISE_REGEX.test(piece));

export function getPatientDisplayParts(patient) {
  const first = cleanPart(patient?.first_name);
  const middle = cleanPart(patient?.middle_name);
  const last = cleanPart(patient?.last_name);

  const combined = [first, middle, last].filter(Boolean).join(" ");
  const parsedCombined = parseCommaName(combined);
  if (parsedCombined) {
    return parsedCombined;
  }

  const parsedFirst = parseCommaName(first);
  if (parsedFirst) {
    return parsedFirst;
  }

  const safePieces = sanitizePieces([first, middle, last]);
  if (safePieces.length >= 2) {
    return {
      first: safePieces[0],
      middle: safePieces.length > 2 ? safePieces.slice(1, -1).join(" ") : "",
      last: safePieces[safePieces.length - 1],
    };
  }

  return {
    first: safePieces[0] || cleanPart(patient?.patient_name) || "Unknown",
    middle: "",
    last: safePieces[1] || "",
  };
}

export function getPatientDisplayName(patient) {
  const parts = getPatientDisplayParts(patient);
  return [parts.first, parts.middle, parts.last].filter(Boolean).join(" ").trim();
}

export function getPatientInitials(patient) {
  const parts = getPatientDisplayParts(patient);
  return `${parts.first?.[0] || ""}${parts.last?.[0] || parts.first?.[1] || ""}`.toUpperCase();
}