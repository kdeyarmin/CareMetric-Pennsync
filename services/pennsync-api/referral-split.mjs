// The referral split's prompt and response schema.
//
// Both are the original's, copied out of
// `base44/functions/splitReferralPDF/entry.ts` rather than reworded: the
// prompt tells a model what counts as a document boundary in a referral
// packet, and every `description` in the schema is a sentence it reads.
// `pennsyncApiOriginalParity.test.js` lifts the original's own `InvokeLLM`
// argument and compares, so a rewording fails the build.
//
// The model is `automatic`, as the original names it, which is what the owned
// runtime admits.
export const REFERRAL_SPLIT_MODEL = 'automatic';

export const REFERRAL_SPLIT_PROMPT = `Analyze this PDF document to determine if it contains multiple separate referral documents/packets.

Please analyze and respond with:
1. Is this a single referral or multiple referrals? 
2. How many distinct referral documents/packets are in this PDF?
3. Estimated page ranges for each referral (if multiple)
4. Key identifiers for each referral (patient names, dates, etc.)

Be thorough - look for:
- Page breaks between documents
- Different letterheads or sources
- Different patient names
- Different referral dates
- Document headers or titles indicating new referrals
- Section breaks or dividers

Return structured data so we can split and process each referral separately.`;

// Frozen because the handler hands a CLONE of it to the runtime on every call;
// a shared schema a caller could mutate would change what the next caller's
// packet is read for.
export const REFERRAL_SPLIT_SCHEMA = Object.freeze({
        type: "object",
        properties: {
          is_multiple_referrals: {
            type: "boolean",
            description: "Whether this contains multiple referrals"
          },
          referral_count: {
            type: "number",
            description: "Number of referrals detected"
          },
          referrals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "number", description: "Referral number (1-based)" },
                patient_name: { type: "string", description: "Patient name if available" },
                referral_source: { type: "string", description: "Source/facility" },
                referral_date: { type: "string", description: "Date if available" },
                estimated_start_page: { type: "number", description: "Estimated starting page" },
                estimated_end_page: { type: "number", description: "Estimated ending page" },
                confidence: { type: "number", description: "Confidence score 0-100" },
                key_identifiers: {
                  type: "array",
                  items: { type: "string" },
                  description: "Unique identifiers for this referral"
                }
              }
            },
            description: "List of detected referrals with page info"
          },
          notes: {
            type: "string",
            description: "Any additional notes about document structure"
          }
        }
      });
