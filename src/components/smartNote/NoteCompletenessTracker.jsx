import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, Circle, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function NoteCompletenessTracker({ 
  noteContent, 
  complianceResults, 
  visitType,
  providerType 
}) {
  const completeness = useMemo(() => {
    if (!noteContent) {
      return {
        percentage: 0,
        completed: [],
        missing: [],
        total: 0
      };
    }

    const noteLower = noteContent.toLowerCase();
    
    // Base required elements for all visit types
    const baseElements = [
      { label: 'Patient Assessment', keywords: ['assessment', 'subjective', 'patient reports', 'patient states'] },
      { label: 'Vital Signs', keywords: ['vital signs', 'bp', 'blood pressure', 'heart rate', 'temperature', 'o2', 'oxygen'] },
      { label: 'Interventions', keywords: ['intervention', 'treatment', 'provided', 'performed', 'administered'] },
      { label: 'Patient Response', keywords: ['response', 'tolerated', 'patient responded', 'outcome'] },
      { label: 'Plan', keywords: ['plan', 'next visit', 'continue', 'follow-up', 'will return'] }
    ];

    // Visit-type specific elements
    const visitSpecificElements = {
      admission: [
        { label: 'Admission Source', keywords: ['admitted from', 'admission source', 'transferred from'] },
        { label: 'Patient Goals', keywords: ['goals', 'patient goal', 'objectives'] },
        { label: 'Safety Assessment', keywords: ['safety', 'fall risk', 'home safety'] }
      ],
      routine: [
        { label: 'Progress Notes', keywords: ['progress', 'improvement', 'decline', 'stable'] }
      ],
      recertification: [
        { label: 'Progress Summary', keywords: ['progress', 'met goals', 'goal progress'] },
        { label: 'Homebound Status', keywords: ['homebound', 'confined to home', 'unable to leave'] }
      ],
      discharge: [
        { label: 'Discharge Summary', keywords: ['discharge', 'discharged', 'final visit'] },
        { label: 'Patient Education', keywords: ['education', 'taught', 'instructed', 'educated'] }
      ]
    };

    // Provider-specific elements
    const providerSpecificElements = {
      PT: [{ label: 'Range of Motion', keywords: ['rom', 'range of motion', 'flexibility'] }],
      OT: [{ label: 'ADL Assessment', keywords: ['adl', 'activities of daily living', 'functional'] }],
      ST: [{ label: 'Speech Assessment', keywords: ['speech', 'swallow', 'language', 'communication'] }],
      MSW: [{ label: 'Psychosocial Assessment', keywords: ['psychosocial', 'mental health', 'support system'] }]
    };

    let requiredElements = [...baseElements];
    
    if (visitType && visitSpecificElements[visitType]) {
      requiredElements = [...requiredElements, ...visitSpecificElements[visitType]];
    }
    
    if (providerType && providerSpecificElements[providerType]) {
      requiredElements = [...requiredElements, ...providerSpecificElements[providerType]];
    }

    // Check compliance results for missing elements
    const missingFromCompliance = complianceResults?.quality_analysis?.missing_elements || [];
    
    // Evaluate each element
    const completed = [];
    const missing = [];

    requiredElements.forEach(element => {
      const hasKeyword = element.keywords.some(kw => noteLower.includes(kw));
      if (hasKeyword) {
        completed.push(element.label);
      } else {
        missing.push(element.label);
      }
    });

    // Add compliance-detected missing elements
    missingFromCompliance.forEach(item => {
      if (!missing.includes(item) && !completed.includes(item)) {
        missing.push(item);
      }
    });

    const total = completed.length + missing.length;
    const percentage = total > 0 ? Math.round((completed.length / total) * 100) : 0;

    return {
      percentage,
      completed,
      missing,
      total
    };
  }, [noteContent, complianceResults, visitType, providerType]);

  const getStatusColor = () => {
    if (completeness.percentage >= 90) return 'text-green-600';
    if (completeness.percentage >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getProgressColor = () => {
    if (completeness.percentage >= 90) return 'bg-green-600';
    if (completeness.percentage >= 70) return 'bg-yellow-600';
    return 'bg-red-600';
  };

  return (
    <Card className="border-l-4" style={{ borderLeftColor: completeness.percentage >= 90 ? '#16a34a' : completeness.percentage >= 70 ? '#ca8a04' : '#dc2626' }}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Note Completeness
          </CardTitle>
          <Badge variant={completeness.percentage >= 90 ? 'default' : 'outline'} className={cn('font-bold', getStatusColor())}>
            {completeness.percentage}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress value={completeness.percentage} className="h-2" />
          <p className="text-xs text-muted-foreground">
            {completeness.completed.length} of {completeness.total} required elements documented
          </p>
        </div>

        {/* Checklist */}
        <div className="space-y-2">
          {/* Completed Items */}
          {completeness.completed.length > 0 && (
            <div className="space-y-1">
              {completeness.completed.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          )}

          {/* Missing Items */}
          {completeness.missing.length > 0 && (
            <div className="space-y-1 pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-2">Still Needed:</p>
              {completeness.missing.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          )}

          {/* Perfect Score */}
          {completeness.percentage === 100 && (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 p-3 rounded-lg mt-2">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">Note is complete and ready for submission!</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}