import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp } from "lucide-react";

const RISK_COLORS = {
  critical: { bg: "bg-red-50", text: "text-red-900", badge: "bg-red-100 text-red-800" },
  high: { bg: "bg-orange-50", text: "text-orange-900", badge: "bg-orange-100 text-orange-800" },
  medium: { bg: "bg-yellow-50", text: "text-yellow-900", badge: "bg-yellow-100 text-yellow-800" },
  low: { bg: "bg-blue-50", text: "text-blue-900", badge: "bg-blue-100 text-blue-800" }
};

export default function DenialRiskAnalyzer({ denialRisks = [] }) {
  const [expanded, setExpanded] = useState({});

  if (!denialRisks || denialRisks.length === 0) return null;

  const toggleExpand = (idx) => {
    setExpanded((prev) => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  // Group by risk level
  const criticalRisks = denialRisks.filter((r) => r.risk_level === "critical");
  const highRisks = denialRisks.filter((r) => r.risk_level === "high");
  const mediumRisks = denialRisks.filter((r) => r.risk_level === "medium");

  const renderRiskItem = (risk, idx) => {
    const colors = RISK_COLORS[risk.risk_level];
    const isExpanded = expanded[idx];

    return (
      <div key={idx} className={`${colors.bg} p-4 rounded border border-gray-200`}>
        <div
          className="flex items-start justify-between cursor-pointer"
          onClick={() => toggleExpand(idx)}
        >
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {risk.risk_level === "critical" ? (
                <AlertTriangle className="w-5 h-5 text-red-600" />
              ) : (
                <AlertCircle className="w-4 h-4 text-orange-600" />
              )}
              <h4 className={`font-semibold ${colors.text}`}>
                {risk.payer_type} - {risk.denial_reason}
              </h4>
              {risk?.risk_level && (
                <Badge className={colors.badge}>{risk.risk_level.toUpperCase()}</Badge>
              )}
            </div>
            <p className={`text-sm ${colors.text} opacity-75`}>
              Codes at risk: {risk.problematic_codes.join(", ")}
            </p>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 flex-shrink-0 mt-1" />
          ) : (
            <ChevronDown className="w-4 h-4 flex-shrink-0 mt-1" />
          )}
        </div>

        {isExpanded && (
          <div className="mt-3 space-y-3 border-t pt-3">
            {/* Required Documentation */}
            {risk.required_documentation?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">
                  📋 Required Documentation:
                </p>
                <ul className="space-y-1">
                  {risk.required_documentation.map((doc, i) => (
                    <li key={i} className="text-xs text-gray-700 flex gap-2">
                      <span className="text-green-600 font-bold">✓</span>
                      {doc}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Pre-Auth Requirements */}
            {risk.requires_preauth && (
              <div className="bg-white p-2 rounded border border-yellow-300">
                <p className="text-xs font-semibold text-yellow-900 flex items-center gap-2">
                  <Info className="w-4 h-4" /> Pre-Authorization Required
                </p>
                <p className="text-xs text-yellow-800 mt-1">
                  This service requires prior authorization before billing to avoid automatic denial.
                </p>
              </div>
            )}

            {/* Age/Gender Restrictions */}
            {risk.age_gender_restrictions && (
              <div className="bg-white p-2 rounded border border-pink-300">
                <p className="text-xs font-semibold text-pink-900">Age/Gender Restrictions:</p>
                <p className="text-xs text-pink-800 mt-1">{risk.age_gender_restrictions}</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="border rounded-lg p-4 bg-red-50 space-y-4">
      <h3 className="font-semibold text-red-900 mb-3 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5" /> Payer-Specific Denial Risks
      </h3>

      {criticalRisks.length > 0 && (
        <div>
          <p className="text-xs font-bold text-red-800 mb-2 px-2">
            🚨 CRITICAL DENIAL RISKS ({criticalRisks.length})
          </p>
          <div className="space-y-2">
            {criticalRisks.map((risk, idx) => renderRiskItem(risk, idx))}
          </div>
        </div>
      )}

      {highRisks.length > 0 && (
        <div>
          <p className="text-xs font-bold text-orange-800 mb-2 px-2">
            ⚠️ HIGH DENIAL RISKS ({highRisks.length})
          </p>
          <div className="space-y-2">
            {highRisks.map((risk, idx) => renderRiskItem(risk, idx + 100))}
          </div>
        </div>
      )}

      {mediumRisks.length > 0 && (
        <div>
          <p className="text-xs font-bold text-yellow-800 mb-2 px-2">
            ⚡ MEDIUM RISKS ({mediumRisks.length})
          </p>
          <div className="space-y-2">
            {mediumRisks.map((risk, idx) => renderRiskItem(risk, idx + 200))}
          </div>
        </div>
      )}
    </div>
  );
}