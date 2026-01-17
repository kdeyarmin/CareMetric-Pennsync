import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Fingerprint, Smartphone, Shield, CheckCircle2, AlertCircle } from 'lucide-react';
import { base64URLEncode, base64URLDecode } from '@/components/utils/webauthn';
import { toast } from 'sonner';

export default function BiometricAuth({ userEmail, onAuthSuccess }) {
  const [isSupported, setIsSupported] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

  useEffect(() => {
    const checkSupport = async () => {
      // Check if WebAuthn is supported
      const supported = window.PublicKeyCredential !== undefined;
      
      if (supported) {
        // Check if platform authenticator is available
        try {
          const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          setIsSupported(available);
          
          if (!available) {
            console.warn('WebAuthn supported but no platform authenticator available');
          }
        } catch (error) {
          console.error('Error checking authenticator:', error);
          setIsSupported(false);
        }
      } else {
        setIsSupported(false);
      }

      // Check if user has registered biometric
      const registered = localStorage.getItem(`biometric_${userEmail}`) !== null;
      setIsRegistered(registered);
    };

    if (userEmail) {
      checkSupport();
    }
  }, [userEmail]);

  const registerBiometric = async () => {
    if (!isSupported) {
      toast.error('Biometric authentication not supported on this device');
      return;
    }

    setRegistering(true);
    try {
      // First check if platform authenticator is available
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) {
        throw new Error('No biometric authenticator available on this device');
      }

      // Generate challenge
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      // Get proper RP ID - use hostname without port
      let rpId = window.location.hostname;
      // For localhost, don't include port
      if (rpId === 'localhost' || rpId === '127.0.0.1') {
        rpId = 'localhost';
      }

      const publicKeyOptions = {
        challenge,
        rp: {
          name: 'CareMetric AI',
          id: rpId
        },
        user: {
          id: new TextEncoder().encode(userEmail),
          name: userEmail,
          displayName: userEmail
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },  // ES256
          { type: 'public-key', alg: -257 } // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          requireResidentKey: false,
          userVerification: 'required'
        },
        timeout: 60000,
        attestation: 'none'
      };

      console.log('Starting biometric registration:', {
        rpId,
        userEmail,
        options: publicKeyOptions
      });

      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions
      });

      if (!credential) {
        throw new Error('No credential returned');
      }

      console.log('Biometric registration successful:', credential);

      // Store credential ID locally
      localStorage.setItem(`biometric_${userEmail}`, JSON.stringify({
        credentialId: base64URLEncode(credential.rawId),
        registered: new Date().toISOString()
      }));

      setIsRegistered(true);
      toast.success('Biometric authentication enabled!');
    } catch (error) {
      console.error('Registration error:', error);
      if (error.name === 'NotAllowedError') {
        toast.error('Biometric registration cancelled. Please try again and approve the prompt.');
      } else if (error.name === 'NotSupportedError') {
        toast.error('Biometric authentication not supported on this browser');
      } else if (error.name === 'SecurityError') {
        toast.error('Security error - please use HTTPS or localhost');
      } else if (error.message.includes('authenticator')) {
        toast.error('No biometric sensor detected. Please check your device settings.');
      } else {
        toast.error(`Registration failed: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setRegistering(false);
    }
  };

  const authenticateWithBiometric = async () => {
    if (!isRegistered) {
      toast.error('Please register biometric authentication first');
      return;
    }

    setAuthenticating(true);
    try {
      const storedData = JSON.parse(localStorage.getItem(`biometric_${userEmail}`));
      
      if (!storedData || !storedData.credentialId) {
        throw new Error('No stored credential found. Please re-register.');
      }

      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      // Get proper RP ID
      let rpId = window.location.hostname;
      if (rpId === 'localhost' || rpId === '127.0.0.1') {
        rpId = 'localhost';
      }

      const publicKeyOptions = {
        challenge,
        rpId,
        allowCredentials: [{
          type: 'public-key',
          id: base64URLDecode(storedData.credentialId),
          transports: ['internal']
        }],
        userVerification: 'required',
        timeout: 60000
      };

      console.log('Starting biometric authentication:', publicKeyOptions);

      const assertion = await navigator.credentials.get({
        publicKey: publicKeyOptions
      });

      if (assertion) {
        console.log('Biometric authentication successful:', assertion);
        toast.success('Biometric authentication successful!');
        if (onAuthSuccess) onAuthSuccess();
      } else {
        throw new Error('No assertion returned');
      }
    } catch (error) {
      console.error('Authentication error:', error);
      if (error.name === 'NotAllowedError') {
        toast.error('Authentication cancelled. Please try again.');
      } else if (error.message.includes('credential')) {
        toast.error('Credential not found. Please re-register biometric authentication.');
        setIsRegistered(false);
        localStorage.removeItem(`biometric_${userEmail}`);
      } else {
        toast.error(`Authentication failed: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setAuthenticating(false);
    }
  };

  const removeBiometric = () => {
    localStorage.removeItem(`biometric_${userEmail}`);
    setIsRegistered(false);
    toast.success('Biometric authentication removed');
  };

  if (!isSupported) {
    return (
      <Card className="border-yellow-200 bg-yellow-50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-yellow-800">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm">Biometric authentication not supported on this device</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-blue-600" />
            Biometric Authentication
          </span>
          {isRegistered && (
            <Badge className="bg-green-100 text-green-800">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Enabled
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <Smartphone className="w-5 h-5 text-blue-600 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-blue-900 mb-1">Fast & Secure Access</p>
            <p className="text-blue-700">
              Use your device's fingerprint or face recognition for quick, secure login to CareMetric AI.
            </p>
          </div>
        </div>

        {!isRegistered ? (
          <Button
            onClick={registerBiometric}
            disabled={registering}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {registering ? (
              <>
                <Shield className="w-4 h-4 mr-2 animate-pulse" />
                Setting up...
              </>
            ) : (
              <>
                <Fingerprint className="w-4 h-4 mr-2" />
                Enable Biometric Login
              </>
            )}
          </Button>
        ) : (
          <div className="space-y-2">
            <Button
              onClick={authenticateWithBiometric}
              disabled={authenticating}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {authenticating ? (
                <>
                  <Shield className="w-4 h-4 mr-2 animate-pulse" />
                  Authenticating...
                </>
              ) : (
                <>
                  <Fingerprint className="w-4 h-4 mr-2" />
                  Test Biometric Login
                </>
              )}
            </Button>
            <Button
              onClick={removeBiometric}
              variant="outline"
              className="w-full text-red-600 hover:bg-red-50"
            >
              Remove Biometric Authentication
            </Button>
          </div>
        )}

        <div className="text-xs text-gray-600 space-y-1">
          <p>✓ Works with Face ID, Touch ID, and fingerprint sensors</p>
          <p>✓ Credentials stored securely on your device</p>
          <p>✓ Never transmitted over the network</p>
        </div>
      </CardContent>
    </Card>
  );
}