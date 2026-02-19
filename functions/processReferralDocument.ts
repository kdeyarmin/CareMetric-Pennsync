import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai@4.28.0';

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { file_url } = await req.json();

    if (!file_url) {
      return Response.json({ 
        success: false, 
        error: 'File URL required' 
      }, { status: 400 });
    }

    // Fetch file content
    const fileResponse = await fetch(file_url);
    const fileBuffer = await fileResponse.arrayBuffer();
    const fileBase64 = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));

    // Use AI to extract data from referral document
    const prompt = `Extract patient referral information from this document.

Extract the following fields:
- patient_name
- date_of_birth (format: YYYY-MM-DD)
- phone_number
- address
- primary_diagnosis (with ICD-10 code if available)
- secondary_diagnoses (array)
- referring_physician
- referral_source (hospital name, facility, etc.)
- referral_date (YYYY-MM-DD)
- insurance_info (object with carrier, policy_number, group_number)
- clinical_notes
- medication_list (array)
- allergies (array)
- functional_status_notes

Provide JSON:
{
  "patient_name": "string",
  "date_of_birth": "YYYY-MM-DD",
  "phone_number": "string",
  "address": "string",
  "primary_diagnosis": "string",
  "secondary_diagnoses": ["string"],
  "referring_physician": "string",
  "referral_source": "string",
  "referral_date": "YYYY-MM-DD",
  "insurance_info": {
    "carrier": "string",
    "policy_number": "string",
    "group_number": "string"
  },
  "clinical_notes": "string",
  "medication_list": ["string"],
  "allergies": ["string"],
  "functional_status_notes": "string"
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a medical document processing AI that extracts structured data from referral documents."
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { 
              type: "image_url", 
              image_url: { 
                url: file_url.startsWith('http') ? file_url : `data:image/jpeg;base64,${fileBase64}`
              } 
            }
          ]
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const extractedData = JSON.parse(completion.choices[0].message.content);

    return Response.json({
      success: true,
      extracted_data: extractedData
    });

  } catch (error) {
    console.error('Process referral document error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});