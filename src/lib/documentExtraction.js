/**
 * Reading structured patient data out of an uploaded document, on either
 * backend.
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
 * Ask whichever backend is configured to extract patient data from `file`.
 *
 * Answers the function's own envelope in both cases, so the caller's branch on
 * `status` is unchanged. `onUploaded` fires when the document has left the
 * browser, which is the moment the screen stops saying "uploading" — on the
 * owned path there is no second step to wait for, so it fires once the bytes
 * are encoded and the request is about to go.
 */
export async function extractPatientDataFromDocument(transport, file, options = {}) {
  const { invoke, uploadFile } = transport;
  const { independent = false, readAsBase64 = fileToBase64, onUploaded = () => {} } = options;
  let params;
  if (independent) {
    // Refused here rather than at the service, so the person is told their
    // document is too large instead of watching a request fail after the whole
    // of it has been read and encoded.
    if (file.size > OWNED_DOCUMENT_MAX_BYTES) {
      return {
        status: 'error',
        details: 'This document is too large to scan. Please use one under 8 MB.',
        patient_data: null,
      };
    }
    // `content_type` is the type the browser reported, past the one alias it
    // uses that the runtime does not name. The handler and the runtime both
    // check it against the bytes, so a wrong one is refused rather than
    // trusted.
    params = { base64: await readAsBase64(file), content_type: runtimeContentType(file.type) };
  } else {
    const upload = await uploadFile({ file });
    params = { file_url: upload.file_url };
  }
  // ONE invocation, with the branch deciding only what it carries. Two would
  // read as two capabilities to `check:base44-surface`'s function-invocation
  // ratchet, and the surface did not grow — the same call moved.
  onUploaded();
  const response = await invoke(params);
  return response?.data;
}
