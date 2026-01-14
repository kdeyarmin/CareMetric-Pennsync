import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, Shield } from "lucide-react";
import RegulatoryAlertsDashboard from "../components/regulatory/RegulatoryAlertsDashboard";

export default function RegulatoryUpdates() {
  const [lastRefresh, setLastRefresh] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        return null;
      }
    }
  });

  const handleRefresh = async () => {
    setLastRefresh(new Date());
    // Trigger any refresh logic if needed
  };

  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto min-h-screen w-full">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
            <Shield className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900">
              Regulatory Updates
            </h1>
            <p className="text-gray-600 mt-1">
              Stay informed on the latest healthcare regulations and compliance requirements
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={handleRefresh}
            variant="outline"
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh Updates
          </Button>
          {lastRefresh && (
            <span className="text-sm text-gray-500 flex items-center">
              Last updated: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Regulatory Dashboard */}
      <Card className="border-0 shadow-lg">
        <CardContent className="p-6">
          <RegulatoryAlertsDashboard />
        </CardContent>
      </Card>
    </div>
  );
}