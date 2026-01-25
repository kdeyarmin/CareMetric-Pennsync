import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function SubscriptionPlanSwitcher({ currentUser }) {
  const [selectedPrice, setSelectedPrice] = useState(null);
  const queryClient = useQueryClient();

  // Fetch current subscription
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

  // Fetch available products and prices
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['stripeProducts'],
    queryFn: async () => {
      const response = await base44.functions.invoke('stripeListProducts');
      return response?.data?.products || [];
    }
  });

  const { data: pricesByProduct = {} } = useQuery({
    queryKey: ["stripePrices"],
    queryFn: async () => {
      const prices = {};
      for (const product of products) {
        try {
          const response = await base44.functions.invoke('stripeListPrices', { 
            product_id: product.id 
          });
          prices[product.id] = (response?.data?.prices || []).filter(p => p.active);
        } catch (error) {
          console.error(`Error fetching prices for ${product.id}:`, error);
          prices[product.id] = [];
        }
      }
      return prices;
    },
    enabled: products.length > 0
  });

  // Update subscription mutation
  const updateMutation = useMutation({
    mutationFn: async (newPriceId) => {
      const response = await base44.functions.invoke('updateSubscriptionPrice', {
        subscription_id: subscription.stripe_subscription_id,
        new_price_id: newPriceId
      });
      return response?.data;
    },
    onSuccess: () => {
      toast.success("Subscription updated successfully!");
      queryClient.invalidateQueries(['userSubscription']);
      setSelectedPrice(null);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update subscription");
    }
  });

  const formatPrice = (amount, currency, interval) => {
    const price = (amount / 100).toFixed(2);
    return `$${price}/${interval}`;
  };

  const isCurrentPrice = (priceId) => {
    return subscription?.stripe_price_id === priceId;
  };

  if (loadingSub || loadingProducts) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!subscription || subscription.status !== 'active') {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">You don't have an active subscription.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Current Plan</CardTitle>
          <CardDescription>
            Manage your subscription and switch between plans
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => {
          const prices = pricesByProduct[product.id] || [];
          
          return prices.map((price) => {
            const isCurrent = isCurrentPrice(price.id);
            const isSelected = selectedPrice === price.id;
            
            return (
              <Card 
                key={price.id}
                className={`relative ${isCurrent ? 'border-primary' : ''} ${isSelected ? 'ring-2 ring-primary' : ''}`}
              >
                {isCurrent && (
                  <Badge className="absolute top-4 right-4">
                    Current Plan
                  </Badge>
                )}
                
                <CardHeader>
                  <CardTitle className="text-lg">{product.name}</CardTitle>
                  <div className="text-3xl font-bold">
                    {formatPrice(price.unit_amount, price.currency, price.recurring.interval)}
                  </div>
                </CardHeader>
                
                <CardContent>
                  {product.description && (
                    <p className="text-sm text-muted-foreground mb-4">
                      {product.description}
                    </p>
                  )}
                  
                  {isCurrent ? (
                    <Button disabled className="w-full">
                      <Check className="w-4 h-4 mr-2" />
                      Current Plan
                    </Button>
                  ) : (
                    <Button
                      variant={isSelected ? "default" : "outline"}
                      className="w-full"
                      onClick={() => {
                        if (updateMutation.isPending) return;
                        if (isSelected) {
                          updateMutation.mutate(price.id);
                        } else {
                          setSelectedPrice(price.id);
                        }
                      }}
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending && isSelected ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Updating...
                        </>
                      ) : isSelected ? (
                        'Confirm Switch'
                      ) : (
                        'Switch to This Plan'
                      )}
                    </Button>
                  )}
                  
                  {isSelected && !isCurrent && (
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      Click again to confirm. Charges will be prorated.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          });
        })}
      </div>
    </div>
  );
}