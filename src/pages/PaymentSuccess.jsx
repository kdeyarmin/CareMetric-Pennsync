import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const publicPage = true;

export default function PaymentSuccess() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6">
      <CheckCircle2 className="w-24 h-24 text-green-500 mb-6" />
      <h1 className="text-4xl font-bold text-gray-800 mb-4">Payment Successful!</h1>
      <p className="text-gray-600 mb-8 text-center max-w-md">
        Thank you for your subscription. Your account has been upgraded, and you can now access all premium features.
      </p>
      <Link to={createPageUrl('Dashboard')}>
        <Button>Go to Dashboard</Button>
      </Link>
    </div>
  );
}