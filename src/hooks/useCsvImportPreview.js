import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const CSV_TYPES = new Set(['text/csv', 'application/vnd.ms-excel', 'text/plain', '']);

/** Keep the filename and parsed data atomic; only the latest selection wins. */
export function useCsvImportPreview() {
  const generation = useRef(0);
  const [preview, setPreview] = useState(null);
  const [isReading, setIsReading] = useState(false);

  useEffect(() => () => { generation.current += 1; }, []);

  const replacePreview = useCallback((next) => {
    generation.current += 1;
    setPreview(next);
    setIsReading(false);
  }, []);

  const readFile = useCallback(async (file, parse) => {
    if (!file) return { status: 'cancelled' };
    const request = ++generation.current;
    // An old, valid table must not remain savable while a new file is loading
    // or after validation/read failure. Filename and content commit together.
    setPreview(null);
    setIsReading(true);
    try {
      if (typeof file.name !== 'string' || !/\.csv$/i.test(file.name)
        || !CSV_TYPES.has(file.type || '') || !Number.isFinite(file.size)
        || file.size < 0 || file.size > MAX_CSV_BYTES || typeof file.text !== 'function') {
        return { status: 'error', message: 'Choose a CSV file no larger than 10 MB.' };
      }
      const text = await file.text();
      if (request !== generation.current) return { status: 'superseded' };
      const result = parse(text);
      if (request !== generation.current) return { status: 'superseded' };
      setPreview({ fileName: file.name, result });
      return { status: 'ready', result };
    } catch {
      if (request !== generation.current) return { status: 'superseded' };
      return { status: 'error', message: "Couldn't read that CSV. Please export it again and retry." };
    } finally {
      if (request === generation.current) setIsReading(false);
    }
  }, []);

  return { preview, isReading, readFile, replacePreview };
}
