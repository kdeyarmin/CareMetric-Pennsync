# Electronic signature consent text — 2026-10-09

The text every signer sees above the signature pad, in the `/signer` portal and
for in-person signing. It is stored as the Base44 secret
`SIGNATURE_AGREEMENT_TEXT`, with its SHA-256 as `SIGNATURE_AGREEMENT_SHA256`.
Secrets are write-only, so this page is the readable copy.

It replaces the one-paragraph statement set on 2026-10-09 at 01:55Z. That
statement covered intent and the paper option, but not the ESIGN Act's
consumer disclosures (15 U.S.C. § 7001(c)): how to withdraw consent and what
withdrawing does, how to get a copy, keeping contact details current, and the
hardware and software needed. No signature request, review grant or signature
existed when it was replaced, so no record refers to the old text.

## How it is checked

`validateSignerToken`, `manageSignatureRequests`, `submitSignerSignature` and
`submitDocumentSignatures` all refuse to sign unless:

- the text is 40–5,000 characters after trimming; and
- its UTF-8 SHA-256 equals `SIGNATURE_AGREEMENT_SHA256`.

To change it, set both secrets in one request. The pages render the text with
`whitespace-pre-line`, so blank lines become paragraphs.

## Verification on 2026-10-09

- **Public portal:** an anonymous `validateSignerToken` call with a random
  well-formed token answered 401 "Invalid or expired token". That check runs
  after the agreement check, so a hash mismatch would have answered 503.
- **Owner read-back:** `manageSignatureRequests` with action `agreement`, run
  as the owner, returned version `signature-consent-v1`, 1,962 characters,
  nine paragraphs, and an SHA-256 that matches the one below when recomputed
  from the returned text.

SHA-256: `dc9f9dda72c9e991dda2759eecef5e5874fd903e5cf78d32b3f386745113859d`

## The text

```text
Consent to use electronic records and signatures

Please read this before you sign. It explains your rights under the federal Electronic Signatures in Global and National Commerce Act (ESIGN) and the Uniform Electronic Transactions Act (UETA) as adopted in your state.

What you agree to. You agree to review and sign the document(s) in this signing request electronically, and to receive your copy electronically. The signature you draw and the full name you type are your electronic signature. It has the same legal effect as your handwritten signature, and by using it you intend to sign. This consent covers only the document(s) in this signing request.

You can sign on paper instead. You do not have to sign electronically. You may ask the agency requesting your signature for a paper copy to sign by hand, at no charge. Choosing paper does not affect any care or services that you, or the person you represent, receive.

Withdrawing consent. You may withdraw this consent at any time before you sign by not signing and telling the agency requesting your signature. The agency will then give you paper documents instead. Withdrawing does not change the legal effect of anything you already signed electronically.

Copies. You may ask the agency for a copy of a signed document, on paper or electronically, at any time and at no charge.

Keeping your contact details current. If your email address, mobile number or mailing address changes, tell the agency so it can continue to reach you.

What you need. To view and sign, you need a phone, tablet or computer with a current web browser (such as Safari, Chrome, Edge or Firefox) and an internet connection. To keep a copy, you need to be able to save or print a PDF, or you can ask the agency for one. By signing, you confirm that you could open and read this document on your device.

Signing for someone else. If you sign on behalf of another person, you confirm that you are legally authorized to do so.
```

Two commitments in it belong to the agency and are easy to change: paper and
copies "at no charge", and paper not affecting care or services.

**Confirmed by the owner on 2026-10-09** ("Confirmed - signature agreement"),
with both commitments as written.
