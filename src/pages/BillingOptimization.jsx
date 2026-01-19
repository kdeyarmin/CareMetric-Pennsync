import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, ShieldAlert, TrendingUp } from "lucide-react";
import MissedChargeDetector from "../components/billing/MissedChargeDetector";
import CodingAccuracyReport from "../components/billing/CodingAccuracyReport";
import RevenueProjection from "../components/billing/RevenueProjection";

export default function BillingOptimization() {
  return (
    <div className="container mx-auto p-4 lg:p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Billing Optimization
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Maximize revenue with AI-powered charge detection, coding accuracy analysis, and revenue projections
        </p>
      </div>

      <Tabs defaultValue="missed" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="missed" className="flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            <span className="hidden sm:inline">Missed Charges</span>
          </TabsTrigger>
          <TabsTrigger value="accuracy" className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" />
            <span className="hidden sm:inline">Coding Accuracy</span>
          </TabsTrigger>
          <TabsTrigger value="projection" className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">Revenue Projection</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="missed">
          <MissedChargeDetector dateRange={30} />
        </TabsContent>

        <TabsContent value="accuracy">
          <CodingAccuracyReport />
        </TabsContent>

        <TabsContent value="projection">
          <RevenueProjection />
        </TabsContent>
      </Tabs>
    </div>
  );
}