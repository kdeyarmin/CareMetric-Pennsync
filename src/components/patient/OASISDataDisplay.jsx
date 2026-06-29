import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Activity, ChevronDown, ChevronUp } from "lucide-react";
import { formatEastern } from "../utils/timezone";

export default function OASISDataDisplay({ oasisData, compact = false }) {
  const [isExpanded, setIsExpanded] = React.useState(!compact);

  if (!oasisData || oasisData.length === 0) {
    return null;
  }

  const latestOasis = oasisData[0];
  const pdgmData = latestOasis.pdgm_data || {};
  const extractedData = latestOasis.extracted_data || {};

  // Extract key clinical data
  const admissionSource = pdgmData.admission_source || extractedData.admission_source || 'Unknown';
  const clinicalGroup = pdgmData.clinical_grouping || extractedData.clinical_group || 'Not specified';
  const functionalImpairment = pdgmData.functional_impairment_level || extractedData.functional_level || 'Not specified';
  const comorbidities = pdgmData.comorbidity_level || extractedData.comorbidities || [];
  const primaryDx = extractedData.primary_diagnosis || pdgmData.primary_diagnosis || 'Not specified';

  return (
    <Card className="border-navy-200 bg-gradient-to-r from-navy-50 to-gold-50">
      <CardHeader className="py-3 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-navy-600" />
            <span>OASIS Assessment Data</span>
            <Badge variant="outline" className="bg-navy-100 text-navy-800 border-navy-300">
              {formatEastern(latestOasis.created_date, 'MMM d, yyyy')}
            </Badge>
          </div>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </CardTitle>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-slate-500 font-medium mb-1">Admission Source</p>
              <Badge variant="outline" className="text-xs">
                {admissionSource === '1' || admissionSource.toLowerCase().includes('community') 
                  ? 'Community' 
                  : admissionSource === '2' || admissionSource.toLowerCase().includes('institutional')
                  ? 'Institutional (Hospital/SNF)'
                  : admissionSource}
              </Badge>
            </div>
            
            <div>
              <p className="text-slate-500 font-medium mb-1">Clinical Grouping</p>
              <Badge variant="outline" className="text-xs">{clinicalGroup}</Badge>
            </div>

            <div>
              <p className="text-slate-500 font-medium mb-1">Functional Impairment</p>
              <Badge variant="outline" className="text-xs">
                {functionalImpairment === 'low' ? 'Low' : 
                 functionalImpairment === 'medium' ? 'Medium' : 
                 functionalImpairment === 'high' ? 'High' : functionalImpairment}
              </Badge>
            </div>

            <div>
              <p className="text-slate-500 font-medium mb-1">Comorbidity Adjustment</p>
              <Badge variant="outline" className="text-xs">
                {Array.isArray(comorbidities) && comorbidities.length > 0 
                  ? `${comorbidities.length} comorbidities` 
                  : typeof comorbidities === 'string' 
                  ? comorbidities 
                  : 'None'}
              </Badge>
            </div>
          </div>

          {primaryDx && primaryDx !== 'Not specified' && (
            <div className="pt-2 border-t border-navy-200">
              <p className="text-slate-500 font-medium mb-1 text-xs">OASIS Primary Diagnosis</p>
              <p className="text-xs text-slate-700">{primaryDx}</p>
            </div>
          )}

          {Array.isArray(comorbidities) && comorbidities.length > 0 && (
            <div className="pt-2 border-t border-navy-200">
              <p className="text-slate-500 font-medium mb-1 text-xs">Documented Comorbidities</p>
              <div className="flex flex-wrap gap-1">
                {comorbidities.slice(0, 5).map((condition, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs bg-white">
                    {condition}
                  </Badge>
                ))}
                {comorbidities.length > 5 && (
                  <Badge variant="outline" className="text-xs bg-white">
                    +{comorbidities.length - 5} more
                  </Badge>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-navy-200 text-xs text-navy-700">
            <Activity className="w-3 h-3" />
            <span>This OASIS data is automatically synced to enhance documentation accuracy</span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}