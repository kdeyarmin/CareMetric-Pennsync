// Pure byte helpers shared by the public signer page and staff signing
// screens. Nothing here imports an SDK, reads a record or makes a request.

export class SignatureFileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SignatureFileError';
  }
}

export function base64ToBytes(value) {
  if (typeof value !== 'string' || !value) throw new SignatureFileError('The document was empty');
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Turn the signature pad's PNG data URL into the File the signing brokers accept. */
export function signatureFileFromDataUrl(dataUrl, name = 'signature.png') {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new SignatureFileError('Draw or type a signature first');
  const bytes = base64ToBytes(match[1]);
  if (bytes.length < 100) throw new SignatureFileError('Draw or type a signature first');
  return new File([bytes], name, { type: 'image/png' });
}
