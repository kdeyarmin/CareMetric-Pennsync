import React, { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useQueryClient } from "@tanstack/react-query";

export default function PaymentSuccess() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    // Invalidate subscription queries to fetch updated data
    queryClient.invalidateQueries({ queryKey: ['userSubscription'] });
  }, [queryClient]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-2 border-green-200 shadow-2xl">
        <CardContent className="p-8 text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-12 h-12 text-green-600" />
          </div>
          
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Payment Successful! 🎉
          </h1>
          
          <p className="text-gray-600 mb-2">
            Your subscription has been activated successfully.
          </p>
          
          <p className="text-sm text-gray-500 mb-8">
            You now have access to all premium features. Start using AI-powered tools to enhance your practice.
          </p>

          <div className="space-y-3">
            <Link to={createPageUrl("Dashboard")} className="block">
              <Button className="w-full bg-green-600 hover:bg-green-700" size="lg">
                Go to Dashboard
              </Button>
            </Link>
            
            <Link to={createPageUrl("Billing")} className="block">
              <Button variant="outline" className="w-full">
                View Billing Details
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}