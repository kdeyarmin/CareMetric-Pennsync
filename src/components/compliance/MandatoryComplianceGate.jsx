import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Lock, CheckCircle, XCircle } from 'lucide-react';

export default function MandatoryComplianceGate({ 
  entityType, 
  entityData, 
  onValidationComplete 
}) {
  const [violations, setViolations] = useState([]);
  const [showDialog, setShowDialog] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  const { data: rules } = useQuery({
    queryKey: ['mandatory-rules', entityType],
    queryFn: async () => {
      const allRules = await base44.entities.CustomValidationRule.filter({
        target_entity: entityType,
        is_mandatory: true,
        is_active: true
      });
      return allRules;
    }
  });

  useEffect(() => {
    if (rules && entityData) {
      validateData();
    }
  }, [rules, entityData]);

  const validateData = () => {
    if (!rules || !entityData) return;

    setIsValidating(true);
    const newViolations = [];

    for (const rule of rules) {
      try {
        const fieldValue = entityData[rule.target_field];
        
        // Create a safe evaluation context
        const evalContext = {
          value: fieldValue,
          data: entityData
        };

        // Simple validation logic evaluation
        let isValid = false;
        
        if (rule.rule_type === 'field_required') {
          isValid = fieldValue !== null && fieldValue !== undefined && fieldValue !== '';
        } else if (rule.rule_type === 'field_format') {
          // Evaluate format validation
          try {
            const validationFn = new Function('value', 'data', `return ${rule.validation_logic}`);
            isValid = validationFn(fieldValue, entityData);
          } catch (e) {
            console.error('Validation error:', e);
            isValid = false;
          }
        } else if (rule.rule_type === 'conditional') {
          try {
            const validationFn = new Function('value', 'data', `return ${rule.validation_logic}`);
            isValid = validationFn(fieldValue, entityData);
          } catch (e) {
            console.error('Validation error:', e);
            isValid = false;
          }
        }

        if (!isValid) {
          newViolations.push({
            rule_name: rule.rule_name,
            field: rule.target_field,
            message: rule.error_message,
            severity: rule.severity
          });
        }
      } catch (error) {
        console.error('Rule validation error:', rule.rule_name, error);
      }
    }

    setViolations(newViolations);
    setIsValidating(false);

    if (newViolations.length > 0 && newViolations.some(v => v.severity === 'error')) {
      setShowDialog(true);
      onValidationComplete?.(false, newViolations);
    } else {
      onValidationComplete?.(true, newViolations);
    }
  };

  const errorViolations = violations.filter(v => v.severity === 'error');
  const warningViolations = violations.filter(v => v.severity === 'warning');

  if (violations.length === 0) {
    return null;
  }

  return (
    <Dialog open={showDialog} onOpenChange={setShowDialog}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-red-600" />
            Mandatory Compliance Check
          </DialogTitle>
          <DialogDescription>
            {errorViolations.length > 0 
              ? 'The following compliance requirements must be met before saving'
              : 'Please review the following warnings'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {errorViolations.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <XCircle className="h-5 w-5 text-red-600" />
                <h3 className="font-semibold text-red-900">
                  Errors ({errorViolations.length})
                </h3>
              </div>
              <div className="space-y-2">
                {errorViolations.map((violation, idx) => (
                  <div key={idx} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="font-medium text-sm text-red-900 mb-1">
                      {violation.rule_name}
                    </p>
                    <p className="text-sm text-red-800">{violation.message}</p>
                    <p className="text-xs text-red-600 mt-1">Field: {violation.field}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {warningViolations.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                <h3 className="font-semibold text-yellow-900">
                  Warnings ({warningViolations.length})
                </h3>
              </div>
              <div className="space-y-2">
                {warningViolations.map((violation, idx) => (
                  <div key={idx} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="font-medium text-sm text-yellow-900 mb-1">
                      {violation.rule_name}
                    </p>
                    <p className="text-sm text-yellow-800">{violation.message}</p>
                    <p className="text-xs text-yellow-600 mt-1">Field: {violation.field}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {errorViolations.length > 0 ? (
            <Button onClick={() => setShowDialog(false)} className="w-full">
              Fix Issues
            </Button>
          ) : (
            <div className="flex gap-2 w-full">
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowDialog(false);
                  onValidationComplete?.(false, violations);
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button 
                onClick={() => {
                  setShowDialog(false);
                  onValidationComplete?.(true, violations);
                }}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                Continue Anyway
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}