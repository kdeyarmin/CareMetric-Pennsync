import { base44 } from "@/api/base44Client";

// Fetch every accessible ClinicalLibraryTemplate by paging through the list
// endpoint instead of relying on a single capped call. A flat `list(sort, 200)`
// silently truncated the library, analytics totals, and the phrase seeder's
// idempotency check once an agency accumulated more than 200 templates.
//
// Shared by ClinicalLibraryManager, ClinicalLibraryAnalytics and
// ClinicalPhraseSeeder, which all read the same ['clinical-templates'] query
// cache — keeping the queryFn identical avoids the top-N truncation regardless
// of which component populates the cache first.
const PAGE_SIZE = 200;
// Safety bound so a backend that ignored `skip` could never loop forever; far
// above any realistic agency template count.
const MAX_RECORDS = 10000;

export async function fetchAllClinicalTemplates() {
  const all = [];
  for (let skip = 0; skip < MAX_RECORDS; skip += PAGE_SIZE) {
    const page = await base44.entities.ClinicalLibraryTemplate.list('-usage_count', PAGE_SIZE, skip);
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}
