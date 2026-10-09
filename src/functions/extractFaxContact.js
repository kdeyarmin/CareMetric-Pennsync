import protectedAiRequest from '@/functions/protectedAiRequest';
export const extractFaxContact = payload => protectedAiRequest('extractFaxContact', payload);