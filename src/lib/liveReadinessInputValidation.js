const OBJECT_TYPE = "object";

function isObject(value) {
  return Boolean(value) && typeof value === OBJECT_TYPE && !Array.isArray(value);
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

export function validateLiveReadinessInput(input) {
  const errors = [];
  if (!isObject(input)) {
    addError(errors, "$", "Input must be a JSON object.");
    return errors;
  }

  if (input.release !== undefined && !isObject(input.release)) {
    addError(errors, "release", "Release must be an object when provided.");
  }
  if (input.evidence !== undefined && !isObject(input.evidence)) {
    addError(errors, "evidence", "Evidence must be an object keyed by capability id when provided.");
  }
  if (input.matrix !== undefined && !Array.isArray(input.matrix)) {
    addError(errors, "matrix", "Matrix must be an array when provided.");
  }

  if (isObject(input.evidence)) {
    for (const [capabilityId, capabilityEvidence] of Object.entries(input.evidence)) {
      if (!isObject(capabilityEvidence)) {
        addError(errors, `evidence.${capabilityId}`, "Capability evidence must be an object.");
        continue;
      }
      if (capabilityEvidence.reviewers !== undefined && !isObject(capabilityEvidence.reviewers)) {
        addError(errors, `evidence.${capabilityId}.reviewers`, "Reviewers must be an object keyed by reviewer role.");
      }
      for (const [key, entry] of Object.entries(capabilityEvidence)) {
        if (key === "reviewers") continue;
        if (isObject(entry) && entry.references !== undefined && !Array.isArray(entry.references)) {
          addError(errors, `evidence.${capabilityId}.${key}.references`, "Evidence references must be an array when provided.");
        }
      }
    }
  }

  if (Array.isArray(input.matrix)) {
    input.matrix.forEach((capability, index) => {
      if (!isObject(capability)) {
        addError(errors, `matrix.${index}`, "Capability matrix row must be an object.");
        return;
      }
      for (const field of ["id", "capability", "priority", "risk"]) {
        if (!capability[field]) {
          addError(errors, `matrix.${index}.${field}`, "Capability matrix row is missing a required field.");
        }
      }
    });
  }

  return errors;
}

export function formatLiveReadinessInputErrors(errors) {
  return errors.map((error) => `${error.path}: ${error.message}`).join("; ");
}
