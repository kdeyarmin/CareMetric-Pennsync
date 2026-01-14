import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, AlertTriangle } from "lucide-react";

export default function ConnectionQualityMonitor({ roomName }) {
  const [quality, setQuality] = useState('good');
  const [metrics, setMetrics] = useState({
    latency: 0,
    jitter: 0,
    packetLoss: 0,
    bandwidth: 0
  });

  useEffect(() => {
    // Simulate connection monitoring (in production, integrate with Twilio stats)
    const interval = setInterval(() => {
      const mockLatency = Math.random() * 200;
      const mockPacketLoss = Math.random() * 5;
      
      setMetrics({
        latency: Math.round(mockLatency),
        jitter: Math.round(Math.random() * 30),
        packetLoss: parseFloat(mockPacketLoss.toFixed(2)),
        bandwidth: Math.round(Math.random() * 2000 + 1000)
      });

      // Determine quality
      if (mockLatency > 150 || mockPacketLoss > 3) {
        setQuality('poor');
      } else if (mockLatency > 100 || mockPacketLoss > 1.5) {
        setQuality('fair');
      } else {
        setQuality('good');
      }
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const getQualityConfig = () => {
    switch (quality) {
      case 'poor':
        return {
          icon: <WifiOff className="w-4 h-4" />,
          color: 'bg-red-100 text-red-800 border-red-300',
          label: 'Poor Connection'
        };
      case 'fair':
        return {
          icon: <AlertTriangle className="w-4 h-4" />,
          color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
          label: 'Fair Connection'
        };
      default:
        return {
          icon: <Wifi className="w-4 h-4" />,
          color: 'bg-green-100 text-green-800 border-green-300',
          label: 'Good Connection'
        };
    }
  };

  const config = getQualityConfig();

  return (
    <Card className={`border-2 ${config.color}`}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <Badge variant="outline" className="flex items-center gap-1">
            {config.icon}
            {config.label}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-gray-600">Latency:</span>
            <span className="ml-1 font-medium">{metrics.latency}ms</span>
          </div>
          <div>
            <span className="text-gray-600">Jitter:</span>
            <span className="ml-1 font-medium">{metrics.jitter}ms</span>
          </div>
          <div>
            <span className="text-gray-600">Packet Loss:</span>
            <span className="ml-1 font-medium">{metrics.packetLoss}%</span>
          </div>
          <div>
            <span className="text-gray-600">Bandwidth:</span>
            <span className="ml-1 font-medium">{metrics.bandwidth}kbps</span>
          </div>
        </div>
        {quality === 'poor' && (
          <p className="text-xs text-red-700 mt-2">
            Poor connection may affect call quality. Consider switching to audio only.
          </p>
        )}
      </CardContent>
    </Card>
  );
}