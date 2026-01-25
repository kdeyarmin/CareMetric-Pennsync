import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Calendar, 
  CreditCard, 
  Download, 
  Loader2, 
  CheckCircle2,
  AlertCircle,
  ExternalLink
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function CustomerPortal({ currentUser }) {
  // Fetch subscription
  const { data: subscription, isLoading: loadingSub } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: async () => {
      const subs = await base44.entities.Subscription.filter({ 
        user_email: currentUser.email 
      });
      return subs[0];
    },
    enabled: !!currentUser?.email
  });

  // Fetch billing history
  const { data: billingData, isLoading: loadingBilling } = useQuery({
    queryKey: ['billingHistory', currentUser?.email],
    queryFn: async () => {
      const response = await base44.functions.invoke('getCustomerBillingHistory');
      return response?.data || { invoices: [], paymentMethods: [] };
    },
    enabled: !!currentUser?.email && !!subscription
  });

  const handleManagePaymentMethod = async () => {
    try {
      toast.loading("Opening payment portal...");
      const response = await base44.functions.invoke('createStripePortal', {
        return_url: window.location.href
      });
      
      toast.dismiss();
      
      if (response?.data?.url) {
        window.location.href = response.data.url;
      } else {
        toast.error("Failed to open payment portal");
      }
    } catch (error) {
      toast.dismiss();
      toast.error(error.message || "Failed to open payment portal");
    }
  };

  const getStatusBadge = (status) => {
    const variants = {
      active: { color: "bg-green-100 text-green-800", label: "Active" },
      trialing: { color: "bg-blue-100 text-blue-800", label: "Trial" },
      past_due: { color: "bg-red-100 text-red-800", label: "Past Due" },
      canceled: { color: "bg-gray-100 text-gray-800", label: "Canceled" },
      unpaid: { color: "bg-red-100 text-red-800", label: "Unpaid" }
    };
    
    const variant = variants[status] || variants.active;
    return <Badge className={variant.color}>{variant.label}</Badge>;
  };

  const formatAmount = (amount, currency = 'usd') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount / 100);
  };

  if (loadingSub) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!subscription) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">No active subscription found.</p>
        </CardContent>
      </Card>
    );
  }

  const invoices = billingData?.invoices || [];
  const paymentMethods = billingData?.paymentMethods || [];

  return (
    <div className="space-y-6">
      {/* Current Subscription Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Current Subscription</CardTitle>
          <CardDescription>Overview of your subscription status</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <div className="mt-1">{getStatusBadge(subscription.status)}</div>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Plan</p>
              <p className="font-medium">{subscription.plan_name || 'Subscription Plan'}</p>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            {subscription.current_period_start && (
              <div>
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Current Period Start
                </p>
                <p className="font-medium mt-1">
                  {format(new Date(subscription.current_period_start), 'MMM d, yyyy')}
                </p>
              </div>
            )}
            
            {subscription.current_period_end && (
              <div>
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  {subscription.cancel_at_period_end ? 'Expires On' : 'Renews On'}
                </p>
                <p className="font-medium mt-1">
                  {format(new Date(subscription.current_period_end), 'MMM d, yyyy')}
                </p>
              </div>
            )}
          </div>

          {subscription.cancel_at_period_end && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                Your subscription will not renew and will end on{' '}
                {format(new Date(subscription.current_period_end), 'MMMM d, yyyy')}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Method */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Payment Method</CardTitle>
              <CardDescription>Manage your payment information</CardDescription>
            </div>
            <Button onClick={handleManagePaymentMethod} variant="outline" size="sm">
              <ExternalLink className="w-4 h-4 mr-2" />
              Manage
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingBilling ? (
            <div className="flex justify-center p-4">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : paymentMethods.length > 0 ? (
            <div className="space-y-2">
              {paymentMethods.map((pm) => (
                <div key={pm.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <CreditCard className="w-5 h-5 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="font-medium">
                      {pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1)} •••• {pm.card.last4}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Expires {pm.card.exp_month}/{pm.card.exp_year}
                    </p>
                  </div>
                  {paymentMethods[0].id === pm.id && (
                    <Badge variant="outline">Default</Badge>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No payment method on file</p>
          )}
        </CardContent>
      </Card>

      {/* Billing History */}
      <Card>
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
          <CardDescription>View your past invoices and payments</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingBilling ? (
            <div className="flex justify-center p-4">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : invoices.length > 0 ? (
            <div className="space-y-2">
              {invoices.map((invoice) => (
                <div 
                  key={invoice.id} 
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
                        {format(new Date(invoice.created * 1000), 'MMM d, yyyy')}
                      </p>
                      {invoice.status === 'paid' ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : invoice.status === 'open' ? (
                        <AlertCircle className="w-4 h-4 text-amber-600" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-red-600" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Invoice #{invoice.number || invoice.id.substring(0, 8)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-medium">
                        {formatAmount(invoice.amount_paid || invoice.total, invoice.currency)}
                      </p>
                      <p className="text-sm text-muted-foreground capitalize">
                        {invoice.status}
                      </p>
                    </div>
                    {invoice.invoice_pdf && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.open(invoice.invoice_pdf, '_blank')}
                        title="Download Invoice"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No billing history available</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}