import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, X, Smartphone } from 'lucide-react';
import { isPWA } from './PlatformOptimizations';

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Don't show if already installed as PWA
    if (isPWA()) return;

    // Check if user dismissed this before
    const dismissed = localStorage.getItem('pwa_prompt_dismissed');
    if (dismissed) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('PWA installed');
    }
    
    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('pwa_prompt_dismissed', 'true');
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[9998] lg:left-auto lg:right-4 lg:w-96">
      <Card className="border-2 border-blue-300 shadow-2xl">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 rounded-full">
              <Smartphone className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Install CareMetric AI</h3>
              <p className="text-sm text-gray-600 mb-3">
                Install our app for faster access, offline capabilities, and a native experience.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={handleInstall}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Install
                </Button>
                <Button
                  onClick={handleDismiss}
                  size="sm"
                  variant="outline"
                >
                  <X className="w-4 h-4 mr-2" />
                  Not Now
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}