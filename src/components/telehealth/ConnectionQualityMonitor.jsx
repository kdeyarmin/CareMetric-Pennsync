import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wifi, WifiOff, AlertTriangle, Settings } from "lucide-react";
import { toast } from "sonner";

export default function ConnectionQualityMonitor({ roomName, room, onQualityChange }) {
  const [quality, setQuality] = useState('good');
  const [metrics, setMetrics] = useState({
    latency: 0,
    jitter: 0,
    packetLoss: 0,
    bandwidth: 0
  });
  const [videoQualityMode, setVideoQualityMode] = useState('auto'); // auto, high, medium, low

  useEffect(() => {
    if (!room) return;

    // Monitor actual Twilio room stats
    const interval = setInterval(async () => {
      try {
        const stats = await room.getStats();
        
        stats.forEach(report => {
          if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
            const latency = report.roundTripTime ? Math.round(report.roundTripTime * 1000) : 0;
            const jitter = report.jitter ? Math.round(report.jitter * 1000) : 0;
            const packetLoss = report.packetsLost && report.packetsReceived 
              ? parseFloat(((report.packetsLost / (report.packetsLost + report.packetsReceived)) * 100).toFixed(2))
              : 0;
            
            setMetrics(prev => ({
              ...prev,
              latency,
              jitter,
              packetLoss,
              bandwidth: Math.round((report.bytesReceived || 0) / 1024)
            }));

            // Determine quality
            let newQuality = 'good';
            if (latency > 150 || packetLoss > 3) {
              newQuality = 'poor';
            } else if (latency > 100 || packetLoss > 1.5) {
              newQuality = 'fair';
            }

            // Auto-adjust video quality if in auto mode
            if (videoQualityMode === 'auto' && newQuality !== quality) {
              adjustVideoQuality(newQuality);
            }

            setQuality(newQuality);
            if (onQualityChange) onQualityChange(newQuality);
          }
        });
      } catch (error) {
        console.error('Error getting room stats:', error);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [room, videoQualityMode, quality]);

  const adjustVideoQuality = async (qualityLevel) => {
    if (!room) return;

    const qualitySettings = {
      poor: { width: 320, height: 240, frameRate: 15, bitrate: 150000 },
      fair: { width: 640, height: 480, frameRate: 20, bitrate: 500000 },
      good: { width: 1280, height: 720, frameRate: 30, bitrate: 2500000 }
    };

    const settings = qualitySettings[qualityLevel];

    try {
      room.localParticipant.videoTracks.forEach(publication => {
        if (publication.track) {
          publication.track.mediaStreamTrack.applyConstraints({
            width: { ideal: settings.width },
            height: { ideal: settings.height },
            frameRate: { ideal: settings.frameRate }
          });
        }
      });

      toast.success(`Video quality adjusted to ${qualityLevel} based on network conditions`);
    } catch (error) {
      console.error('Error adjusting video quality:', error);
    }
  };

  const manualQualityAdjust = async (mode) => {
    setVideoQualityMode(mode);
    
    if (mode !== 'auto') {
      const qualityMap = { high: 'good', medium: 'fair', low: 'poor' };
      await adjustVideoQuality(qualityMap[mode]);
      toast.info(`Video quality set to ${mode}`);
    } else {
      toast.info('Auto quality adjustment enabled');
    }
  };

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
          <Badge variant="outline" className="text-xs">
            {videoQualityMode === 'auto' ? 'Auto' : videoQualityMode.toUpperCase()}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs mb-2">
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
            <span className="ml-1 font-medium">{metrics.bandwidth}KB/s</span>
          </div>
        </div>
        
        {quality === 'poor' && (
          <p className="text-xs text-red-700 mb-2">
            Poor connection detected. Video quality automatically adjusted.
          </p>
        )}
        
        <div className="flex gap-1">
          <Button 
            size="sm" 
            variant={videoQualityMode === 'auto' ? 'default' : 'outline'}
            onClick={() => manualQualityAdjust('auto')}
            className="text-xs flex-1"
          >
            Auto
          </Button>
          <Button 
            size="sm" 
            variant={videoQualityMode === 'high' ? 'default' : 'outline'}
            onClick={() => manualQualityAdjust('high')}
            className="text-xs flex-1"
          >
            High
          </Button>
          <Button 
            size="sm" 
            variant={videoQualityMode === 'medium' ? 'default' : 'outline'}
            onClick={() => manualQualityAdjust('medium')}
            className="text-xs flex-1"
          >
            Med
          </Button>
          <Button 
            size="sm" 
            variant={videoQualityMode === 'low' ? 'default' : 'outline'}
            onClick={() => manualQualityAdjust('low')}
            className="text-xs flex-1"
          >
            Low
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}