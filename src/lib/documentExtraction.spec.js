import { describe, expect, it, vi } from 'vitest';
import {
  OWNED_DOCUMENT_MAX_BYTES, extractClinicalDocument, extractPatientDataFromDocument,
  fileToBase64, runtimeContentType,
} from './documentExtraction';

/**
 * The two call shapes, and the one property that matters on each.
 *
 * Base44 stores the document and hands the function a locator; the owned
 * service is handed the bytes so that the subject minting the object is the
 * subject reading it. What these assert is that neither path can turn into the
 * other — a locator never reaches the owned handler, and the Base44 path is
 * untouched, because `src/functions` wrappers and screens serve both backends.
 */
const ANSWER = { status: 'success', patient_data: { first_name: 'Synthetic' } };
const file = (overrides = {}) => ({ size: 1024, type: 'application/pdf', ...overrides });

const clientFor = (answer = ANSWER) => {
  const invoked = [];
  const uploaded = [];
  return {
    invoked,
    uploaded,
    uploadFile: async (payload) => {
      uploaded.push(payload);
      return { file_url: 'https://qtrypzzcjebvfcihiynt.supabase.co/stored.pdf' };
    },
    invoke: async (params) => {
      invoked.push({ name: 'extractPatientDataFromDocument', params });
      return { data: answer };
    },
  };
};

describe('extractPatientDataFromDocument', () => {
  it('uploads first and passes the locator on the Base44 path', async () => {
    const client = clientFor();
    const answer = await extractPatientDataFromDocument(client, file());
    expect(answer).toEqual(ANSWER);
    expect(client.uploaded).toHaveLength(1);
    expect(client.invoked).toEqual([{
      name: 'extractPatientDataFromDocument',
      params: { file_url: 'https://qtrypzzcjebvfcihiynt.supabase.co/stored.pdf' },
    }]);
  });

  it('sends the bytes and never a locator on the owned path', async () => {
    const client = clientFor();
    const answer = await extractPatientDataFromDocument(client, file(), {
      independent: true, readAsBase64: async () => 'QkFTRTY0',
    });
    expect(answer).toEqual(ANSWER);
    // The whole point of the port: no browser upload happens, so there is no
    // object under a different subject for the handler to be asked to read.
    expect(client.uploaded).toHaveLength(0);
    expect(client.invoked).toEqual([{
      name: 'extractPatientDataFromDocument',
      params: { base64: 'QkFTRTY0', content_type: 'application/pdf' },
    }]);
    expect(Object.keys(client.invoked[0].params)).not.toContain('file_url');
  });

  it('refuses a document past the owned ceiling before reading it', async () => {
    const client = clientFor();
    const readAsBase64 = vi.fn();
    const answer = await extractPatientDataFromDocument(
      client, file({ size: OWNED_DOCUMENT_MAX_BYTES + 1 }), { independent: true, readAsBase64 },
    );
    expect(answer.status).toBe('error');
    expect(answer.patient_data).toBeNull();
    // Not read and not sent: encoding eight megabytes to have it refused at the
    // far end is the failure this exists to avoid.
    expect(readAsBase64).not.toHaveBeenCalled();
    expect(client.invoked).toHaveLength(0);
    // And the ceiling is the runtime's own file limit, not a number chosen here.
    expect(OWNED_DOCUMENT_MAX_BYTES).toBe(8 * 1024 * 1024);
  });

  it('the one type this screen allows that the runtime does not name is mapped', async () => {
    // `image/jpg` is not a registered media type; the upload validation on this
    // screen accepts it and the runtime's allowlist is `image/jpeg`, so without
    // the map the browser admits a file the service then calls invalid.
    const client = clientFor();
    await extractPatientDataFromDocument(client, file({ type: 'image/jpg' }),
      { independent: true, readAsBase64: async () => 'QkFTRTY0' });
    expect(client.invoked[0].params.content_type).toBe('image/jpeg');
    // And nothing else is rewritten.
    for (const reported of ['application/pdf', 'image/png', 'image/jpeg', 'text/plain']) {
      expect(runtimeContentType(reported)).toBe(reported);
    }
  });

  it('a document exactly at the ceiling is still accepted', async () => {
    const client = clientFor();
    await extractPatientDataFromDocument(
      client, file({ size: OWNED_DOCUMENT_MAX_BYTES }),
      { independent: true, readAsBase64: async () => 'QkFTRTY0' },
    );
    expect(client.invoked).toHaveLength(1);
  });

  it('reports the upload as finished once, on each path', async () => {
    for (const independent of [false, true]) {
      const client = clientFor();
      const onUploaded = vi.fn();
      await extractPatientDataFromDocument(client, file(),
        { independent, onUploaded, readAsBase64: async () => 'QkFTRTY0' });
      expect(onUploaded).toHaveBeenCalledTimes(1);
    }
  });
});

describe('extractClinicalDocument', () => {
  const CLINICAL = { success: true, extracted_data: { patient: { first_name: 'Synthetic' } } };

  it('sends the bytes and never a locator on the owned path', async () => {
    const client = clientFor(CLINICAL);
    const answer = await extractClinicalDocument(client, file(), {
      independent: true, readAsBase64: async () => 'QkFTRTY0',
    });
    expect(answer).toEqual(CLINICAL);
    expect(client.uploaded).toHaveLength(0);
    expect(client.invoked[0].params).toEqual({ base64: 'QkFTRTY0', content_type: 'application/pdf' });
  });

  it('uploads first and passes the locator on the Base44 path', async () => {
    const client = clientFor(CLINICAL);
    await extractClinicalDocument(client, file());
    expect(client.uploaded).toHaveLength(1);
    expect(client.invoked[0].params).toEqual({
      file_url: 'https://qtrypzzcjebvfcihiynt.supabase.co/stored.pdf',
    });
  });

  it('refuses a document past the ceiling in ITS OWN envelope, not its sibling s', async () => {
    // The two capabilities do not share an answer shape, so a refusal shaped
    // like the other one would be read by this screen as an extraction that
    // simply found nothing.
    const client = clientFor(CLINICAL);
    const answer = await extractClinicalDocument(
      client, file({ size: OWNED_DOCUMENT_MAX_BYTES + 1 }),
      { independent: true, readAsBase64: async () => { throw new Error('read'); } },
    );
    expect(answer.success).toBe(false);
    expect(answer.error).toMatch(/too large/i);
    expect(answer).not.toHaveProperty('patient_data');
    expect(client.invoked).toHaveLength(0);
  });

  it('reports the stored locator on the Base44 path and null on the owned one', async () => {
    // The screen keeps it in state. There is no stored object on the owned
    // path, so it must be null rather than a stale or invented string.
    for (const [independent, expected] of [
      [false, 'https://qtrypzzcjebvfcihiynt.supabase.co/stored.pdf'], [true, null],
    ]) {
      const seen = [];
      await extractClinicalDocument(clientFor(CLINICAL), file(), {
        independent, onUploaded: (url) => seen.push(url), readAsBase64: async () => 'QkFTRTY0',
      });
      expect(seen).toEqual([expected]);
    }
  });
});

describe('fileToBase64', () => {
  const readerWith = (result, fail = false) => class {
    readAsDataURL() {
      queueMicrotask(() => (fail ? this.onerror() : (this.result = result, this.onload())));
    }
  };

  it('strips the data-URL prefix and answers the payload alone', async () => {
    const encoded = await fileToBase64({}, readerWith('data:application/pdf;base64,QkFTRTY0'));
    expect(encoded).toBe('QkFTRTY0');
  });

  it('refuses anything that is not a data URL rather than sending it', async () => {
    // A reader that answered text, or an empty result, would otherwise send
    // something the runtime would reject as invalid base64 — with the failure
    // arriving from the far end rather than here.
    for (const result of ['QkFTRTY0', '', 'data:application/pdf;base64']) {
      await expect(fileToBase64({}, readerWith(result))).rejects.toThrow('DOCUMENT_READ_FAILED');
    }
  });

  it('a read error is a rejection, not a silent empty document', async () => {
    await expect(fileToBase64({}, readerWith('', true))).rejects.toThrow('DOCUMENT_READ_FAILED');
  });
});
