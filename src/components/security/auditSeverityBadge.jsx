import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Info } from "lucide-react";

const SEVERITY_CONFIG = {
  critical: { color: "bg-red-600 text-white", icon: AlertTriangle },
  warning: { color: "bg-yellow-600 text-white", icon: AlertTriangle },
  info: { color: "bg-blue-600 text-white", icon: Info },
};

/**
 * Severity badge (colored pill + icon) for audit-log rows. Shared by
 * AuditTrailViewer and the Security Compliance audit tab, which had identical copies.
 */
export function getSeverityBadge(severity) {
  const { color, icon: Icon } = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info;
  return (
    <Badge className={color}>
      <Icon className="w-3 h-3 mr-1" />
      {severity || "info"}
    </Badge>
  );
}
