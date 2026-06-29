import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Eye, EyeOff, Copy, CheckCircle2 } from "lucide-react";

/**
 * OptimizationSuggestionsPanel — the OASIS Results-tab "Automated Optimization
 * Suggestions" panel: a toggleable amber card that surfaces PDGM optimization
 * opportunities (clinical group, functional level, comorbidity adjustment),
 * documentation gaps, care-plan suggestions, the total-impact summary, and an
 * "Apply Top Suggestion" action — or, when collapsed, a count badge.
 *
 * Extracted verbatim from OASISScrubber; every external reference is passed as
 * an identically-named prop so the body is byte-identical to the original.
 *
 * @param {{
 *   oasisResults: Record<string, any>,
 *   extractedIndicators: Record<string, any>,
 *   patient: Record<string, any>,
 *   showOptimizationPanel: boolean,
 *   setShowOptimizationPanel: (v: boolean) => void,
 *   copiedText: string|null,
 *   copyToClipboard: (text: string, id: string) => void,
 *   handleSuggestionAccept: (suggestion: any, type: string) => void,
 * }} props
 */
export default function OptimizationSuggestionsPanel({
  oasisResults,
  extractedIndicators,
  patient,
  showOptimizationPanel,
  setShowOptimizationPanel,
  copiedText,
  copyToClipboard,
  handleSuggestionAccept,
}) {
  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 p-4 rounded-lg border border-amber-200 mt-3">
      <div className="flex items-center justify-between mb-3">
        <h5 className="font-bold text-amber-900 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-600" />
          Automated Optimization Suggestions
        </h5>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowOptimizationPanel(!showOptimizationPanel)}
          className="h-6 text-xs"
        >
          {showOptimizationPanel ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
          {showOptimizationPanel ? 'Hide' : 'Show'}
        </Button>
      </div>

      {showOptimizationPanel && (
        <div className="space-y-3">
        {oasisResults.pdgm_analysis.clinical_group_confidence !== 'high' && (
          <div className="bg-white p-3 rounded border border-amber-200">
            <div className="flex items-start gap-2">
              <Badge className="bg-amber-500 text-white text-xs flex-shrink-0">Clinical Group</Badge>
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-900">Strengthen Clinical Group Assignment</p>
                <p className="text-xs text-amber-800 mt-1">
                  Current confidence is <strong>{oasisResults.pdgm_analysis.clinical_group_confidence}</strong>.
                  Document specific ICD-10 codes and clinical conditions that align with {oasisResults.pdgm_analysis.clinical_group?.split(' - ')[0]}.
                </p>
                <div className="mt-2 bg-amber-50 p-2 rounded text-xs">
                  <p className="font-medium text-amber-800">💡 Suggestion:</p>
                  <p className="text-amber-700">
                    {oasisResults.pdgm_analysis.clinical_group?.includes('Musculoskeletal') &&
                      'Document specific orthopedic procedure codes, weight-bearing status, and surgical details to strengthen MMTA-01 assignment.'}
                    {oasisResults.pdgm_analysis.clinical_group?.includes('Neuro') &&
                      'Document specific CVA laterality, affected extremities, and cognitive/motor deficits to strengthen MMTA-02 assignment.'}
                    {oasisResults.pdgm_analysis.clinical_group?.includes('Wounds') &&
                      'Document wound etiology, staging, measurements, and treatment plan to strengthen MMTA-03 assignment.'}
                    {oasisResults.pdgm_analysis.clinical_group?.includes('Complex') &&
                      'Document specific complex care interventions, equipment, and skilled nursing requirements.'}
                    {oasisResults.pdgm_analysis.clinical_group?.includes('MMTA') &&
                      'Document medication complexity, teaching needs, and disease management requirements.'}
                    {oasisResults.pdgm_analysis.clinical_group?.includes('Behavioral') &&
                      'Document psychiatric diagnoses, behavioral interventions, and safety concerns.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Functional Score Optimization */}
        {oasisResults.pdgm_analysis.functional_level !== 'high' && (
          <div className="bg-white p-3 rounded border border-blue-200">
            <div className="flex items-start gap-2">
              <Badge className="bg-blue-500 text-white text-xs flex-shrink-0">Functional Level</Badge>
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-900">Maximize Functional Score Documentation</p>
                <p className="text-xs text-blue-800 mt-1">
                  Current level: <strong>{oasisResults.pdgm_analysis.functional_level?.toUpperCase()}</strong>
                  ({oasisResults.pdgm_analysis.functional_points_calculated || '?'} points).
                  {oasisResults.pdgm_analysis.functional_level === 'low' ? ' Need 6+ points for MEDIUM, 12+ for HIGH.' : ' Need 12+ points for HIGH.'}
                </p>
                <div className="mt-2 space-y-2">
                  {/* Specific M-item suggestions based on current scores */}
                  {oasisResults.functional_score_analysis && (
                    <>
                      {(oasisResults.functional_score_analysis.m1830_bathing?.documented_value < 3 || !oasisResults.functional_score_analysis.m1830_bathing?.documented_value) && (
                        <div className="bg-blue-50 p-2 rounded text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <p className="font-medium text-blue-800">🚿 M1830 Bathing (0-6 scale):</p>
                              <p className="text-blue-700">Document need for assistance throughout bathing, transfer assistance, or inability to bathe. Include safety concerns, equipment needs, and caregiver involvement.</p>
                            </div>
                            {extractedIndicators?.functional?.bathing?.allPhrases?.length > 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => copyToClipboard(extractedIndicators.functional.bathing.allPhrases[0], 'bathing-suggestion')}
                                className="h-6 px-2 flex-shrink-0"
                              >
                                {copiedText === 'bathing-suggestion' ? (
                                  <CheckCircle2 className="w-3 h-3 text-green-600" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                      {(oasisResults.functional_score_analysis.m1860_ambulation?.documented_value < 3 || !oasisResults.functional_score_analysis.m1860_ambulation?.documented_value) && (
                        <div className="bg-blue-50 p-2 rounded text-xs">
                          <p className="font-medium text-blue-800">🚶 M1860 Ambulation (0-6 scale):</p>
                          <p className="text-blue-700">Document assistive device dependence, distance limitations, surface restrictions, and assistance requirements. Include gait abnormalities and fall risk factors.</p>
                        </div>
                      )}
                      {(oasisResults.functional_score_analysis.m1850_transferring?.documented_value < 2 || !oasisResults.functional_score_analysis.m1850_transferring?.documented_value) && (
                        <div className="bg-blue-50 p-2 rounded text-xs">
                          <p className="font-medium text-blue-800">🔄 M1850 Transferring (0-5 scale):</p>
                          <p className="text-blue-700">Document supervision or physical assistance needed, weight-bearing restrictions, and equipment use (grab bars, transfer boards, mechanical lifts).</p>
                        </div>
                      )}
                    </>
                  )}
                  <div className="bg-green-50 p-2 rounded text-xs border border-green-200">
                    <p className="font-medium text-green-800">📈 Revenue Impact:</p>
                    <p className="text-green-700">
                      Each functional level increase (Low→Medium→High) can add $200-$500 per 30-day episode.
                      {oasisResults.pdgm_analysis.functional_level === 'low' && ' Moving from LOW to MEDIUM = +$200-300/episode.'}
                      {oasisResults.pdgm_analysis.functional_level === 'medium' && ' Moving from MEDIUM to HIGH = +$300-500/episode.'}
                    </p>
                  </div>
                  <div className="bg-blue-50 p-2 rounded text-xs border border-blue-200 mt-2">
                    <p className="font-medium text-blue-800">🎯 Next Steps to Increase Score:</p>
                    <ol className="text-blue-700 list-decimal list-inside mt-1 space-y-1">
                      <li>Review narrative for ANY mention of assistance needs not captured in M-items</li>
                      <li>Document specific level of assist (min/mod/max) with observable details</li>
                      <li>Cross-check GG scores align with M1800-1860 functional documentation</li>
                      <li>Consider PT/OT referral for objective functional assessment</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Comorbidity Optimization */}
        {oasisResults.pdgm_analysis.comorbidity_adjustment !== 'high' && (
          <div className="bg-white p-3 rounded border border-navy-200">
            <div className="flex items-start gap-2">
              <Badge className="bg-navy-500 text-white text-xs flex-shrink-0">Comorbidity Adj.</Badge>
              <div className="flex-1">
                <p className="text-sm font-medium text-navy-900">Improve Comorbidity Adjustment</p>
                <p className="text-xs text-navy-800 mt-1">
                  Current adjustment: <strong>{oasisResults.pdgm_analysis.comorbidity_adjustment?.toUpperCase() || 'NONE'}</strong>.
                  {oasisResults.pdgm_analysis.comorbidity_adjustment === 'none' && ' Document qualifying comorbidities to increase reimbursement.'}
                  {oasisResults.pdgm_analysis.comorbidity_adjustment === 'low' && ' Document ONE high-impact comorbidity for HIGH adjustment.'}
                </p>
                <div className="mt-2 space-y-2">
                  {/* High-impact comorbidity suggestions */}
                  <div className="bg-navy-50 p-2 rounded text-xs">
                    <p className="font-medium text-navy-800 mb-1">🎯 High-Impact Comorbidities (1 = HIGH adjustment):</p>
                    <ul className="text-navy-700 space-y-1">
                      <li>• <strong>Diabetes with complications</strong> - neuropathy, nephropathy, retinopathy (E11.2x, E11.4x, E11.5x, E11.6x)</li>
                      <li>• <strong>Heart Failure</strong> - CHF, HFrEF, HFpEF (I50.x)</li>
                      <li>• <strong>COPD</strong> - chronic bronchitis, emphysema (J44.x, J43.x)</li>
                      <li>• <strong>Chronic Kidney Disease</strong> - Stage 3-5 (N18.3-N18.5)</li>
                      <li>• <strong>Malignancy</strong> - active cancer with treatment (C00-C96)</li>
                    </ul>
                  </div>
                  {oasisResults.pdgm_analysis.comorbidity_adjustment === 'none' && (
                    <div className="bg-yellow-50 p-2 rounded text-xs border border-yellow-200">
                      <p className="font-medium text-yellow-800 mb-1">💡 Low-Impact Alternative (need 2+ for LOW adjustment):</p>
                      <ul className="text-yellow-700">
                        <li>• Hypertension (I10), Atrial Fibrillation (I48), Uncomplicated Diabetes (E11.9)</li>
                        <li>• Osteoarthritis (M15-M17), Anxiety/Depression (F41, F32), Obesity (E66)</li>
                      </ul>
                    </div>
                  )}
                  {oasisResults.pdgm_analysis.qualifying_comorbidities?.potential_additions?.length > 0 && (
                    <div className="bg-green-50 p-2 rounded text-xs border border-green-200">
                      <p className="font-medium text-green-800">✓ Identified in Narrative (needs proper coding):</p>
                      <ul className="text-green-700 space-y-1">
                        {oasisResults.pdgm_analysis.qualifying_comorbidities.potential_additions.map((c, i) => (
                          <li key={i} className="flex items-center gap-1">
                            <span>• {c}</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => copyToClipboard(c, `comorbid-${i}`)}
                              className="h-4 w-4 p-0 ml-auto"
                            >
                              {copiedText === `comorbid-${i}` ? (
                                <CheckCircle2 className="w-3 h-3 text-green-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="bg-indigo-50 p-2 rounded text-xs border border-indigo-200 mt-2">
                    <p className="font-medium text-indigo-800">💰 Comorbidity Impact:</p>
                    <p className="text-indigo-700">
                      {oasisResults.pdgm_analysis.comorbidity_adjustment === 'none' && 'Adding LOW adjustment = +$100-200/episode. Adding HIGH adjustment = +$300-500/episode.'}
                      {oasisResults.pdgm_analysis.comorbidity_adjustment === 'low' && 'Upgrading to HIGH adjustment = additional +$200-300/episode.'}
                      {oasisResults.pdgm_analysis.comorbidity_adjustment === 'high' && 'Currently maximized - excellent work!'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Documentation Gaps */}
        <div className="bg-white p-3 rounded border border-red-200">
          <div className="flex items-start gap-2">
            <Badge className="bg-red-500 text-white text-xs flex-shrink-0">Documentation Gaps</Badge>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-900">Key Documentation Gaps Identified</p>
              <div className="mt-2 space-y-2 text-xs">
                {/* Check for specific gaps based on analysis */}
                {(!extractedIndicators?.clinical?.assistDevices?.detected && oasisResults.functional_score_analysis?.m1860_ambulation?.documented_value > 0) && (
                  <div className="bg-red-50 p-2 rounded">
                    <p className="text-red-800">
                      <strong>🦯 Assistive Device Gap:</strong> Ambulation limitations documented but no assistive device mentioned.
                      Document specific devices (walker, cane, wheelchair) if used.
                    </p>
                  </div>
                )}
                {(!extractedIndicators?.clinical?.fallRisk?.detected) && (
                  <div className="bg-red-50 p-2 rounded">
                    <p className="text-red-800">
                      <strong>⚠️ Fall Risk Gap:</strong> No fall risk documentation found.
                      Document fall history, risk factors, environmental hazards, and interventions implemented.
                    </p>
                  </div>
                )}
                {(!extractedIndicators?.clinical?.painMentioned?.detected) && (
                  <div className="bg-red-50 p-2 rounded">
                    <p className="text-red-800">
                      <strong>💊 Pain Assessment Gap:</strong> No pain documentation found.
                      Document pain level (0-10), location, quality, frequency, and management plan.
                    </p>
                  </div>
                )}
                {(!extractedIndicators?.clinical?.cognitiveIssues?.detected && patient?.primary_diagnosis?.toLowerCase().includes('dementia')) && (
                  <div className="bg-red-50 p-2 rounded">
                    <p className="text-red-800">
                      <strong>🧠 Cognitive Assessment Gap:</strong> Dementia diagnosis but limited cognitive documentation.
                      Document orientation status, BIMS score, memory deficits, and safety concerns.
                    </p>
                  </div>
                )}
                {oasisResults.vague_documentation?.length > 0 && (
                  <div className="bg-red-50 p-2 rounded">
                    <p className="text-red-800">
                      <strong>📝 Vague Language:</strong> {oasisResults.vague_documentation.length} items have vague documentation
                      that could support multiple scores. See "Vague Documentation" section for specific improvements.
                    </p>
                  </div>
                )}
                {oasisResults.cross_validation_failures?.length > 0 && (
                  <div className="bg-red-50 p-2 rounded">
                    <p className="text-red-800">
                      <strong>🔗 Cross-Validation:</strong> {oasisResults.cross_validation_failures.length} item relationships
                      don't align per CMS rules. Fix these to avoid audit flags.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Care Plan Modification Suggestions */}
        <div className="bg-white p-3 rounded border border-navy-200">
          <div className="flex items-start gap-2">
            <Badge className="bg-navy-500 text-white text-xs flex-shrink-0">Care Plan</Badge>
            <div className="flex-1">
              <p className="text-sm font-medium text-navy-900">Care Plan Modification Suggestions</p>
              <div className="mt-2 space-y-2 text-xs">
                {oasisResults.pdgm_analysis.functional_level !== 'high' && (
                  <div className="bg-navy-50 p-2 rounded">
                    <p className="text-navy-800">
                      <strong>🎯 Therapy Referral:</strong> Consider PT/OT evaluation to document objective functional limitations
                      and establish measurable goals. Therapy assessments often capture functional deficits more precisely.
                    </p>
                  </div>
                )}
                {extractedIndicators?.clinical?.diabetic?.detected && (
                  <div className="bg-navy-50 p-2 rounded">
                    <p className="text-navy-800">
                      <strong>🩺 Diabetic Care Plan:</strong> Ensure diabetic complications are documented as separate diagnoses
                      (neuropathy, nephropathy, retinopathy) with specific ICD-10 codes for comorbidity credit.
                    </p>
                  </div>
                )}
                {extractedIndicators?.clinical?.cardiacIssues?.detected && (
                  <div className="bg-navy-50 p-2 rounded">
                    <p className="text-navy-800">
                      <strong>❤️ Cardiac Care Plan:</strong> Document EF% if known, specific CHF type (HFrEF/HFpEF),
                      and daily weight monitoring plan for optimal coding and care coordination.
                    </p>
                  </div>
                )}
                {extractedIndicators?.clinical?.woundPresent?.detected && (
                  <div className="bg-navy-50 p-2 rounded">
                    <p className="text-navy-800">
                      <strong>🩹 Wound Care Plan:</strong> Ensure weekly wound measurements are documented with healing trajectory.
                      Non-healing wounds may indicate need for specialist referral and support higher clinical group assignment.
                    </p>
                  </div>
                )}
                <div className="bg-green-50 p-2 rounded border border-green-200">
                  <p className="font-medium text-green-800">💰 Total Optimization Potential:</p>
                  <p className="text-green-700">
                    Implementing these suggestions could increase case-mix weight by
                    <strong> 0.05-0.15</strong>, translating to approximately
                    <strong> $150-$450</strong> additional per 30-day episode.
                  </p>
                  <div className="mt-2 pt-2 border-t border-green-200">
                    <p className="text-green-800 font-medium">Annual Impact (60 episodes/year):</p>
                    <p className="text-2xl font-bold text-green-900">$9,000 - $27,000</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 mt-2"
                  onClick={() => {
                    const allSuggestions = [
                      ...(oasisResults.underscoring_opportunities || []),
                      ...(oasisResults.critical_missing || []),
                      ...(oasisResults.vague_documentation || [])
                    ];
                    const topSuggestion = allSuggestions[0];
                    if (topSuggestion) {
                      handleSuggestionAccept(topSuggestion, 'optimization');
                    }
                  }}
                  disabled={!oasisResults.underscoring_opportunities?.length && !oasisResults.critical_missing?.length}
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Apply Top Suggestion Now
                </Button>
                </div>
                </div>
                </div>
                </div>
                </div>
                )}

                {/* Quick Action Buttons */}
                {!showOptimizationPanel && (
                <div className="flex flex-wrap gap-2">
                <Badge className="bg-amber-600 text-white">
                {[
                oasisResults.pdgm_analysis.clinical_group_confidence !== 'high' ? 1 : 0,
                oasisResults.pdgm_analysis.functional_level !== 'high' ? 1 : 0,
                oasisResults.pdgm_analysis.comorbidity_adjustment !== 'high' ? 1 : 0
                ].reduce((a, b) => a + b, 0)} optimization areas available
                </Badge>
                </div>
                )}
                </div>
  );
}
