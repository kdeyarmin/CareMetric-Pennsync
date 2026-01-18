import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CreditCard } from "lucide-react";
import { createPageUrl } from "@/utils";
import StripeSubscriptionManager from "../components/admin/StripeSubscriptionManager";

export default function AdminSubscriptions() {
  const navigate = useNavigate();

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <div className="p-2 sm:p-3 md:p-4 lg:p-6 max-w-6xl mx-auto pb-20 w-full max-w-full overflow-x-hidden min-w-0">
        <Button
          variant="outline"
          onClick={() => navigate(createPageUrl("AdminDashboard"))}
          className="mb-4 w-full sm:w-auto touch-target"
          size="sm"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Admin
        </Button>

        <Card className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CreditCard className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              Stripe Subscription Manager
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 dark:text-gray-300">
              Manage your Stripe products and subscription pricing directly within your app.
              Create new plans, set prices, and manage your subscription offerings without leaving CareMetric AI.
            </p>
          </CardContent>
        </Card>

        <StripeSubscriptionManager />
      </div>
    </div>
  );
}