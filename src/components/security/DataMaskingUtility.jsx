import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Data Masking Utilities for displaying sensitive information
 */

/**
 * Mask email address
 * @param {string} email - Email to mask
 * @returns {string} - Masked email
 */
export function maskEmail(email) {
  if (!email) return '';
  const [username, domain] = email.split('@');
  if (!domain) return email;
  
  const visibleChars = Math.min(3, Math.floor(username.length / 3));
  const masked = username.substring(0, visibleChars) + '***' + username.slice(-1);
  return `${masked}@${domain}`;
}

/**
 * Mask phone number
 * @param {string} phone - Phone number to mask
 * @returns {string} - Masked phone
 */
export function maskPhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return '***-***-****';
  return `***-***-${digits.slice(-4)}`;
}

/**
 * Mask SSN
 * @param {string} ssn - SSN to mask
 * @returns {string} - Masked SSN
 */
export function maskSSN(ssn) {
  if (!ssn) return '';
  const digits = ssn.replace(/\D/g, '');
  if (digits.length < 9) return '***-**-****';
  return `***-**-${digits.slice(-4)}`;
}

/**
 * Mask Medical Record Number
 * @param {string} mrn - MRN to mask
 * @returns {string} - Masked MRN
 */
export function maskMRN(mrn) {
  if (!mrn) return '';
  if (mrn.length <= 4) return '****';
  return '***' + mrn.slice(-4);
}

/**
 * Mask date of birth (show only year)
 * @param {string} dob - Date of birth
 * @returns {string} - Masked DOB
 */
export function maskDOB(dob) {
  if (!dob) return '';
  const year = new Date(dob).getFullYear();
  return `**/**//${year}`;
}

/**
 * Mask patient name
 * @param {string} firstName - First name
 * @param {string} lastName - Last name
 * @returns {string} - Masked name
 */
export function maskName(firstName, lastName) {
  const maskedFirst = firstName ? firstName[0] + '***' : '';
  const maskedLast = lastName ? lastName[0] + '***' : '';
  return `${maskedFirst} ${maskedLast}`.trim();
}

/**
 * React Component for togglable masked field
 */
export function MaskedField({ value, maskFn, label, className = "" }) {
  const [showValue, setShowValue] = useState(false);

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div className="flex-1">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="font-medium text-sm">
          {showValue ? value : maskFn(value)}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowValue(!showValue)}
        className="min-h-[44px] w-[44px]"
      >
        {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </Button>
    </div>
  );
}

/**
 * Mask entire object for logging (removes PHI)
 * @param {Object} obj - Object to mask
 * @returns {Object} - Masked object
 */
export function maskObjectForLogging(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  const masked = {};
  const phiFields = [
    'first_name', 'last_name', 'email', 'phone', 'address',
    'ssn', 'date_of_birth', 'medical_record_number',
    'emergency_contact_name', 'emergency_contact_phone',
    'physician_name', 'physician_phone', 'physician_email',
    'caregiver_name', 'caregiver_email', 'caregiver_phone'
  ];

  for (const [key, value] of Object.entries(obj)) {
    if (phiFields.includes(key.toLowerCase())) {
      masked[key] = '[REDACTED - PHI]';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskObjectForLogging(value);
    } else {
      masked[key] = value;
    }
  }

  return masked;
}