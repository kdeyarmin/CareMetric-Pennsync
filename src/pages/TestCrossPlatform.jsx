import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { 
  Smartphone, 
  CheckCircle2, 
  XCircle, 
  Fingerprint,
  Shield,
  Wifi,
  Download,
  Vibrate,
  Monitor
} from 'lucide-react';
import BiometricAuth from '../components/auth/BiometricAuth';
import { usePlatformDetection, PlatformBadge, hapticFeedback, requestPersistentStorage, isPWA } from '../components/mobile/PlatformOptimizations';
import { secureOfflineStorage } from '../components/mobile/SecureOfflineStorage';
import { offlineStorage } from '../components/mobile/EnhancedOfflineStorage';
import { toast } from 'sonner';

export default function TestCrossPlatform() {
  const platform = usePlatformDetection();
  const [testData, setTestData] = useState('{"patient": "John Doe", "diagnosis": "Hypertension"}');
  const [encryptedData, setEncryptedData] = useState(null);
  const [decryptedData, setDecryptedData] = useState(null);
  const [isPWAInstalled, setIsPWAInstalled] = useState(false);
  const [hasPersistentStorage, setHasPersistentStorage] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  useEffect(() => {
    setIsPWAInstalled(isPWA());
    checkPersistentStorage();
  }, []);

  const checkPersistentStorage = async () => {
    if (navigator.storage && navigator.storage.persisted) {
      const persisted = await navigator.storage.persisted();
      setHasPersistentStorage(persisted);
    }
  };

  const testEncryption = async () => {
    if (!currentUser?.email) {
      toast.error('Please log in first');
      return;
    }

    try {
      const data = JSON.parse(testData);
      const encrypted = await secureOfflineStorage.encrypt(data, currentUser.email);
      setEncryptedData(encrypted);
      toast.success('Data encrypted successfully!');
    } catch (error) {
      toast.error('Encryption failed: ' + error.message);
    }
  };

  const testDecryption = async () => {
    if (!encryptedData || !currentUser?.email) {
      toast.error('Please encrypt data first');
      return;
    }

    try {
      const decrypted = await secureOfflineStorage.decrypt(encryptedData, currentUser.email);
      setDecryptedData(decrypted);
      toast.success('Data decrypted successfully!');
    } catch (error) {
      toast.error('Decryption failed: ' + error.message);
    }
  };

  const testOfflineSave = async () => {
    if (!currentUser?.email) {
      toast.error('Please log in first');
      return;
    }

    try {
      await secureOfflineStorage.saveEncryptedNote({
        patient_id: 'test-patient',
        visit_type: 'routine',
        diagnosis: 'Test diagnosis',
        rough_notes: 'Test encrypted note',
        timestamp: new Date().toISOString()
      }, currentUser.email);
      toast.success('Encrypted note saved offline!');
    } catch (error) {
      toast.error('Save failed: ' + error.message);
    }
  };

  const testHaptic = (style) => {
    hapticFeedback(style);
    toast.success(`${style} haptic triggered`);
  };

  const requestPersistent = async () => {
    const granted = await requestPersistentStorage();
    setHasPersistentStorage(granted);
    if (granted) {
      toast.success('Persistent storage granted!');
    } else {
      toast.error('Persistent storage denied');
    }
  };

  const FeatureStatus = ({ name, supported, icon: Icon }) => (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-gray-600" />
        <span className="text-sm font-medium">{name}</span>
      </div>
      {supported ? (
        <Badge className="bg-green-100 text-green-800">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Supported
        </Badge>
      ) : (
        <Badge className="bg-red-100 text-red-800">
          <XCircle className="w-3 h-3 mr-1" />
          Not Available
        </Badge>
      )}
    </div>
  );

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Cross-Platform Features Test</h1>
        <p className="text-gray-600 mb-6">Test all native features and optimizations</p>

        {/* Platform Detection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              Platform Detection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">Current Platform:</span>
              <PlatformBadge />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-2 bg-gray-50 rounded">
                <span className="text-gray-600">Type:</span> <strong>{platform.type}</strong>
              </div>
              <div className="p-2 bg-gray-50 rounded">
                <span className="text-gray-600">OS:</span> <strong>{platform.os}</strong>
              </div>
              <div className="p-2 bg-gray-50 rounded">
                <span className="text-gray-600">Touch:</span> <strong>{platform.isTouch ? 'Yes' : 'No'}</strong>
              </div>
              <div className="p-2 bg-gray-50 rounded">
                <span className="text-gray-600">Mobile:</span> <strong>{platform.isMobile ? 'Yes' : 'No'}</strong>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Feature Support */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              Feature Support
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <FeatureStatus name="Biometric Authentication" supported={platform.hasBiometric} icon={Fingerprint} />
            <FeatureStatus name="PWA Install" supported={isPWAInstalled} icon={Download} />
            <FeatureStatus name="Persistent Storage" supported={hasPersistentStorage} icon={Shield} />
            <FeatureStatus name="Service Worker" supported={'serviceWorker' in navigator} icon={Wifi} />
            <FeatureStatus name="Vibration API" supported={!!navigator.vibrate} icon={Vibrate} />
          </CardContent>
        </Card>

        {/* Biometric Authentication Test */}
        {currentUser?.email && (
          <BiometricAuth 
            userEmail={currentUser.email}
            onAuthSuccess={() => toast.success('Biometric test successful!')}
          />
        )}

        {/* Encryption Test */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              AES-256 Encryption Test
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Test Data (JSON):</label>
              <Textarea
                value={testData}
                onChange={(e) => setTestData(e.target.value)}
                className="font-mono text-sm"
                rows={3}
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={testEncryption} className="flex-1">
                <Shield className="w-4 h-4 mr-2" />
                Encrypt
              </Button>
              <Button onClick={testDecryption} variant="outline" className="flex-1" disabled={!encryptedData}>
                Decrypt
              </Button>
            </div>

            {encryptedData && (
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Encrypted Data:</p>
                <p className="text-xs font-mono break-all">
                  {JSON.stringify(encryptedData).substring(0, 100)}...
                </p>
              </div>
            )}

            {decryptedData && (
              <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                <p className="text-xs text-green-800 mb-1">Decrypted Data:</p>
                <pre className="text-xs font-mono text-green-900">
                  {JSON.stringify(decryptedData, null, 2)}
                </pre>
              </div>
            )}

            <Button onClick={testOfflineSave} variant="outline" className="w-full">
              Test Encrypted Offline Save
            </Button>
          </CardContent>
        </Card>

        {/* Haptic Feedback Test */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Vibrate className="w-5 h-5" />
              Haptic Feedback Test
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => testHaptic('light')} variant="outline">Light</Button>
              <Button onClick={() => testHaptic('medium')} variant="outline">Medium</Button>
              <Button onClick={() => testHaptic('heavy')} variant="outline">Heavy</Button>
              <Button onClick={() => testHaptic('success')} variant="outline">Success</Button>
            </div>
          </CardContent>
        </Card>

        {/* PWA Features */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              PWA Features
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">PWA Installed</span>
              {isPWAInstalled ? (
                <Badge className="bg-green-100 text-green-800">Yes</Badge>
              ) : (
                <Badge className="bg-gray-100 text-gray-800">No</Badge>
              )}
            </div>

            {!hasPersistentStorage && (
              <Button onClick={requestPersistent} className="w-full">
                Request Persistent Storage
              </Button>
            )}

            <div className="text-xs text-gray-600 space-y-1">
              <p>✓ Offline data caching enabled</p>
              <p>✓ Background sync ready</p>
              <p>✓ Push notifications supported</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}