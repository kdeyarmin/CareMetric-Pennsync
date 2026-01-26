import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Shield, Eye, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function ComplianceViolationWidget({ entityType, entityId, showTitle = true }) {
  const [expanded, setExpanded] = useState(false);

  const { data: violations = [], isLoading } = useQuery({
    queryKey: ['entityViolations', entityType, entityId],
    queryFn: () => base44.entities.ComplianceViolation.filter({
      entity_type: entityType.toLowerCase(),
      entity_id: entityId,
      status: 'open'
    }),
    enabled: !!entityId
  });

  if (isLoading) {
    return null;
  }

  if (violations.length === 0) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <span className="text-sm font-medium text-green-800">No compliance issues detected</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const criticalCount = violations.filter(v => v.severity === 'critical').length;
  const highCount = violations.filter(v => v.severity === 'high').length;

  return (
    <Card className="border-orange-200 bg-orange-50">
      {showTitle && (
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
            Compliance Issues Detected
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex gap-2">
            {criticalCount > 0 && (
              <Badge className="bg-red-600">
                {criticalCount} Critical
              </Badge>
            )}
            {highCount > 0 && (
              <Badge className="bg-orange-600">
                {highCount} High
              </Badge>
            )}
            {violations.length - criticalCount - highCount > 0 && (
              <Badge className="bg-yellow-600">
                {violations.length - criticalCount - highCount} Other
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded(!expanded)}
          >
            <Eye className="w-4 h-4 mr-1" />
            {expanded ? 'Hide' : 'View'} Details
          </Button>
        </div>

        {expanded && (
          <div className="space-y-2 pt-2">
            {violations.slice(0, 5).map((violation, idx) => (
              <div key={idx} className="p-3 bg-white rounded border border-orange-200">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{violation.rule_name}</p>
                    <p className="text-xs text-gray-600 mt-1">{violation.violation_description}</p>
                    {violation.suggested_fix && (
                      <p className="text-xs text-blue-600 mt-2">
                        💡 Fix available
                      </p>
                    )}
                  </div>
                  <Badge className={
                    violation.severity === 'critical' ? 'bg-red-600' :
                    violation.severity === 'high' ? 'bg-orange-600' :
                    'bg-yellow-600'
                  }>
                    {violation.severity}
                  </Badge>
                </div>
              </div>
            ))}
            {violations.length > 5 && (
              <p className="text-xs text-center text-gray-500">
                + {violations.length - 5} more issues
              </p>
            )}
            <Link to={createPageUrl("ComplianceDashboard")}>
              <Button size="sm" className="w-full mt-2" variant="outline">
                <Shield className="w-4 h-4 mr-2" />
                View in Compliance Dashboard
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}