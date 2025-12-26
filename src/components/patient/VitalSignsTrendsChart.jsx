import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { format, parseISO } from "date-fns";

export default function VitalSignsTrendsChart({ visits, patient }) {
  const [selectedVital, setSelectedVital] = useState('blood_pressure');

  // Extract vital signs data from visits
  const vitalSignsData = visits
    .filter(v => v.vital_signs && v.status === 'completed' && v.visit_date)
    .map(v => ({
      date: v.visit_date,
      displayDate: format(parseISO(v.visit_date), 'MMM d'),
      bp_systolic: v.vital_signs.blood_pressure_systolic,
      bp_diastolic: v.vital_signs.blood_pressure_diastolic,
      heart_rate: v.vital_signs.heart_rate,
      temperature: v.vital_signs.temperature,
      oxygen_saturation: v.vital_signs.oxygen_saturation,
      respiratory_rate: v.vital_signs.respiratory_rate,
      weight: v.vital_signs.weight,
      pain_level: v.vital_signs.pain_level
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-10); // Last 10 readings

  const getTrend = (data, key) => {
    if (data.length < 2) return 'stable';
    const recent = data.slice(-3).filter(d => d[key] != null).map(d => d[key]);
    if (recent.length < 2) return 'stable';
    
    const avg1 = recent[0];
    const avg2 = recent[recent.length - 1];
    const change = ((avg2 - avg1) / avg1) * 100;
    
    if (change > 5) return 'up';
    if (change < -5) return 'down';
    return 'stable';
  };

  const getLatestValue = (key) => {
    for (let i = vitalSignsData.length - 1; i >= 0; i--) {
      if (vitalSignsData[i][key] != null) {
        return vitalSignsData[i][key];
      }
    }
    return null;
  };

  const vitalCategories = [
    {
      key: 'blood_pressure',
      label: 'Blood Pressure',
      unit: 'mmHg',
      lines: [
        { dataKey: 'bp_systolic', name: 'Systolic', color: '#ef4444' },
        { dataKey: 'bp_diastolic', name: 'Diastolic', color: '#3b82f6' }
      ],
      normalRange: 'Systolic: 90-120, Diastolic: 60-80'
    },
    {
      key: 'heart_rate',
      label: 'Heart Rate',
      unit: 'bpm',
      lines: [{ dataKey: 'heart_rate', name: 'Heart Rate', color: '#ef4444' }],
      normalRange: '60-100 bpm'
    },
    {
      key: 'temperature',
      label: 'Temperature',
      unit: '°F',
      lines: [{ dataKey: 'temperature', name: 'Temperature', color: '#f59e0b' }],
      normalRange: '97.8-99.1°F'
    },
    {
      key: 'oxygen_saturation',
      label: 'Oxygen Saturation',
      unit: '%',
      lines: [{ dataKey: 'oxygen_saturation', name: 'SpO2', color: '#3b82f6' }],
      normalRange: '95-100%'
    },
    {
      key: 'respiratory_rate',
      label: 'Respiratory Rate',
      unit: '/min',
      lines: [{ dataKey: 'respiratory_rate', name: 'RR', color: '#8b5cf6' }],
      normalRange: '12-20/min'
    }
  ];

  const getTrendIcon = (trend) => {
    if (trend === 'up') return <TrendingUp className="w-4 h-4 text-red-600" />;
    if (trend === 'down') return <TrendingDown className="w-4 h-4 text-blue-600" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  if (vitalSignsData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600" />
            Vital Signs Trends
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-12 text-gray-500">
          <Activity className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p>No vital signs data available yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-600" />
          Vital Signs Trends
          <Badge variant="outline">{vitalSignsData.length} readings</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={selectedVital} onValueChange={setSelectedVital}>
          <TabsList className="grid w-full grid-cols-5 mb-4">
            {vitalCategories.map(cat => (
              <TabsTrigger key={cat.key} value={cat.key} className="text-xs">
                {cat.label.split(' ')[0]}
              </TabsTrigger>
            ))}
          </TabsList>

          {vitalCategories.map(category => (
            <TabsContent key={category.key} value={category.key}>
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-900">{category.label}</h3>
                  <div className="flex items-center gap-2">
                    {getTrendIcon(getTrend(vitalSignsData, category.lines[0].dataKey))}
                    <span className="text-sm text-gray-600">
                      Latest: {getLatestValue(category.lines[0].dataKey) || 'N/A'} {category.unit}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-500">Normal range: {category.normalRange}</p>
              </div>

              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={vitalSignsData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="displayDate" 
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  {category.lines.map(line => (
                    <Line
                      key={line.dataKey}
                      type="monotone"
                      dataKey={line.dataKey}
                      stroke={line.color}
                      name={line.name}
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}