import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DollarSign, TrendingUp } from "lucide-react";

/**
 * PdgmAnalysisSummary — the read-only top of the OASIS Results-tab PDGM card:
 * the case-mix score grid (clinical group, functional level, comorbidity
 * adjustment, case-mix weight, optimization potential), the qualifying
 * comorbidities, the case-mix weight breakdown, and the optimization strategies.
 *
 * Extracted verbatim from OASISScrubber; purely presentational — reads only
 * `pdgmAnalysis` (= `oasisResults.pdgm_analysis`), no handlers. The interactive
 * "Automated Optimization Suggestions" panel stays in the parent.
 *
 * @param {{ pdgmAnalysis: Record<string, any> }} props
 */
export default function PdgmAnalysisSummary({ pdgmAnalysis }) {
  if (!pdgmAnalysis) return null;

  return (
    <>
      <h4 className="font-bold text-green-900 mb-3 flex items-center gap-2">
        <DollarSign className="w-5 h-5" />
        PDGM Case-Mix Analysis
      </h4>

      {/* Clinical Group with Confidence */}
      <div className="bg-white p-3 rounded border mb-3">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div>
            <p className="text-xs text-slate-500">Clinical Group (MMTA)</p>
            <p className="font-bold text-slate-900">{pdgmAnalysis.clinical_group}</p>
          </div>
          <Badge className={`${
            pdgmAnalysis.clinical_group_confidence === 'high' ? 'bg-green-600' :
            pdgmAnalysis.clinical_group_confidence === 'medium' ? 'bg-yellow-600' : 'bg-red-600'
          }`}>
            {pdgmAnalysis.clinical_group_confidence?.toUpperCase()} Confidence
          </Badge>
        </div>
        {pdgmAnalysis.clinical_group_rationale && (
          <p className="text-xs text-slate-600 mt-1">{pdgmAnalysis.clinical_group_rationale}</p>
        )}
        {pdgmAnalysis.primary_dx_icd10_suggested && (
          <p className="text-xs text-blue-700 mt-1">
            <strong>Suggested ICD-10:</strong> {pdgmAnalysis.primary_dx_icd10_suggested}
          </p>
        )}
        {pdgmAnalysis.alternative_clinical_groups?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="text-xs text-slate-500">Alternatives:</span>
            {pdgmAnalysis.alternative_clinical_groups.map((alt, idx) => (
              <Badge key={idx} variant="outline" className="text-xs">{alt}</Badge>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
        <div className="bg-white p-2 rounded border">
          <p className="text-xs text-slate-500">Functional Level</p>
          <p className={`font-semibold ${
            pdgmAnalysis.functional_level === 'high' ? 'text-green-700' :
            pdgmAnalysis.functional_level === 'medium' ? 'text-yellow-700' : 'text-red-700'
          }`}>{pdgmAnalysis.functional_level?.toUpperCase()}</p>
          {pdgmAnalysis.functional_points_calculated && (
            <p className="text-xs text-slate-500 mt-1">{pdgmAnalysis.functional_points_calculated} points</p>
          )}
        </div>
        <div className="bg-white p-2 rounded border">
          <p className="text-xs text-slate-500">Comorbidity Adj.</p>
          <p className={`font-semibold ${
            pdgmAnalysis.comorbidity_adjustment === 'high' ? 'text-green-700' :
            pdgmAnalysis.comorbidity_adjustment === 'low' ? 'text-yellow-700' : 'text-slate-700'
          }`}>{pdgmAnalysis.comorbidity_adjustment?.toUpperCase()}</p>
          {pdgmAnalysis.comorbidity_count > 0 && (
            <p className="text-xs text-slate-500 mt-1">{pdgmAnalysis.comorbidity_count} qualifying</p>
          )}
        </div>
        <div className="bg-white p-2 rounded border">
          <p className="text-xs text-slate-500">Case-Mix Weight</p>
          <p className="font-bold text-green-700 text-lg">{pdgmAnalysis.estimated_case_mix_weight}</p>
        </div>
        <div className="bg-green-100 p-2 rounded border border-green-300">
          <p className="text-xs text-green-700">Optimization</p>
          <p className="font-semibold text-green-800">{pdgmAnalysis.optimization_potential}</p>
        </div>
      </div>

      {/* Qualifying Comorbidities Detail */}
      {pdgmAnalysis.qualifying_comorbidities && (
        <div className="bg-blue-50 p-3 rounded border border-blue-200 mb-3">
          <p className="text-xs font-semibold text-blue-900 mb-2">Qualifying Comorbidities:</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {pdgmAnalysis.qualifying_comorbidities.high_impact?.length > 0 && (
              <div>
                <p className="text-xs text-green-700 font-medium">✓ High-Impact (1 = HIGH adj):</p>
                <ul className="text-xs text-green-900">
                  {pdgmAnalysis.qualifying_comorbidities.high_impact.map((c, i) => (
                    <li key={i}>• {c}</li>
                  ))}
                </ul>
              </div>
            )}
            {pdgmAnalysis.qualifying_comorbidities.low_impact?.length > 0 && (
              <div>
                <p className="text-xs text-yellow-700 font-medium">○ Low-Impact (2+ = LOW adj):</p>
                <ul className="text-xs text-yellow-900">
                  {pdgmAnalysis.qualifying_comorbidities.low_impact.map((c, i) => (
                    <li key={i}>• {c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {pdgmAnalysis.qualifying_comorbidities.potential_additions?.length > 0 && (
            <div className="mt-2 bg-yellow-100 p-2 rounded">
              <p className="text-xs text-yellow-800 font-medium">💡 Potential Additional Comorbidities (needs documentation):</p>
              <ul className="text-xs text-yellow-900">
                {pdgmAnalysis.qualifying_comorbidities.potential_additions.map((c, i) => (
                  <li key={i}>• {c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Case-Mix Weight Breakdown */}
      {pdgmAnalysis.case_mix_weight_breakdown && (
        <div className="bg-white p-2 rounded border mb-3">
          <p className="text-xs font-semibold text-slate-700 mb-1">Case-Mix Weight Breakdown:</p>
          <div className="flex gap-4 text-xs">
            <span>Clinical: <strong>{pdgmAnalysis.case_mix_weight_breakdown.clinical_component}</strong></span>
            <span>Functional: <strong>{pdgmAnalysis.case_mix_weight_breakdown.functional_component}</strong></span>
            <span>Comorbidity: <strong>{pdgmAnalysis.case_mix_weight_breakdown.comorbidity_component}</strong></span>
          </div>
        </div>
      )}

      {/* Optimization Strategies */}
      {pdgmAnalysis.optimization_strategies?.length > 0 && (
        <Alert className="bg-green-100 border-green-300">
          <TrendingUp className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-green-900 text-sm">
            <strong>Optimization Strategies:</strong>
            <ul className="mt-1 text-xs">
              {pdgmAnalysis.optimization_strategies.map((strategy, idx) => (
                <li key={idx}>• {strategy}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
