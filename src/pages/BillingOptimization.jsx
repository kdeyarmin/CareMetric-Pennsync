import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, ShieldAlert, TrendingUp } from "lucide-react";
import MissedChargeDetector from "../components/billing/MissedChargeDetector";
import CodingAccuracyReport from "../components/billing/CodingAccuracyReport";
import RevenueProjection from "../components/billing/RevenueProjection";

export default function BillingOptimization() {
  return (
    <div className="w-full max-w-full overflow-x-hidden min-w-0">
      <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Billing Optimization
          </h1>
          <p className="text-xs sm:text-sm md:text-base text-gray-600 dark:text-gray-400">
            Maximize revenue with AI-powered charge detection, coding accuracy analysis, and revenue projections
          </p>
        </div>

        <Tabs defaultValue="missed" className="space-y-4 w-full">
          <div className="w-full overflow-x-auto">
            <TabsList className="inline-flex w-max min-w-full gap-1 p-1">
              <TabsTrigger value="missed" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap">
                <DollarSign className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                <span>Missed</span>
              </TabsTrigger>
              <TabsTrigger value="accuracy" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap">
                <ShieldAlert className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                <span>Accuracy</span>
              </TabsTrigger>
              <TabsTrigger value="projection" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap">
                <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                <span>Projection</span>
              </TabsTrigger>
            </TabsList>
          </div>

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
    </div>
  );
}