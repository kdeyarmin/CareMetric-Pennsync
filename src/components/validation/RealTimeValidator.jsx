import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import { 
  validateEmail, 
  validatePhone, 
  validateDate, 
  fuzzyMatch,
  SEVERITY 
} from "../utils/patientValidation";

export default function RealTimeValidator({ 
  type = 'text',
  label,
  value,
  onChange,
  onValidationChange,
  fieldName,
  required = false,
  fuzzyMatchAgainst = null,
  customValidator = null,
  placeholder,
  className = "",
  disabled = false
}) {
  const [errors, setErrors] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    // Only suppress validation until the field is touched. An empty value must
    // still fall through so the `required` check below can flag it — short-
    // circuiting on `!value` previously reported blank required fields as valid.
    if (!touched) {
      setErrors([]);
      setWarnings([]);
      if (onValidationChange) onValidationChange({ valid: true, errors: [], warnings: [] });
      return;
    }

    const newErrors = [];
    const newWarnings = [];

    // Required field validation
    if (required && !value?.trim()) {
      newErrors.push({
        severity: SEVERITY.ERROR,
        message: `${label} is required`
      });
    }

    // Type-specific validation
    if (value?.trim()) {
      switch (type) {
        case 'email':
          // validateEmail/Phone/Date return a bare message string (or null), not
          // an object — so `.severity` was always undefined and an invalid value
          // fell through to a warning (form reported valid:true) with a blank
          // message. Treat a returned message as an ERROR with a real message.
          const emailError = validateEmail(value);
          if (emailError) {
            newErrors.push({ severity: SEVERITY.ERROR, message: emailError });
          }
          break;

        case 'phone':
          const phoneError = validatePhone(value);
          if (phoneError) {
            newErrors.push({ severity: SEVERITY.ERROR, message: phoneError });
          }
          break;

        case 'date':
          const dateError = validateDate(value, fieldName);
          if (dateError) {
            newErrors.push({ severity: SEVERITY.ERROR, message: dateError });
          }
          break;
      }

      // Fuzzy matching validation
      if (fuzzyMatchAgainst) {
        const matchResult = fuzzyMatch(value, fuzzyMatchAgainst, 0.8);
        if (matchResult.match && matchResult.type === 'close') {
          newWarnings.push({
            severity: SEVERITY.WARNING,
            message: `Similar to existing value: "${fuzzyMatchAgainst}". Did you mean this?`,
            suggestion: `Consider using "${fuzzyMatchAgainst}" instead`
          });
        }
      }

      // Custom validation
      if (customValidator) {
        const customResult = customValidator(value);
        if (customResult) {
          if (customResult.severity === SEVERITY.ERROR) {
            newErrors.push(customResult);
          } else {
            newWarnings.push(customResult);
          }
        }
      }
    }

    setErrors(newErrors);
    setWarnings(newWarnings);
    
    if (onValidationChange) {
      onValidationChange({
        valid: newErrors.length === 0,
        errors: newErrors,
        warnings: newWarnings
      });
    }
  }, [value, touched, type, required, fuzzyMatchAgainst, customValidator, label, fieldName, onValidationChange]);

  const handleBlur = () => {
    setTouched(true);
  };

  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <Label htmlFor={fieldName}>
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </Label>
      )}
      
      <div className="relative">
        <Input
          id={fieldName}
          type={type === 'date' ? 'date' : 'text'}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          className={`${
            hasErrors ? 'border-red-500 focus:ring-red-500' :
            hasWarnings ? 'border-yellow-500 focus:ring-yellow-500' :
            touched && value ? 'border-green-500 focus:ring-green-500' : ''
          }`}
        />
        
        {touched && value && !hasErrors && !hasWarnings && (
          <CheckCircle2 className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-green-500" />
        )}
        {hasErrors && (
          <AlertCircle className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-red-500" />
        )}
        {!hasErrors && hasWarnings && (
          <AlertTriangle className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-yellow-500" />
        )}
      </div>

      {/* Error Messages */}
      {hasErrors && (
        <div className="space-y-1">
          {errors.map((error, idx) => (
            <Alert key={idx} variant="destructive" className="py-2">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription className="text-xs">
                {error.message}
                {error.suggestion && (
                  <span className="block mt-1 text-green-700">💡 {error.suggestion}</span>
                )}
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Warning Messages */}
      {!hasErrors && hasWarnings && (
        <div className="space-y-1">
          {warnings.map((warning, idx) => (
            <Alert key={idx} className="py-2 bg-yellow-50 border-yellow-300">
              <AlertTriangle className="w-4 h-4 text-yellow-600" />
              <AlertDescription className="text-xs text-yellow-900">
                {warning.message}
                {warning.suggestion && (
                  <span className="block mt-1">💡 {warning.suggestion}</span>
                )}
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}
    </div>
  );
}