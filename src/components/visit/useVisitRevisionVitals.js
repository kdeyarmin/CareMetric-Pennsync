import { useLayoutEffect, useRef, useState } from 'react';

const emptyRevision = (key) => ({ key, initialized: false, values: {}, dirty: false, sourceVersion: null, confirmedWrite: null });

// The broker removes null/absent vital fields; zero remains a recorded value.
const normalizedVitals = (values) => JSON.stringify(Object.entries(values || {})
  .filter(([, value]) => value !== null && value !== undefined)
  .sort(([left], [right]) => left.localeCompare(right)));

/** In-memory buffer. The caller supplies an exact authority key and gates both
 * authorized source records with ready. Pending reads retain edits but hide PHI;
 * changing/denying the authority must change/null the key. Never stores drafts. */
export function useVisitRevisionVitals({ authorityKey, ready, visit }) {
  const liveAuthority = useRef({ authorityKey, ready });
  liveAuthority.current = { authorityKey, ready };
  const [revision, setRevision] = useState(() => emptyRevision(null));
  const current = revision.key === authorityKey && revision.initialized;
  const values = ready ? (current ? revision.values : visit?.vital_signs || {}) : {};
  const dirty = Boolean(current && revision.dirty);
  // This detects an already observed revision; it is not server-side compare-and-swap.
  // A change after the final authorized read still requires a backend version guard.
  const conflict = Boolean(ready && current && dirty && revision.sourceVersion !== visit.updated_date
    && revision.confirmedWrite !== normalizedVitals(visit.vital_signs));

  useLayoutEffect(() => {
    setRevision((previous) => {
      const sameKey = previous.key === authorityKey;
      if (!ready) return sameKey ? previous : emptyRevision(authorityKey);
      if (sameKey && previous.initialized && (previous.dirty
        || previous.sourceVersion === visit.updated_date)) return previous;
      return { key: authorityKey, initialized: true, values: { ...visit.vital_signs },
        dirty: false, sourceVersion: visit.updated_date, confirmedWrite: null };
    });
  }, [authorityKey, ready, visit]);

  const change = (next) => {
    if (!ready || !authorityKey || !liveAuthority.current.ready
      || liveAuthority.current.authorityKey !== authorityKey) return;
    setRevision((previous) => {
      const sameKey = previous.key === authorityKey && previous.initialized;
      const currentValues = sameKey ? previous.values : visit.vital_signs || {};
      return { key: authorityKey, initialized: true, values: { ...currentValues, ...next },
        dirty: (sameKey && previous.dirty) || Object.keys(next).some((field) => next[field] !== currentValues[field]),
        sourceVersion: sameKey ? previous.sourceVersion : visit.updated_date,
        confirmedWrite: sameKey ? previous.confirmedWrite : null };
    });
  };

  const clear = () => setRevision((previous) => previous.key === authorityKey
    ? { ...previous, values: {}, dirty: true, initialized: true } : previous);

  // Record only an acknowledged documentation write, including one whose
  // supporting records are still pending. A newer authorized source matching
  // these exact normalized values can finish that same receipt safely. A
  // different vital value still conflicts; a lost documentation response alone
  // is not proof. Do not clear edits made while the write was pending.
  const markWritten = (writtenValues, confirmed, documentationConfirmed = confirmed) => setRevision((previous) => previous.key === authorityKey
    ? { ...previous,
      dirty: confirmed && previous.values === writtenValues ? false : previous.dirty,
      confirmedWrite: documentationConfirmed ? normalizedVitals(writtenValues) : previous.confirmedWrite }
    : previous);

  return { values, dirty, conflict, change, clear, markWritten };
}
