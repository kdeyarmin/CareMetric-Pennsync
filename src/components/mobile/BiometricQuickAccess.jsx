import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Fingerprint, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { base64URLDecode } from '@/components/utils/webauthn';

/**
 * Quick biometric authentication for sensitive actions
 * Used before accessing patient data, sending messages, etc.
 */
export default function BiometricQuickAccess({ 
  userEmail, 
  onAuthSuccess, 
  actionDescription = "this action",
  children 
}) {
  const [isRegistered, setIsRegistered] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

  useEffect(() => {
    const registered = localStorage.getItem(`biometric_${userEmail}`) !== null;
    setIsRegistered(registered);
  }, [userEmail]);

  const authenticate = async () => {
    if (!isRegistered) {
      toast.error('Biometric authentication not set up');
      return;
    }

    setAuthenticating(true);
    try {
      const storedData = JSON.parse(localStorage.getItem(`biometric_${userEmail}`));
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const publicKeyOptions = {
        challenge,
        allowCredentials: [{
          type: 'public-key',
          id: base64URLDecode(storedData.credentialId),
          transports: ['internal']
        }],
        userVerification: 'required',
        timeout: 60000
      };

      const assertion = await navigator.credentials.get({
        publicKey: publicKeyOptions
      });

      if (assertion) {
        setIsAuthenticated(true);
        toast.success('Authenticated');
        if (onAuthSuccess) onAuthSuccess();
      }
    } catch (error) {
      console.error('Authentication error:', error);
      toast.error('Authentication failed');
    } finally {
      setAuthenticating(false);
    }
  };

  if (!isRegistered || isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="bg-gray-50 border-2 border-gray-200 rounded-lg p-6 text-center">
      <Lock className="w-12 h-12 text-gray-400 mx-auto mb-3" />
      <h3 className="font-semibold mb-2">Authentication Required</h3>
      <p className="text-sm text-gray-600 mb-4">
        Please verify your identity to {actionDescription}
      </p>
      <Button
        onClick={authenticate}
        disabled={authenticating}
        className="bg-blue-600 hover:bg-blue-700"
      >
        {authenticating ? (
          <>
            <Fingerprint className="w-4 h-4 mr-2 animate-pulse" />
            Authenticating...
          </>
        ) : (
          <>
            <Fingerprint className="w-4 h-4 mr-2" />
            Authenticate with Biometric
          </>
        )}
      </Button>
    </div>
  );
}