import { useState, useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, XCircle, Lightbulb } from 'lucide-react';

// CMS Validation Rules
const CMS_VALIDATION_RULES = {
  M0069: {
    // Prognosis
    validate: (value, allAnswers) => {
      const errors = [];
      const warnings = [];
      const suggestions = [];

      if (value === null || value === undefined || value === '') {
        errors.push('Prognosis is required for all patients');
      }

      // If patient has terminal diagnosis but prognosis is not terminal
      if (allAnswers.primary_diagnosis?.includes('terminal') && value !== '1') {
        warnings.push('Patient has terminal diagnosis but prognosis is not marked as terminal');
        suggestions.push('Review physician documentation for terminal prognosis (6-month or less)');
      }

      // If prognosis is terminal, require supporting documentation
      if (value === '1') {
        suggestions.push('Ensure physician documentation of 6-month or less prognosis is in chart');
      }

      return { errors, warnings, suggestions, isValid: errors.length === 0 };
    }
  },

  M1021: {
    // Primary Diagnosis
    validate: (value, _allAnswers) => {
      const errors = [];
      const warnings = [];
      const suggestions = [];

      if (!value || value.trim() === '') {
        errors.push('Primary diagnosis is required');
      }

      if (value && value.length < 3) {
        errors.push('Primary diagnosis must be a valid ICD-10 code (minimum 3 characters)');
      }

      // Check for placeholder codes
      if (value && (value.startsWith('999') || value === 'TBD' || value === 'NA')) {
        errors.push('Invalid diagnosis code - cannot use placeholder codes');
      }

      return { errors, warnings, suggestions, isValid: errors.length === 0 };
    }
  },

  M1800: {
    // Grooming
    validate: (value, allAnswers) => {
      const errors = [];
      const warnings = [];
      const suggestions = [];

      if (value === null || value === undefined || value === '') {
        errors.push('Grooming ability must be assessed');
      }

      // Cross-validation with other ADLs
      if (allAnswers.M1810 && parseInt(value) > parseInt(allAnswers.M1810)) {
        warnings.push('Grooming ability is worse than dressing - verify assessment');
      }

      if (value === '3' || value === '4') {
        suggestions.push('Total dependence in grooming - ensure care plan addresses ADL support');
      }

      return { errors, warnings, suggestions, isValid: errors.length === 0 };
    }
  },

  M1810: {
    // Dressing Upper Body
    validate: (value, _allAnswers) => {
      const errors = [];
      const warnings = [];
      const suggestions = [];

      if (value === null || value === undefined || value === '') {
        errors.push('Upper body dressing must be assessed');
      }

      if (value === '3' || value === '4') {
        suggestions.push('Patient requires assistance with upper body dressing - include in care plan');
      }

      return { errors, warnings, suggestions, isValid: errors.length === 0 };
    }
  },

  M1820: {
    // Dressing Lower Body
    validate: (value, allAnswers) => {
      const errors = [];
      const warnings = [];
      const suggestions = [];

      if (value === null || value === undefined || value === '') {
        errors.push('Lower body dressing must be assessed');
      }

      // Lower body typically harder than upper
      if (allAnswers.M1810 && parseInt(value) < parseInt(allAnswers.M1810)) {
        warnings.push('Lower body dressing scored better than upper body - this is uncommon, verify');
      }

      return { errors, warnings, suggestions, isValid: errors.length === 0 };
    }
  },

  M1830: {
    // Bathing
    validate: (value, _allAnswers) => {
      const errors = [];
      const warnings = [];
      const suggestions = [];

      if (value === null || value === undefined || value === '') {
        errors.push('Bathing ability must be assessed');
      }

      if (value === '5' || value === '6') {
        suggestions.push('Patient unable to bathe self - ensure HHA services are ordered if needed');
      }

      return { errors, warnings, suggestions, isValid: errors.length === 0 };
    }
  },

  M1840: {
    // Toileting
    validate: (value, _allAnswers) => {
      const errors = [];
      const warnings = [];
      const suggestions = [];

      if (value === null || value === undefined || value === '') {
        errors.push('Toileting ability must be assessed');
      }

      if (value === '4') {
        suggestions.push('Total dependence for toileting - document catheter/ostomy management if applicable');
      }

      return { errors, warnings, suggestions, isValid: errors.length === 0 };
    }
  },

  M1845: {
    // Toilet Transferring
    validate: (value, allAnswers) => {
      const errors = [];
      const warnings = [];
      const suggestions = [];

      if (value === null || value === undefined || value === '') {
        errors.push('Toilet transferring must be assessed');
      }

      // Should correlate with bed transferring
      if (allAnswers.M1850 && Math.abs(parseInt(value) - parseInt(allAnswers.M1850)) > 2) {
        warnings.push('Toilet and bed transfer scores differ significantly - verify accuracy');
      }

      return { errors, warnings, suggestions, isValid: errors.length === 0 };
    }
  },

  M1850: {
    // Transferring
    validate: (value, _allAnswers) => {
      const errors = [];
      const warnings = [];
      const suggestions = [];

      if (value === null || value === undefined || value === '') {
        errors.push('Bed transferring must be assessed');
      }

      if (value === '5') {
        suggestions.push('Patient is bedfast - ensure pressure ulcer prevention in care plan');
      }

      return { errors, warnings, suggestions, isValid: errors.length === 0 };
    }
  },

  M1860: {
    // Ambulation
    validate: (value, allAnswers) => {
      const errors = [];
      const warnings = [];
      const suggestions = [];

      if (value === null || value === undefined || value === '') {
        errors.push('Ambulation must be assessed');
      }

      if (value === '6') {
        suggestions.push('Patient is bedfast - coordinate with PT if rehabilitation potential exists');
      }

      // If bedfast in ambulation, should be consistent with transferring
      if (value === '6' && allAnswers.M1850 !== '5') {
        warnings.push('Patient marked bedfast for ambulation but can transfer - verify consistency');
      }

      return { errors, warnings, suggestions, isValid: errors.length === 0 };
    }
  }
};

export default function OASISValidationEngine({ questionId, value, allAnswers, _onChange }) {
  const [validation, setValidation] = useState({ errors: [], warnings: [], suggestions: [], isValid: true });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (CMS_VALIDATION_RULES[questionId]) {
      const result = CMS_VALIDATION_RULES[questionId].validate(value, allAnswers || {});
      setValidation(result);
      
      // Auto-show details if there are errors or warnings
      if (result.errors.length > 0 || result.warnings.length > 0) {
        setShowDetails(true);
      }
    } else {
      setValidation({ errors: [], warnings: [], suggestions: [], isValid: true });
    }
  }, [questionId, value, allAnswers]);

  const hasIssues = validation.errors.length > 0 || validation.warnings.length > 0 || validation.suggestions.length > 0;

  if (!hasIssues) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 mt-1">
        <CheckCircle2 className="w-4 h-4" />
        <span className="font-medium">Valid</span>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {/* Summary Badge */}
      <div className="flex items-center gap-2">
        {validation.errors.length > 0 && (
          <Badge className="bg-red-500 flex items-center gap-1">
            <XCircle className="w-3 h-3" />
            {validation.errors.length} Error{validation.errors.length > 1 ? 's' : ''}
          </Badge>
        )}
        {validation.warnings.length > 0 && (
          <Badge className="bg-orange-500 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {validation.warnings.length} Warning{validation.warnings.length > 1 ? 's' : ''}
          </Badge>
        )}
        {validation.suggestions.length > 0 && (
          <Badge className="bg-blue-500 flex items-center gap-1">
            <Lightbulb className="w-3 h-3" />
            {validation.suggestions.length} Suggestion{validation.suggestions.length > 1 ? 's' : ''}
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs h-6"
        >
          {showDetails ? 'Hide' : 'Show'} Details
        </Button>
      </div>

      {/* Detailed Messages */}
      {showDetails && (
        <div className="space-y-2">
          {validation.errors.map((error, idx) => (
            <Alert key={`error-${idx}`} className="bg-red-50 border-red-300">
              <XCircle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-sm text-red-900 ml-2">
                <strong>Error:</strong> {error}
              </AlertDescription>
            </Alert>
          ))}

          {validation.warnings.map((warning, idx) => (
            <Alert key={`warning-${idx}`} className="bg-orange-50 border-orange-300">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <AlertDescription className="text-sm text-orange-900 ml-2">
                <strong>Warning:</strong> {warning}
              </AlertDescription>
            </Alert>
          ))}

          {validation.suggestions.map((suggestion, idx) => (
            <Alert key={`suggestion-${idx}`} className="bg-blue-50 border-blue-300">
              <Lightbulb className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-sm text-blue-900 ml-2">
                <strong>Suggestion:</strong> {suggestion}
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}
    </div>
  );
}

// Export validation function for external use
export const validateOASISQuestion = (questionId, value, allAnswers) => {
  if (CMS_VALIDATION_RULES[questionId]) {
    return CMS_VALIDATION_RULES[questionId].validate(value, allAnswers || {});
  }
  return { errors: [], warnings: [], suggestions: [], isValid: true };
};

// Export function to validate entire assessment
export const validateEntireAssessment = (allAnswers) => {
  const results = {};
  let totalErrors = 0;
  let totalWarnings = 0;
  
  Object.keys(CMS_VALIDATION_RULES).forEach(questionId => {
    const value = allAnswers[questionId];
    const validation = CMS_VALIDATION_RULES[questionId].validate(value, allAnswers);
    results[questionId] = validation;
    totalErrors += validation.errors.length;
    totalWarnings += validation.warnings.length;
  });

  return {
    results,
    totalErrors,
    totalWarnings,
    isValid: totalErrors === 0
  };
};