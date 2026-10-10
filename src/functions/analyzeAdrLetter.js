import { base44 } from '@/api/base44Client';
import protectedAiRequest from '@/lib/protectedAiRequest';

// The server reads the uploaded ADR letter and owns the prompt and schema.
export const analyzeAdrLetter = payload =>
  protectedAiRequest(() => base44.functions.invoke('analyzeAdrLetter', payload), 120000);
