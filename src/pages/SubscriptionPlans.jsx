import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';

// IMPORTANT: Replace with your actual Stripe publishable key
const stripePromise = loadStripe('pk_test_YOUR_PUBLISHABLE_KEY'); 

export default function SubscriptionPlans() {
  const [loadingPriceId, setLoadingPriceId] = useState(null);

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['subscriptionSettings'],
    queryFn: async () => {
      const result = await base44.entities.SubscriptionSettings.list();
      return result.length > 0 ? result[0] : null;
    }
  });

  const plans = [
    { name: 'Monthly', price: settings?.monthly_price, priceId: settings?.stripe_monthly_price_id, period: '/ month' },
    { name: 'Quarterly', price: settings?.quarterly_price, priceId: settings?.stripe_quarterly_price_id, period: '/ 3 months' },
    { name: 'Biannual', price: settings?.biannual_price, priceId: settings?.stripe_biannual_price_id, period: '/ 6 months' },
    { name: 'Yearly', price: settings?.yearly_price, priceId: settings?.stripe_yearly_price_id, period: '/ year' },
  ];

  const handleCheckout = async (priceId) => {
    if (!priceId) {
      alert("Stripe price ID is not configured for this plan.");
      return;
    }
    setLoadingPriceId(priceId);
    try {
      const { data } = await base44.functions.invoke('createStripeCheckout', { priceId });
      const stripe = await stripePromise;
      const { error } = await stripe.redirectToCheckout({ sessionId: data.sessionId });
      if (error) {
        console.error("Stripe checkout error:", error);
        setLoadingPriceId(null);
      }
    } catch (error) {
      console.error("Failed to create checkout session:", error);
      setLoadingPriceId(null);
    }
  };

  if (settingsLoading) {
    return <div className="p-8 text-center">Loading plans...</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-4xl font-bold text-center mb-4">Our Plans</h1>
      <p className="text-center text-gray-600 mb-12">Choose the plan that's right for you.</p>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
        {plans.map((plan) => (
          <Card key={plan.name} className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-2xl">{plan.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col">
              <p className="text-4xl font-bold mb-2">
                ${plan.price}
                <span className="text-lg font-normal text-gray-500">{plan.period}</span>
              </p>
              <ul className="space-y-2 text-gray-600 my-6 flex-grow">
                {(settings?.features || []).map(feature => (
                   <li key={feature} className="flex items-center gap-2">
                     <CheckCircle2 className="w-5 h-5 text-green-500" />
                     {feature}
                   </li>
                ))}
              </ul>
              <Button
                onClick={() => handleCheckout(plan.priceId)}
                disabled={!plan.priceId || loadingPriceId === plan.priceId}
                className="w-full mt-auto"
              >
                {loadingPriceId === plan.priceId ? <Loader2 className="animate-spin" /> : 'Choose Plan'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}