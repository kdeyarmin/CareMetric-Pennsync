import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Download, 
  Loader2, 
  CheckCircle2, 
  Database,
  Calendar,
  Settings
} from "lucide-react";
import offlineStorage from "./OfflineStorage";

export default function OfflineCacheSettings() {
  const [selectedModules, setSelectedModules] = useState({
    patients: true,
    visits: true,
    carePlans: false,
    incidents: false,
    tasks: false
  });
  const [freshnessDays, setFreshnessDays] = useState(7);
  const [isCaching, setIsCaching] = useState(false);
  const [cacheResult, setCacheResult] = useState(null);

  const modules = [
    { id: 'patients', label: 'Patients', description: 'Patient demographics and medical info' },
    { id: 'visits', label: 'Recent Visits', description: 'Visit notes and vital signs' },
    { id: 'carePlans', label: 'Care Plans', description: 'Active care plans and goals' },
    { id: 'incidents', label: 'Incidents', description: 'Recent incident reports' },
    { id: 'tasks', label: 'Tasks', description: 'Pending tasks and to-dos' }
  ];

  const freshnessOptions = [
    { days: 3, label: '3 days', storage: '~500 KB' },
    { days: 7, label: '7 days', storage: '~1 MB' },
    { days: 14, label: '14 days', storage: '~2 MB' },
    { days: 30, label: '30 days', storage: '~4 MB' },
    { days: 90, label: '90 days', storage: '~10 MB' }
  ];

  const toggleModule = (moduleId) => {
    setSelectedModules(prev => ({ ...prev, [moduleId]: !prev[moduleId] }));
  };

  const handleCacheData = async () => {
    setIsCaching(true);
    setCacheResult(null);

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - freshnessDays);
      const _cutoffISO = cutoffDate.toISOString();

      const cachedCount = {
        patients: 0,
        visits: 0,
        carePlans: 0,
        incidents: 0,
        tasks: 0
      };

      // Cache Patients
      if (selectedModules.patients) {
        const patients = await base44.entities.Patient.list('-updated_date', 100);
        const recentPatients = patients.filter(p => 
          new Date(p.updated_date || p.created_date) >= cutoffDate
        );
        offlineStorage.cacheData('patients', recentPatients);
        cachedCount.patients = recentPatients.length;
      }

      // Cache Visits
      if (selectedModules.visits) {
        const visits = await base44.entities.Visit.list('-visit_date', 100);
        const recentVisits = visits.filter(v => 
          new Date(v.visit_date) >= cutoffDate
        );
        offlineStorage.cacheData('visits', recentVisits);
        cachedCount.visits = recentVisits.length;
      }

      // Cache Care Plans
      if (selectedModules.carePlans) {
        const carePlans = await base44.entities.CarePlan.filter({ status: 'active' });
        const recentPlans = carePlans.filter(cp => 
          new Date(cp.updated_date || cp.created_date) >= cutoffDate
        );
        offlineStorage.cacheData('carePlans', recentPlans);
        cachedCount.carePlans = recentPlans.length;
      }

      // Cache Incidents
      if (selectedModules.incidents) {
        const incidents = await base44.entities.Incident.list('-incident_date', 50);
        const recentIncidents = incidents.filter(i => 
          new Date(i.incident_date) >= cutoffDate
        );
        offlineStorage.cacheData('incidents', recentIncidents);
        cachedCount.incidents = recentIncidents.length;
      }

      // Cache Tasks
      if (selectedModules.tasks) {
        const tasks = await base44.entities.Task.filter({ status: 'pending' });
        const recentTasks = tasks.filter(t => 
          new Date(t.created_date) >= cutoffDate
        );
        offlineStorage.cacheData('tasks', recentTasks);
        cachedCount.tasks = recentTasks.length;
      }

      const totalItems = Object.values(cachedCount).reduce((a, b) => a + b, 0);
      const storageSize = new Blob([JSON.stringify(cachedCount)]).size;

      setCacheResult({
        success: true,
        counts: cachedCount,
        totalItems,
        storageSize,
        freshnessDays
      });

    } catch (error) {
      console.error('Caching error:', error);
      setCacheResult({ success: false, error: error.message });
    }

    setIsCaching(false);
  };

  const selectedCount = Object.values(selectedModules).filter(Boolean).length;

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings className="w-5 h-5 text-blue-600" />
          Cache Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {cacheResult && (
          <Alert className={cacheResult.success ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}>
            <CheckCircle2 className="w-4 h-4" />
            <AlertDescription className="text-sm">
              {cacheResult.success ? (
                <div className="space-y-1">
                  <p className="font-semibold">✅ Successfully cached {cacheResult.totalItems} items</p>
                  <div className="text-xs space-y-0.5">
                    {cacheResult.counts.patients > 0 && <p>• {cacheResult.counts.patients} patients</p>}
                    {cacheResult.counts.visits > 0 && <p>• {cacheResult.counts.visits} visits</p>}
                    {cacheResult.counts.carePlans > 0 && <p>• {cacheResult.counts.carePlans} care plans</p>}
                    {cacheResult.counts.incidents > 0 && <p>• {cacheResult.counts.incidents} incidents</p>}
                    {cacheResult.counts.tasks > 0 && <p>• {cacheResult.counts.tasks} tasks</p>}
                  </div>
                  <p className="text-xs mt-1">Data from last {cacheResult.freshnessDays} days</p>
                </div>
              ) : (
                `❌ Cache failed: ${cacheResult.error}`
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Module Selection */}
        <div className="space-y-3">
          <Label className="font-semibold flex items-center gap-2">
            <Database className="w-4 h-4" />
            Select Data Modules ({selectedCount}/5)
          </Label>
          <div className="space-y-2">
            {modules.map((module) => (
              <div
                key={module.id}
                className="flex items-start gap-3 p-3 bg-white rounded-lg border hover:bg-blue-50 cursor-pointer"
                onClick={() => toggleModule(module.id)}
              >
                <Checkbox
                  checked={selectedModules[module.id]}
                  onCheckedChange={() => toggleModule(module.id)}
                />
                <div className="flex-1">
                  <p className="font-medium text-sm">{module.label}</p>
                  <p className="text-xs text-slate-600">{module.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Freshness Threshold */}
        <div className="space-y-3">
          <Label className="font-semibold flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Data Freshness
          </Label>
          <p className="text-xs text-slate-600">
            Only cache data updated/created within the selected timeframe
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {freshnessOptions.map((option) => (
              <Button
                key={option.days}
                variant={freshnessDays === option.days ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFreshnessDays(option.days)}
                className="flex-col h-auto py-2"
              >
                <span className="font-semibold">{option.label}</span>
                <span className="text-xs opacity-70">{option.storage}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* Cache Summary */}
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm font-medium text-blue-900 mb-2">Cache Summary</p>
          <div className="space-y-1 text-xs text-blue-800">
            <p>• {selectedCount} modules selected</p>
            <p>• Data from last {freshnessDays} days</p>
            <p>• Estimated size: {freshnessOptions.find(o => o.days === freshnessDays)?.storage}</p>
          </div>
        </div>

        {/* Cache Button */}
        <Button
          onClick={handleCacheData}
          disabled={selectedCount === 0 || isCaching}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {isCaching ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Caching Data...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Cache Selected Data
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}