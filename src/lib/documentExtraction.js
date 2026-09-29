/**
 * Reading structured data out of an uploaded document, on either backend.
 *
 * Two capabilities go through here — the intake scanner's patient fields and
 * the ingestion screen's clinical record. They differ only in their answer's
 * envelope; the transport is one thing and is deliberately not copied per
 * screen.
 *
 * The two paths differ in SHAPE and not in authority, which is why this module
 * exists rather than a branch inside the screen:
 *
 * - **Base44**: the browser uploads the file to the platform's storage and
 *   passes the resulting `file_url` to the function, which fetches it back.
 * - **The owned service**: the browser sends the BYTES. The handler brokers the
 *   upload itself, so the object is minted under the same subject that reads
 *   it — which is what the integration runtime requires, and what a browser
 *   upload followed by a service read could never satisfy. The owned build's
 *   `integrations` namespace refuses by name in any case, so there is no
 *   browser upload on that path to pass a locator from.
 *
 * Nothing here decides who may do this. Both backends authorize the call
 * themselves; this only picks the call shape.
 *
 * It is handed two bound functions rather than the SDK client. The client is a
 * containment boundary — `patientVisitReadContainmentContract` refuses a bare
 * `base44` passed as a call argument, and rightly: a module holding the client
 * holds every entity, upload and auth path with it. Two functions are the whole
 * of what this needs.
 *
 * `invoke` is bound to the capability NAME at the call site rather than taking
 * one here, and that is deliberate. `tools-ported-call-sites.mjs` finds a
 * ported call by its literal name, so passing the name in from a variable would
 * take this site out of that census — the call would still rely on the
 * adapter's bound tenant and nothing would count it any more. A refactor that
 * makes a measurement stop seeing a member is the failure this project keeps
 * recording; keep the literal where the census can read it.
 */

/** The file ceiling the owned handler declares, which is the runtime's own. */
export const OWNED_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Types a browser reports that the owned runtime does not name.
 *
 * `image/jpg` is not a registered media type and the runtime's allowlist is
 * `image/jpeg`, but this screen's own upload validation accepts `image/jpg`
 * explicitly — so a file reported that way is admitted by the browser and
 * would be refused by the runtime as an invalid file, with nothing on the page
 * to say why. Mapped rather than added to the runtime's list, because the
 * bytes really are JPEG and the alias is the browser's.
 */
const CONTENT_TYPE_ALIASES = Object.freeze({ 'image/jpg': 'image/jpeg' });
export const runtimeContentType = reported => CONTENT_TYPE_ALIASES[reported] ?? reported;

/**
 * A file's contents as base64, without the data-URL prefix a `FileReader`
 * result carries.
 *
 * `readAsDataURL` rather than `arrayBuffer` + `btoa`: the second builds a
 * binary string a character at a time, which is a per-byte loop over something
 * that can be eight megabytes, and blows the argument limit if it is done with
 * a spread instead.
 */
export function fileToBase64(file, FileReaderImpl = globalThis.FileReader) {
  return new Promise((resolve, reject) => {
    const reader = new FileReaderImpl();
    reader.onerror = () => reject(new Error('DOCUMENT_READ_FAILED'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (!result.startsWith('data:') || comma < 0) {
        reject(new Error('DOCUMENT_READ_FAILED'));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Send `file` to whichever backend is configured, and answer the capability's
 * own envelope.
 *
 * The branch decides only what the request CARRIES — a locator on the Base44
 * path, the bytes on the owned one — and there is exactly ONE invocation
 * either way. Two would read as two capabilities to `check:base44-surface`'s
 * function-invocation ratchet, and the surface did not grow: the same call
 * moved.
 *
 * `onUploaded` fires when the document has left the browser, which is the
 * moment a screen stops saying "uploading". It is handed the stored locator on
 * the Base44 path and `null` on the owned one, because there is no stored
 * object on that path to name — the handler mints its own under its own
 * subject and nothing outside the service can address it.
 *
 * `tooLarge` supplies the refusal, because the capabilities over this do not
 * share an envelope: one answers `{status, details, patient_data}`, another
 * `{success, error}`. Shaping that here would mean this module deciding what a
 * screen reads, which is the caller's to do.
 *
 * `uploadedUrl` is for a screen that has ALREADY uploaded the document for
 * some other reason — the referral intake stores it on the referral before the
 * split detector ever runs. Passing it means the Base44 path reuses that
 * object instead of uploading a second copy of the same bytes, and the owned
 * path ignores it, because a stored Base44 locator is exactly what the owned
 * handler must never be given.
 */
async function sendDocument(transport, file, options) {
  const { invoke, uploadFile } = transport;
  const {
    independent = false, readAsBase64 = fileToBase64, onUploaded = () => {},
    uploadedUrl = null, locatorKey = 'file_url', tooLarge,
  } = options;
  let params;
  let locator = null;
  if (independent) {
    // Refused here rather than at the service, so the person is told their
    // document is too large instead of watching a request fail after the whole
    // of it has been read and encoded.
    if (file.size > OWNED_DOCUMENT_MAX_BYTES) return tooLarge();
    // `content_type` is the type the browser reported, past the one alias it
    // uses that the runtime does not name. The handler and the runtime both
    // check it against the bytes, so a wrong one is refused rather than
    // trusted.
    params = { base64: await readAsBase64(file), content_type: runtimeContentType(file.type) };
  } else {
    // `locatorKey` is the ORIGINAL's parameter name and differs between them —
    // `file_url` for the two document scanners, `fileUrl` for the referral
    // split. It is the Base44 path's key only; the owned path never carries a
    // locator under any name. Defaulted rather than required because two of
    // the three use the snake_case one, and a wrong key here is a request the
    // original refuses as missing.
    // A screen whose document is already stored passes `uploadedUrl` and no
    // upload function at all, so that it names no Core integration it could
    // never call. Refused by name rather than left to fail as "uploadFile is
    // not a function", which says nothing about what went wrong.
    if (!uploadedUrl && typeof uploadFile !== 'function') throw new Error('DOCUMENT_NO_UPLOAD_PATH');
    locator = uploadedUrl || (await uploadFile({ file })).file_url;
    params = { [locatorKey]: locator };
  }
  onUploaded(locator);
  const response = await invoke(params);
  return response?.data;
}

/** The message a person sees when their document is past the owned ceiling. */
const TOO_LARGE = 'This document is too large to scan. Please use one under 8 MB.';

/**
 * Structured patient fields out of an uploaded document, for the intake
 * scanner. Answers the function's own envelope, so the caller's branch on
 * `status` is unchanged.
 */
export function extractPatientDataFromDocument(transport, file, options = {}) {
  return sendDocument(transport, file, {
    ...options,
    tooLarge: () => ({ status: 'error', details: TOO_LARGE, patient_data: null }),
  });
}

/**
 * The clinical record — patient, vitals, diagnoses, medications — out of an
 * uploaded document, for the ingestion screen. Its envelope is `success` plus
 * `extracted_data`, which is the original's and not this module's.
 */
export function extractClinicalDocument(transport, file, options = {}) {
  return sendDocument(transport, file, {
    ...options,
    tooLarge: () => ({ success: false, error: TOO_LARGE }),
  });
}

/**
 * Whether a referral packet holds several referrals, and where each begins.
 *
 * The intake screen has already stored this document on the Base44 path, so it
 * passes `uploadedUrl` and nothing is uploaded twice. On the owned path the
 * bytes go to the handler; the STORED copy of the referral's document is a
 * separate question and this does not answer it.
 */
export function splitReferralPDF(transport, file, options = {}) {
  return sendDocument(transport, file, {
    locatorKey: 'fileUrl',
    ...options,
    tooLarge: () => ({ success: false, error: TOO_LARGE }),
  });
}
