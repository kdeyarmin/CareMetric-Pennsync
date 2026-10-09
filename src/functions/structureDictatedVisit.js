import protectedAiRequest from '@/functions/protectedAiRequest';
export const structureDictatedVisit = payload => protectedAiRequest('structureDictatedVisit', payload, 45000).then(data => data.note);