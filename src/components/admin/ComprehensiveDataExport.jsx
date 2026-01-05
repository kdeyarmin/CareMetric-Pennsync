import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Download, FileText, Calendar } from "lucide-react";
import { format } from "date-fns";

export default function ComprehensiveDataExport({ data }) {
  const [selectedData, setSelectedData] = useState({
    users: true,
    subscriptions: true,
    payments: true,
    patients: true,
    visits: true,
    noteConversions: true,
    complianceAudits: true,
    incidents: true,
    tasks: true,
    activity: true
  });

  const exportTypes = [
    { key: 'users', label: 'Users', description: 'All user accounts and profiles' },
    { key: 'subscriptions', label: 'Subscriptions', description: 'All subscription records' },
    { key: 'payments', label: 'Payments', description: 'Payment history and transactions' },
    { key: 'patients', label: 'Patients', description: 'Patient records and demographics' },
    { key: 'visits', label: 'Visits', description: 'Visit records and documentation' },
    { key: 'noteConversions', label: 'Note Enhancements', description: 'AI note conversion history' },
    { key: 'complianceAudits', label: 'Compliance Audits', description: 'Compliance audit results' },
    { key: 'incidents', label: 'Incidents', description: 'Incident reports' },
    { key: 'tasks', label: 'Tasks', description: 'Task management records' },
    { key: 'activity', label: 'Activity Logs', description: 'User activity history' }
  ];

  const handleExport = (format = 'json') => {
    const exportData = {};
    
    Object.keys(selectedData).forEach(key => {
      if (selectedData[key] && data[key]) {
        exportData[key] = data[key];
      }
    });

    const exportPackage = {
      exportDate: new Date().toISOString(),
      appName: 'CareMetric AI',
      version: '1.0',
      dataTypes: Object.keys(exportData),
      recordCounts: Object.entries(exportData).reduce((acc, [key, value]) => {
        acc[key] = Array.isArray(value) ? value.length : 1;
        return acc;
      }, {}),
      data: exportData
    };

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(exportPackage, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `caremetric-export-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else if (format === 'csv') {
      // Export each data type as separate CSV
      Object.entries(exportData).forEach(([key, records]) => {
        if (!Array.isArray(records) || records.length === 0) return;
        
        const headers = Object.keys(records[0]).join(',');
        const rows = records.map(record => 
          Object.values(record).map(val => 
            typeof val === 'object' ? JSON.stringify(val) : val
          ).join(',')
        );
        
        const csv = [headers, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${key}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
    }
  };

  const toggleAll = (checked) => {
    const newSelection = {};
    Object.keys(selectedData).forEach(key => {
      newSelection[key] = checked;
    });
    setSelectedData(newSelection);
  };

  const selectedCount = Object.values(selectedData).filter(Boolean).length;
  const totalRecords = Object.keys(selectedData)
    .filter(key => selectedData[key])
    .reduce((sum, key) => sum + (Array.isArray(data[key]) ? data[key].length : 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          Comprehensive Data Export
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg border border-blue-200">
          <div>
            <p className="font-semibold text-blue-900">Export Summary</p>
            <p className="text-sm text-blue-700">
              {selectedCount} data types selected • {totalRecords.toLocaleString()} total records
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => toggleAll(!selectedData.users)}
          >
            {selectedCount === Object.keys(selectedData).length ? 'Deselect All' : 'Select All'}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {exportTypes.map(({ key, label, description }) => (
            <div key={key} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border hover:bg-gray-100 transition-colors">
              <Checkbox
                id={key}
                checked={selectedData[key]}
                onCheckedChange={(checked) => setSelectedData({
                  ...selectedData,
                  [key]: checked
                })}
                className="mt-1"
              />
              <div className="flex-1">
                <Label htmlFor={key} className="font-medium cursor-pointer">
                  {label}
                </Label>
                <p className="text-xs text-gray-600">{description}</p>
                <p className="text-xs text-blue-600 mt-1">
                  {Array.isArray(data[key]) ? data[key].length.toLocaleString() : 0} records
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => handleExport('json')}
            disabled={selectedCount === 0}
            className="gap-2"
          >
            <Download className="w-4 h-4" />
            Export as JSON
          </Button>
          <Button
            onClick={() => handleExport('csv')}
            disabled={selectedCount === 0}
            variant="outline"
            className="gap-2"
          >
            <Calendar className="w-4 h-4" />
            Export as CSV (Multiple Files)
          </Button>
        </div>

        <div className="text-xs text-gray-500 space-y-1">
          <p>• JSON exports all selected data in a single file with metadata</p>
          <p>• CSV exports create separate files for each data type</p>
          <p>• All exports include timestamps and record counts</p>
          <p>• Data is exported in its raw format for maximum compatibility</p>
        </div>
      </CardContent>
    </Card>
  );
}