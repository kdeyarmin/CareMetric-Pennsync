import { base44 } from '@/api/base44Client';
import protectedAiRequest from '@/lib/protectedAiRequest';

// The server reads the uploaded document and owns the prompt and schema.
export const extractFaxContact = payload =>
  protectedAiRequest(() => base44.functions.invoke('extractFaxContact', payload));
