import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, FileText, Activity, AlertTriangle } from "lucide-react";
import SecurityDocumentation from "@/components/security/SecurityDocumentation";
import AuditTrailViewer from "@/components/security/AuditTrailViewer";
import SecurityAnomalyDetector from "@/components/security/SecurityAnomalyDetector";
import PHIDeIdentifier from "@/components/security/PHIDeIdentifier";
import BreachDetectionSystem from "@/components/security/BreachDetectionSystem";
import EncryptionStatusIndicator from "@/components/security/EncryptionStatusIndicator";

export default function SecurityPolicy() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  return (
    <Tabs defaultValue="documentation" className="space-y-4 sm:space-y-6">
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="inline-flex md:grid md:w-full md:grid-cols-7 gap-1 min-w-max h-auto">
            <TabsTrigger value="documentation" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
              <FileText className="w-3 h-3 sm:w-4 sm:h-4" />
              <span>Docs</span>
            </TabsTrigger>
            <TabsTrigger value="encryption" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
              <Shield className="w-3 h-3 sm:w-4 sm:h-4" />
              <span>Encryption</span>
            </TabsTrigger>
            <TabsTrigger value="deidentify" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
              <Shield className="w-3 h-3 sm:w-4 sm:h-4" />
              <span>De-ID</span>
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap" disabled={!isAdmin}>
              <Activity className="w-3 h-3 sm:w-4 sm:h-4" />
              <span>Audit</span>
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap" disabled={!isAdmin}>
              <Shield className="w-3 h-3 sm:w-4 sm:h-4" />
              <span>Security</span>
            </TabsTrigger>
            <TabsTrigger value="anomalies" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap" disabled={!isAdmin}>
              <AlertTriangle className="w-3 h-3 sm:w-4 sm:h-4" />
              <span>Threats</span>
            </TabsTrigger>
            <TabsTrigger value="breach" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap" disabled={!isAdmin}>
              <AlertTriangle className="w-3 h-3 sm:w-4 sm:h-4" />
              <span>Breach</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="documentation">
          <SecurityDocumentation />
        </TabsContent>

        <TabsContent value="encryption">
          <EncryptionStatusIndicator />
        </TabsContent>

        <TabsContent value="deidentify">
          <PHIDeIdentifier />
        </TabsContent>

        <TabsContent value="audit">
          {isAdmin ? (
            <AuditTrailViewer filterType="all" />
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <Shield className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600">Admin access required</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="security">
          {isAdmin ? (
            <AuditTrailViewer filterType="security" />
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <Shield className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600">Admin access required</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="anomalies">
          {isAdmin ? (
            <SecurityAnomalyDetector />
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <Shield className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600">Admin access required</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="breach">
          {isAdmin ? (
            <BreachDetectionSystem />
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <Shield className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600">Admin access required</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
    </Tabs>
  );
}