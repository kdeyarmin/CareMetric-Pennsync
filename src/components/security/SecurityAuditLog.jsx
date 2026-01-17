import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Shield, Eye, RefreshCw, Lock, Unlock, AlertTriangle } from 'lucide-react';
import { secureOfflineStorage } from '../mobile/SecureOfflineStorage';
import { toast } from 'sonner';

export default function SecurityAuditLog({ userEmail }) {
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadAuditLog = async () => {
    setLoading(true);
    try {
      const logs = await secureOfflineStorage.getAuditLog(userEmail, 50);
      setAuditLog(logs);
    } catch (error) {
      toast.error('Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userEmail) {
      loadAuditLog();
    }
  }, [userEmail]);

  const rotateKey = async () => {
    try {
      await secureOfflineStorage.rotateEncryptionKey(userEmail);
      toast.success('Encryption key rotated successfully');
      loadAuditLog();
    } catch (error) {
      toast.error('Failed to rotate encryption key');
    }
  };

  const getActionIcon = (action) => {
    switch (action) {
      case 'KEY_CREATED':
      case 'KEY_ROTATED':
        return <Lock className="w-4 h-4 text-green-600" />;
      case 'KEY_RETRIEVED':
        return <Unlock className="w-4 h-4 text-blue-600" />;
      case 'DATA_ENCRYPTED':
      case 'NOTE_SAVED_ENCRYPTED':
        return <Shield className="w-4 h-4 text-green-600" />;
      case 'DATA_DECRYPTED':
      case 'NOTE_ACCESSED':
        return <Eye className="w-4 h-4 text-blue-600" />;
      case 'INTEGRITY_VIOLATION':
      case 'KEYS_CLEARED':
        return <AlertTriangle className="w-4 h-4 text-red-600" />;
      default:
        return <Shield className="w-4 h-4 text-gray-600" />;
    }
  };

  const getActionBadge = (action) => {
    if (action.includes('VIOLATION')) {
      return <Badge className="bg-red-100 text-red-800">{action}</Badge>;
    }
    if (action.includes('CREATED') || action.includes('ROTATED')) {
      return <Badge className="bg-green-100 text-green-800">{action}</Badge>;
    }
    if (action.includes('ENCRYPTED') || action.includes('SAVED')) {
      return <Badge className="bg-blue-100 text-blue-800">{action}</Badge>;
    }
    return <Badge variant="outline">{action}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            Security Audit Log
          </span>
          <div className="flex gap-2">
            <Button onClick={rotateKey} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Rotate Key
            </Button>
            <Button onClick={loadAuditLog} variant="outline" size="sm" disabled={loading}>
              Refresh
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {auditLog.length === 0 ? (
            <p className="text-sm text-gray-600 text-center py-4">No security events logged yet</p>
          ) : (
            auditLog.map((event, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg text-sm">
                {getActionIcon(event.action)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {getActionBadge(event.action)}
                    <span className="text-xs text-gray-500">
                      {new Date(event.timestamp).toLocaleString()}
                    </span>
                  </div>
                  {event.details && Object.keys(event.details).length > 0 && (
                    <pre className="text-xs text-gray-600 mt-1 overflow-x-auto">
                      {JSON.stringify(event.details, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <p className="font-medium text-blue-900 mb-1">🔐 Security Features Active:</p>
          <ul className="text-blue-800 space-y-1 text-xs">
            <li>✓ AES-256-GCM encryption with 128-bit authentication tags</li>
            <li>✓ PBKDF2 key derivation (100,000 iterations)</li>
            <li>✓ SHA-256 integrity verification</li>
            <li>✓ Secure key storage in IndexedDB</li>
            <li>✓ Session-based key management</li>
            <li>✓ Full audit trail of security events</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}