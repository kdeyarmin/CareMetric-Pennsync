import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { CHART_COLORS } from "@/constants/chartColors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart3,
  Download,
  TrendingUp,
  DollarSign,
  Users,
  Activity,
  FileText,
  Target,
  Award,
  Loader2,
  LineChart
} from "lucide-react";
import { BarChart, Bar, LineChart as RechartsLineChart, Line, PieChart as RechartsPieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format, subDays, differenceInDays } from "date-fns";
import { formatEastern, todayEastern } from "@/components/utils/timezone";
import { useQuery } from "@tanstack/react-query";
import { escapeCsvField } from "@/components/admin/csvExport";
import { toast } from 'sonner';

export default function ReportsCenter({ users: allUsers, patients: allPatients, visits, incidents }) {
  const [reportType, setReportType] = useState("productivity");
  const [dateRange, setDateRange] = useState("30");
  const [_selectedNurse, _setSelectedNurse] = useState("all");
  const [isGenerating, setIsGenerating] = useState(false);
  const [exportFormat, setExportFormat] = useState("pdf");
  const [reportPreview, setReportPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const generatePreview = () => {
    const endDate = todayEastern();
    const startDate = format(subDays(new Date(), parseInt(dateRange, 10)), 'yyyy-MM-dd');

    const filteredVisits = visits.filter(v => 
      v.visit_date >= startDate && v.visit_date <= endDate
    );
    
    const filteredIncidents = incidents.filter(i =>
      i.incident_date >= startDate && i.incident_date <= endDate
    );

    let previewData = null;

    switch (reportType) {
      case 'outcomes_by_diagnosis':
        previewData = generateOutcomesByDiagnosisData(filteredVisits, filteredIncidents, allPatients);
        break;
      case 'staff_comparison':
        previewData = generateStaffComparisonData(filteredVisits, allUsers);
        break;
      case 'financial_detailed':
        previewData = generateDetailedFinancialData(filteredVisits, allPatients);
        break;
      case 'trend_analysis':
        previewData = generateTrendAnalysisData(visits, incidents, allPatients);
        break;
      default:
        break;
    }

    setReportPreview(previewData);
    setShowPreview(true);
  };

  const generateReport = async () => {
    setIsGenerating(true);
    
    try {
      const endDate = todayEastern();
      const startDate = format(subDays(new Date(), parseInt(dateRange, 10)), 'yyyy-MM-dd');

      if (exportFormat === 'pdf') {
        // Generate PDF using utility
        const { exportToPDF } = await import('@/components/utils/pdfExporter');
        
        const filteredVisits = visits.filter(v => 
          v.visit_date >= startDate && v.visit_date <= endDate
        );
        
        const filteredIncidents = incidents.filter(i =>
          i.incident_date >= startDate && i.incident_date <= endDate
        );

        let pdfContent = [];
        let reportTitle = '';

        switch (reportType) {
          case 'productivity':
            reportTitle = 'Productivity Report';
            const prodData = generateProductivityReportData(filteredVisits, allUsers);
            pdfContent = [
              { type: 'heading', text: 'Nurse Productivity Summary', size: 14 },
              { type: 'spacer', height: 5 },
              {
                type: 'table',
                headers: ['Nurse', 'Enhancements', 'Time Saved (hrs)'],
                rows: prodData.nurses.map(d => [d.name, d.noteEnhancements, d.timeSavedHours])
              },
              { type: 'spacer', height: 10 },
              { type: 'heading', text: 'Total Agency Productivity', size: 14 },
              { type: 'spacer', height: 5 },
              {
                type: 'table',
                headers: ['Metric', 'Value'],
                rows: [
                  ['Total Note Enhancements', prodData.totalEnhancements],
                  ['Total Time Saved', `${prodData.totalTimeSaved} hours`]
                ]
              },
              { type: 'pageBreak' },
              { type: 'heading', text: 'Daily Enhancement Trend', size: 14 },
              { type: 'spacer', height: 5 },
              {
                type: 'barChart',
                data: prodData.dailyEnhancements,
                xKey: 'date',
                yKey: 'count',
                height: 100
              },
              { type: 'pageBreak' },
              { type: 'heading', text: 'Visit Type Distribution', size: 14 },
              { type: 'spacer', height: 5 },
              {
                type: 'pieChart',
                data: prodData.visitTypeChart,
                nameKey: 'type',
                valueKey: 'count',
                radius: 50
              }
            ];
            break;

          case 'quality':
            reportTitle = 'Quality Metrics Report';
            const qualityData = generateQualityReportData(filteredVisits, filteredIncidents, allPatients);
            pdfContent = [
              { type: 'heading', text: 'Overall Metrics', size: 14 },
              { type: 'spacer', height: 5 },
              {
                type: 'table',
                headers: ['Metric', 'Value'],
                rows: [
                  ['Total Visits', qualityData.totalVisits],
                  ['Completed Visits', qualityData.completedVisits],
                  ['Completion Rate', `${qualityData.completionRate}%`],
                  ['Active Patients', qualityData.activePatients]
                ]
              },
              { type: 'spacer', height: 10 },
              { type: 'heading', text: 'Patient Outcomes', size: 14 },
              { type: 'spacer', height: 5 },
              {
                type: 'table',
                headers: ['Metric', 'Value'],
                rows: [
                  ['Falls', qualityData.falls],
                  ['Fall Rate (per 1000 visits)', qualityData.fallRate],
                  ['Hospitalizations', qualityData.hospitalizations],
                  ['Hospitalization Rate', `${qualityData.hospitalizationRate}%`],
                  ['Medication Errors', qualityData.medErrors]
                ]
              }
            ];
            break;

          case 'financial':
            reportTitle = 'Financial Report';
            const finData = generateDetailedFinancialData(filteredVisits, allPatients);
            pdfContent = [
              { type: 'heading', text: 'Revenue Analysis', size: 14 },
              { type: 'spacer', height: 5 },
              {
                type: 'table',
                headers: ['Visit Type', 'Count', 'Revenue/Visit', 'Total Revenue'],
                rows: finData.visitTypes.map(vt => [
                  (vt.type || '').replace(/_/g, ' '),
                  vt.count,
                  `$${vt.count > 0 ? Math.round(vt.revenue / vt.count) : 0}`,
                  `$${vt.revenue}`
                ])
              },
              { type: 'spacer', height: 10 },
              { type: 'heading', text: 'Penn Sync ROI', size: 14 },
              { type: 'spacer', height: 5 },
              {
                type: 'table',
                headers: ['Metric', 'Value'],
                rows: [
                  ['Total Estimated Revenue', `$${finData.totalRevenue.toLocaleString()}`],
                  ['Cost Savings from Efficiency', `$${Math.round(finData.costSavings).toLocaleString()}`],
                  ['ROI Percentage', `${finData.roi}%`]
                ]
              }
            ];
            break;

          case 'staff_comparison':
            reportTitle = 'Staff Performance Comparison';
            const staffData = generateStaffComparisonData(filteredVisits, allUsers);
            pdfContent = [
              { type: 'heading', text: 'Staff Rankings', size: 14 },
              { type: 'spacer', height: 5 },
              {
                type: 'table',
                headers: ['Rank', 'Nurse', 'Visits', 'Completion %', 'Quality %', 'Avg/Day'],
                rows: staffData.map((d, idx) => [
                  `#${idx + 1}`,
                  d.name,
                  d.totalVisits,
                  `${d.completionRate}%`,
                  `${d.docQuality}%`,
                  d.avgVisitsPerDay
                ])
              }
            ];
            break;

          default:
            reportTitle = 'Penn Sync Report';
            pdfContent = [
              { type: 'text', text: 'Report data not available for PDF export in this format.' }
            ];
        }

        await exportToPDF({
          filename: `penn-sync-${reportType}-report-${endDate}.pdf`,
          title: reportTitle,
          subtitle: `${startDate} to ${endDate}`,
          content: pdfContent
        });
      } else {
        // Original CSV export
        const filteredVisits = visits.filter(v => 
          v.visit_date >= startDate && v.visit_date <= endDate
        );
        
        const filteredIncidents = incidents.filter(i =>
          i.incident_date >= startDate && i.incident_date <= endDate
        );

        let reportContent = '';
        let fileName = '';

        switch (reportType) {
          case 'productivity':
            ({ content: reportContent, fileName } = generateProductivityReport(filteredVisits, allUsers, startDate, endDate));
            break;
          case 'quality':
            ({ content: reportContent, fileName } = generateQualityReport(filteredVisits, filteredIncidents, allPatients, startDate, endDate));
            break;
          case 'financial':
            ({ content: reportContent, fileName } = generateFinancialReport(filteredVisits, allPatients, startDate, endDate));
            break;
          case 'compliance':
            ({ content: reportContent, fileName } = generateComplianceReport(filteredVisits, allPatients, startDate, endDate));
            break;
          case 'clinical':
            ({ content: reportContent, fileName } = generateClinicalReport(filteredVisits, allPatients, startDate, endDate));
            break;
          case 'staff':
            ({ content: reportContent, fileName } = generateStaffPerformanceReport(filteredVisits, allUsers, startDate, endDate));
            break;
          case 'outcomes_by_diagnosis':
            ({ content: reportContent, fileName } = generateOutcomesByDiagnosisCSV(filteredVisits, filteredIncidents, allPatients, startDate, endDate));
            break;
          case 'staff_comparison':
            ({ content: reportContent, fileName } = generateStaffComparisonCSV(filteredVisits, allUsers, startDate, endDate));
            break;
          case 'financial_detailed':
            ({ content: reportContent, fileName } = generateDetailedFinancialCSV(filteredVisits, allPatients, startDate, endDate));
            break;
          case 'trend_analysis':
            ({ content: reportContent, fileName } = generateTrendAnalysisCSV(filteredVisits, filteredIncidents, startDate, endDate));
            break;
          default:
            throw new Error('Unknown report type');
        }

        // Download report as CSV
        const blob = new Blob([reportContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
      }

    } catch (error) {
      console.error('Error generating report:', error);
      toast.error(`Failed to generate report: ${error.message || 'Unknown error'}. Please try again.`);
    }
    
    setIsGenerating(false);
  };

  // Fetch note enhancements for productivity reports (backend entity: NoteConversion)
  const { data: allNoteEnhancements = [] } = useQuery({
    queryKey: ['allNoteConversions'],
    queryFn: () => base44.entities.NoteConversion.list('-created_date', 1000),
    initialData: [],
  });

  // Helper functions for PDF data
  const generateProductivityReportData = (visits, allUsers) => {
    const endDate = todayEastern();
    const startDate = format(subDays(new Date(), parseInt(dateRange, 10)), 'yyyy-MM-dd');
    
    // Filter all note enhancements by date range FIRST
    const filteredEnhancements = allNoteEnhancements.filter(nc => {
      const createdDate = nc.created_date ? nc.created_date.split('T')[0] : null;
      return createdDate && createdDate >= startDate && createdDate <= endDate;
    });
    
    const nursesData = allUsers.filter(u => u.role === 'user').map(nurse => {
      // Filter note enhancements for this specific nurse
      const nurseEnhancements = filteredEnhancements.filter(nc => nc.nurse_email === nurse.email);
      
      const noteEnhancements = nurseEnhancements.length;
      const timeSavedMinutes = noteEnhancements * 20; // 20 minutes saved per note enhancement
      const timeSavedHours = parseFloat((timeSavedMinutes / 60).toFixed(1));
      
      return {
        name: nurse.full_name || nurse.email,
        noteEnhancements,
        timeSavedHours,
        dailyData: [] // Will populate for chart
      };
    }).sort((a, b) => (b.noteEnhancements || 0) - (a.noteEnhancements || 0)); // Sort by highest enhancements first

    // Calculate totals from the filtered enhancements directly
    const totalEnhancements = filteredEnhancements.length;
    const totalTimeSavedMinutes = totalEnhancements * 20;
    const totalTimeSaved = parseFloat((totalTimeSavedMinutes / 60).toFixed(1));
    
    // Generate daily enhancement data for chart
    const days = parseInt(dateRange, 10);
    const dailyEnhancements = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
      const dayEnhancements = filteredEnhancements.filter(nc => {
        const createdDate = nc.created_date ? nc.created_date.split('T')[0] : null;
        return createdDate === date;
      });
      dailyEnhancements.push({
        date: format(new Date(date), 'MM/dd'),
        count: dayEnhancements.length
      });
    }
    
    // Generate visit type distribution for chart (based on note enhancements)
    const visitTypeData = {};
    filteredEnhancements.forEach(nc => {
      const visit = visits.find(v => v.id === nc.visit_id);
      const type = visit?.visit_type || nc.visit_type || 'unknown';
      visitTypeData[type] = (visitTypeData[type] || 0) + 1;
    });
    const visitTypeChart = Object.entries(visitTypeData).map(([type, count]) => ({
      type: (type || '').replace(/_/g, ' '),
      count
    }));

    return {
      nurses: nursesData,
      totalTimeSaved,
      totalEnhancements,
      dailyEnhancements,
      visitTypeChart
    };
  };

  const generateQualityReportData = (visits, incidents, allPatients) => {
    const completedVisits = visits.filter(v => v.status === 'completed');
    const activePatients = allPatients.filter(p => p.status === 'active').length;
    const falls = incidents.filter(i => i.incident_type === 'fall').length;
    const hospitalizations = incidents.filter(i => i.incident_type === 'hospitalized').length;
    const medErrors = incidents.filter(i => i.incident_type === 'medication_error').length;
    
    return {
      totalVisits: visits.length,
      completedVisits: completedVisits.length,
      completionRate: visits.length > 0 ? Math.round((completedVisits.length / visits.length) * 100) : 0,
      activePatients,
      falls,
      fallRate: visits.length > 0 ? Math.round((falls / visits.length) * 1000) : 0,
      hospitalizations,
      hospitalizationRate: activePatients > 0 ? Math.round((hospitalizations / activePatients) * 100) : 0,
      medErrors
    };
  };

  // Productivity Report CSV
  const generateProductivityReport = (visits, allUsers, startDate, endDate) => {
    const data = generateProductivityReportData(visits, allUsers);

    let content = `Penn Sync Productivity Report\n`;
    content += `Date Range: ${startDate} to ${endDate}\n`;
    content += `Generated: ${formatEastern(new Date(), 'MMM d, yyyy hh:mm a')}\n\n`;
    content += `Nurse,Note Enhancements,Time Saved (hours)\n`;
    
    data.nurses.forEach(stats => {
      content += `${escapeCsvField(stats.name)},${stats.noteEnhancements},${stats.timeSavedHours}\n`;
    });

    content += `\nTOTAL AGENCY PRODUCTIVITY\n`;
    content += `Total Note Enhancements,${data.totalEnhancements}\n`;
    content += `Total Time Saved (hours),${data.totalTimeSaved}\n`;

    return {
      content,
      fileName: `penn-sync-productivity-report-${todayEastern()}.csv`
    };
  };

  // Quality Report CSV
  const generateQualityReport = (visits, incidents, allPatients, startDate, endDate) => {
    const data = generateQualityReportData(visits, incidents, allPatients);

    let content = `Penn Sync Quality Metrics Report\n`;
    content += `Date Range: ${startDate} to ${endDate}\n`;
    content += `Generated: ${formatEastern(new Date(), 'MMM d, yyyy hh:mm a')}\n\n`;
    content += `OVERALL METRICS\n`;
    content += `Total Visits,${data.totalVisits}\n`;
    content += `Completed Visits,${data.completedVisits}\n`;
    content += `Completion Rate,${data.completionRate}%\n`;
    content += `Active Patients,${data.activePatients}\n\n`;
    content += `PATIENT OUTCOMES\n`;
    content += `Falls,${data.falls}\n`;
    content += `Fall Rate (per 1000 visits),${data.fallRate}\n`;
    content += `Hospitalizations,${data.hospitalizations}\n`;
    content += `Hospitalization Rate (per 100 patients),${data.hospitalizationRate}\n`;
    content += `Medication Errors,${data.medErrors}\n`;

    return {
      content,
      fileName: `penn-sync-quality-report-${todayEastern()}.csv`
    };
  };

  // Financial Report
  const generateFinancialReport = (visits, allPatients, startDate, endDate) => {
    const visitTypes = {};
    visits.forEach(v => {
      const type = v.visit_type || 'unknown';
      visitTypes[type] = (visitTypes[type] || 0) + 1;
    });

    // Estimated revenue per visit type (Medicare averages)
    const revenuePerType = {
      'skilled_nursing': 180,
      'admission': 250,
      'recertification': 200,
      'discharge': 150,
      'routine_visit': 160,
      'prn': 170,
      'unknown': 160
    };

    let totalRevenue = 0;
    Object.entries(visitTypes).forEach(([type, count]) => {
      totalRevenue += count * (revenuePerType[type] || 160);
    });

    const timeSavedHours = visits.filter(v => v.status === 'completed').length * 95 / 60;
    const costSavings = timeSavedHours * 40; // Avg nurse hourly cost

    let content = `Penn Sync Financial Report\n`;
    content += `Date Range: ${startDate} to ${endDate}\n`;
    content += `Generated: ${formatEastern(new Date(), 'MMM d, yyyy hh:mm a')}\n\n`;
    content += `REVENUE ANALYSIS\n`;
    content += `Visit Type,Count,Est. Revenue Per Visit,Total Revenue\n`;
    
    Object.entries(visitTypes).forEach(([type, count]) => {
      const revenue = count * (revenuePerType[type] || 160);
      content += `${(type || '').replace(/_/g, ' ')},${count},$${revenuePerType[type] || 160},$${revenue}\n`;
    });
    
    content += `\nTOTAL ESTIMATED REVENUE,$${totalRevenue}\n\n`;
    content += `PENN SYNC ROI\n`;
    content += `Documentation Time Saved (hours),${Math.round(timeSavedHours)}\n`;
    content += `Cost Savings from Efficiency,$${Math.round(costSavings)}\n`;
    content += `Active Patients,${allPatients.filter(p => p.status === 'active').length}\n`;

    return {
      content,
      fileName: `penn-sync-financial-report-${todayEastern()}.csv`
    };
  };

  // Compliance Report
  const generateComplianceReport = (visits, allPatients, startDate, endDate) => {
    const completedVisits = visits.filter(v => v.status === 'completed');
    const visitsWithNotes = completedVisits.filter(v => v.nurse_notes && v.nurse_notes.length > 100);
    const visitsWithVitals = completedVisits.filter(v => v.vital_signs && Object.keys(v.vital_signs).length > 0);
    
    const complianceRate = completedVisits.length > 0 
      ? Math.round((visitsWithNotes.length / completedVisits.length) * 100)
      : 0;

    const visitsWithinTimeframe = completedVisits.filter(v => {
      if (!v.visit_date || !v.created_date) return false;
      const visitDate = new Date(v.visit_date);
      const docDate = new Date(v.created_date);
      return differenceInDays(docDate, visitDate) <= 7;
    });

    let content = `Penn Sync Medicare Compliance Report\n`;
    content += `Date Range: ${startDate} to ${endDate}\n`;
    content += `Generated: ${formatEastern(new Date(), 'MMM d, yyyy hh:mm a')}\n\n`;
    content += `DOCUMENTATION COMPLIANCE\n`;
    content += `Total Completed Visits,${completedVisits.length}\n`;
    content += `Visits with Complete Documentation,${visitsWithNotes.length}\n`;
    content += `Visits with Vital Signs,${visitsWithVitals.length}\n`;
    content += `Documentation Compliance Rate,${complianceRate}%\n`;
    content += `Visits Documented Within 7 Days,${visitsWithinTimeframe.length}\n`;
    content += `Timely Documentation Rate,${completedVisits.length > 0 ? Math.round((visitsWithinTimeframe.length / completedVisits.length) * 100) : 0}%\n`;

    return {
      content,
      fileName: `penn-sync-compliance-report-${todayEastern()}.csv`
    };
  };

  // Clinical Report
  const generateClinicalReport = (visits, allPatients, startDate, endDate) => {
    const diagnoses = {};
    allPatients.forEach(p => {
      if (p.primary_diagnosis) {
        diagnoses[p.primary_diagnosis] = (diagnoses[p.primary_diagnosis] || 0) + 1;
      }
    });

    // Analyze vital signs trends
    const vitalsTrends = {};
    visits.filter(v => v.vital_signs).forEach(v => {
      if (v.vital_signs.blood_pressure_systolic) {
        vitalsTrends.avgBPSystolic = (vitalsTrends.avgBPSystolic || 0) + v.vital_signs.blood_pressure_systolic;
      }
      if (v.vital_signs.heart_rate) {
        vitalsTrends.avgHeartRate = (vitalsTrends.avgHeartRate || 0) + v.vital_signs.heart_rate;
      }
    });

    const visitsWithVitals = visits.filter(v => v.vital_signs && Object.keys(v.vital_signs).length > 0).length;
    if (visitsWithVitals > 0) {
      vitalsTrends.avgBPSystolic = Math.round(vitalsTrends.avgBPSystolic / visitsWithVitals);
      vitalsTrends.avgHeartRate = Math.round(vitalsTrends.avgHeartRate / visitsWithVitals);
    }

    let content = `Penn Sync Clinical Report\n`;
    content += `Date Range: ${startDate} to ${endDate}\n`;
    content += `Generated: ${formatEastern(new Date(), 'MMM d, yyyy hh:mm a')}\n\n`;
    content += `DIAGNOSIS DISTRIBUTION\n`;
    content += `Diagnosis,Patient Count\n`;
    
    Object.entries(diagnoses)
      .sort((a, b) => b[1] - a[1])
      .forEach(([diagnosis, count]) => {
        content += `${escapeCsvField(diagnosis)},${count}\n`;
      });

    content += `\nVITAL SIGNS AVERAGES\n`;
    content += `Average Systolic BP,${vitalsTrends.avgBPSystolic || 'N/A'}\n`;
    content += `Average Heart Rate,${vitalsTrends.avgHeartRate || 'N/A'}\n`;

    return {
      content,
      fileName: `penn-sync-clinical-report-${todayEastern()}.csv`
    };
  };

  // Staff Performance Report
  const generateStaffPerformanceReport = (visits, allUsers, startDate, endDate) => {
    const nursePerformance = {};
    
    allUsers.filter(u => u.role === 'user').forEach(nurse => {
      const nurseVisits = visits.filter(v => v.created_by === nurse.email);
      const completed = nurseVisits.filter(v => v.status === 'completed');
      
      const visitsWithCompleteDoc = completed.filter(v => 
        v.nurse_notes && v.nurse_notes.length > 100 &&
        v.vital_signs && Object.keys(v.vital_signs).length > 0
      );

      nursePerformance[nurse.email] = {
        name: nurse.full_name || nurse.email,
        totalAssigned: nurseVisits.length,
        completed: completed.length,
        completionRate: nurseVisits.length > 0 ? Math.round((completed.length / nurseVisits.length) * 100) : 0,
        docQualityRate: completed.length > 0 ? Math.round((visitsWithCompleteDoc.length / completed.length) * 100) : 0,
        careScope: nurse.care_scope || 'not set',
        credentials: nurse.credentials || 'not set'
      };
    });

    let content = `Penn Sync Staff Performance Report\n`;
    content += `Date Range: ${startDate} to ${endDate}\n`;
    content += `Generated: ${formatEastern(new Date(), 'MMM d, yyyy hh:mm a')}\n\n`;
    content += `Nurse,Credentials,Care Scope,Total Assigned,Completed,Completion Rate %,Documentation Quality %\n`;
    
    Object.values(nursePerformance)
      .sort((a, b) => b.completionRate - a.completionRate)
      .forEach(perf => {
        content += `${escapeCsvField(perf.name)},${escapeCsvField(perf.credentials)},${escapeCsvField(perf.careScope)},${perf.totalAssigned},${perf.completed},${perf.completionRate},${perf.docQualityRate}\n`;
      });

    return {
      content,
      fileName: `penn-sync-staff-performance-report-${todayEastern()}.csv`
    };
  };

  const reportTypes = [
    {
      value: 'productivity',
      label: 'Productivity Report',
      icon: TrendingUp,
      description: 'Visit counts, completion rates, documentation time, Penn Sync time savings'
    },
    {
      value: 'quality',
      label: 'Quality Metrics Report',
      icon: Award,
      description: 'Patient outcomes, incident rates, quality indicators'
    },
    {
      value: 'financial',
      label: 'Financial Report',
      icon: DollarSign,
      description: 'Revenue analysis by visit type, ROI from Penn Sync efficiency'
    },
    {
      value: 'compliance',
      label: 'Medicare Compliance Report',
      icon: FileText,
      description: 'Documentation compliance, timely completion, Medicare requirements'
    },
    {
      value: 'clinical',
      label: 'Clinical Report',
      icon: Activity,
      description: 'Diagnosis trends, vital signs analysis, clinical patterns'
    },
    {
      value: 'staff',
      label: 'Staff Performance Report',
      icon: Users,
      description: 'Individual nurse performance, completion rates, quality scores'
    },
    {
      value: 'outcomes_by_diagnosis',
      label: 'Patient Outcomes by Diagnosis',
      icon: Target,
      description: 'Outcome trends, visit patterns, and incident rates by diagnosis'
    },
    {
      value: 'staff_comparison',
      label: 'Staff Performance Comparison',
      icon: Users,
      description: 'Side-by-side comparison of nurse performance metrics with rankings'
    },
    {
      value: 'financial_detailed',
      label: 'Detailed Financial Summary',
      icon: DollarSign,
      description: 'Comprehensive financial analysis with revenue trends and cost breakdowns'
    },
    {
      value: 'trend_analysis',
      label: 'Trend Analysis',
      icon: LineChart,
      description: 'Historical trends for visits, incidents, and compliance over time'
    }
  ];

  // Data generation for new report types
  const generateOutcomesByDiagnosisData = (visitsData, incidentsData, patientsData) => {
    const diagnosisData = {};
    
    patientsData.forEach(p => {
      const diagnosis = p.primary_diagnosis || 'Unknown';
      if (!diagnosisData[diagnosis]) {
        diagnosisData[diagnosis] = {
          diagnosis,
          patientCount: 0,
          visitCount: 0,
          completedVisits: 0,
          incidents: 0,
          falls: 0,
          hospitalizations: 0
        };
      }
      diagnosisData[diagnosis].patientCount++;
    });

    visitsData.forEach(v => {
      const patient = patientsData.find(p => p.id === v.patient_id);
      const diagnosis = patient?.primary_diagnosis || 'Unknown';
      if (diagnosisData[diagnosis]) {
        diagnosisData[diagnosis].visitCount++;
        if (v.status === 'completed') {
          diagnosisData[diagnosis].completedVisits++;
        }
      }
    });

    incidentsData.forEach(i => {
      const patient = patientsData.find(p => p.id === i.patient_id);
      const diagnosis = patient?.primary_diagnosis || 'Unknown';
      if (diagnosisData[diagnosis]) {
        diagnosisData[diagnosis].incidents++;
        if (i.incident_type === 'fall') diagnosisData[diagnosis].falls++;
        if (i.incident_type === 'hospitalized') diagnosisData[diagnosis].hospitalizations++;
      }
    });

    return Object.values(diagnosisData).sort((a, b) => b.visitCount - a.visitCount);
  };

  const generateStaffComparisonData = (filteredVisits, allUsers) => {
    return allUsers.filter(u => u.role === 'user').map(nurse => {
      const nurseVisits = filteredVisits.filter(v => v.created_by === nurse.email);
      const completed = nurseVisits.filter(v => v.status === 'completed');
      const withCompleteDoc = completed.filter(v => 
        v.nurse_notes && v.nurse_notes.length > 100 &&
        v.vital_signs && Object.keys(v.vital_signs).length > 0
      );

      return {
        name: nurse.full_name || nurse.email,
        totalVisits: nurseVisits.length,
        completed: completed.length,
        completionRate: nurseVisits.length > 0 ? Math.round((completed.length / nurseVisits.length) * 100) : 0,
        docQuality: completed.length > 0 ? Math.round((withCompleteDoc.length / completed.length) * 100) : 0,
        avgVisitsPerDay: Math.round(nurseVisits.length / parseInt(dateRange, 10))
      };
    }).sort((a, b) => b.completionRate - a.completionRate);
  };

  const generateDetailedFinancialData = (filteredVisits, _allPatients) => {
    const visitTypes = {};
    const revenuePerType = {
      'skilled_nursing': 180,
      'admission': 250,
      'recertification': 200,
      'discharge': 150,
      'routine_visit': 160,
      'prn': 170
    };

    filteredVisits.forEach(v => {
      const type = v.visit_type || 'unknown';
      if (!visitTypes[type]) {
        visitTypes[type] = { type, count: 0, revenue: 0 };
      }
      visitTypes[type].count++;
      visitTypes[type].revenue += revenuePerType[type] || 160;
    });

    const totalRevenue = Object.values(visitTypes).reduce((sum, vt) => sum + vt.revenue, 0);
    const timeSavedHours = filteredVisits.filter(v => v.status === 'completed').length * 95 / 60;
    const costSavings = timeSavedHours * 40;

    return {
      visitTypes: Object.values(visitTypes),
      totalRevenue,
      costSavings,
      roi: totalRevenue > 0 ? Math.round((costSavings / totalRevenue) * 100) : 0
    };
  };

  const generateTrendAnalysisData = (visitsData, incidentsData) => {
    const days = parseInt(dateRange, 10);
    const trends = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
      const dayVisits = visitsData.filter(v => v.visit_date === date);
      const dayIncidents = incidentsData.filter(inc => inc.incident_date === date);

      trends.push({
        date: format(new Date(date), 'MM/dd'),
        visits: dayVisits.length,
        completed: dayVisits.filter(v => v.status === 'completed').length,
        incidents: dayIncidents.length
      });
    }

    return trends;
  };

  // CSV generators for new report types
  const generateOutcomesByDiagnosisCSV = (visitsData, incidentsData, patientsData, startDate, endDate) => {
    const data = generateOutcomesByDiagnosisData(visitsData, incidentsData, patientsData);
    
    let content = `Patient Outcomes by Diagnosis Report\n`;
    content += `Date Range: ${startDate} to ${endDate}\n\n`;
    content += `Diagnosis,Patients,Total Visits,Completed,Incidents,Falls,Hospitalizations,Visit Completion Rate\n`;
    
    data.forEach(d => {
      const completionRate = d.visitCount > 0 ? Math.round((d.completedVisits / d.visitCount) * 100) : 0;
      content += `${escapeCsvField(d.diagnosis)},${d.patientCount},${d.visitCount},${d.completedVisits},${d.incidents},${d.falls},${d.hospitalizations},${completionRate}%\n`;
    });

    return {
      content,
      fileName: `outcomes-by-diagnosis-${todayEastern()}.csv`
    };
  };

  const generateStaffComparisonCSV = (filteredVisits, allUsers, startDate, endDate) => {
    const data = generateStaffComparisonData(filteredVisits, allUsers);
    
    let content = `Staff Performance Comparison Report\n`;
    content += `Date Range: ${startDate} to ${endDate}\n\n`;
    content += `Nurse,Total Visits,Completed,Completion Rate %,Documentation Quality %,Avg Visits/Day,Rank\n`;
    
    data.forEach((d, idx) => {
      content += `${escapeCsvField(d.name)},${d.totalVisits},${d.completed},${d.completionRate},${d.docQuality},${d.avgVisitsPerDay},${idx + 1}\n`;
    });

    return {
      content,
      fileName: `staff-comparison-${todayEastern()}.csv`
    };
  };

  const generateDetailedFinancialCSV = (filteredVisits, allPatients, startDate, endDate) => {
    const data = generateDetailedFinancialData(filteredVisits, allPatients);
    
    let content = `Detailed Financial Summary Report\n`;
    content += `Date Range: ${startDate} to ${endDate}\n\n`;
    content += `Visit Type,Count,Revenue Per Visit,Total Revenue\n`;
    
    data.visitTypes.forEach(vt => {
      const revenuePerVisit = vt.count > 0 ? Math.round(vt.revenue / vt.count) : 0;
      content += `${(vt.type || '').replace(/_/g, ' ')},${vt.count},$${revenuePerVisit},$${vt.revenue}\n`;
    });

    content += `\nTOTAL REVENUE,$${data.totalRevenue}\n`;
    content += `COST SAVINGS,$${Math.round(data.costSavings)}\n`;
    content += `ROI,${data.roi}%\n`;

    return {
      content,
      fileName: `financial-detailed-${todayEastern()}.csv`
    };
  };

  const generateTrendAnalysisCSV = (filteredVisits, filteredIncidents, startDate, endDate) => {
    // For trend analysis, we need all visits/incidents, not just filtered ones
    const data = generateTrendAnalysisData(visits, incidents);
    
    let content = `Trend Analysis Report\n`;
    content += `Date Range: ${startDate} to ${endDate}\n\n`;
    content += `Date,Total Visits,Completed Visits,Incidents\n`;
    
    data.forEach(d => {
      content += `${d.date},${d.visits},${d.completed},${d.incidents}\n`;
    });

    return {
      content,
      fileName: `trend-analysis-${todayEastern()}.csv`
    };
  };

  const COLORS = CHART_COLORS;

  const selectedReportType = reportTypes.find(r => r.value === reportType);

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-r from-blue-600 to-navy-600 text-white border-none">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold mb-2">Penn Sync Reports Center</h2>
              <p className="text-blue-100">
                Generate comprehensive reports and analytics for your agency
              </p>
            </div>
            <BarChart3 className="w-12 h-12 text-blue-200" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Report Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <div>
              <Label>Report Type</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reportTypes.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Date Range</Label>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 Days</SelectItem>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                  <SelectItem value="60">Last 60 Days</SelectItem>
                  <SelectItem value="90">Last 90 Days</SelectItem>
                  <SelectItem value="180">Last 6 Months</SelectItem>
                  <SelectItem value="365">Last Year</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mb-6">
            <Label>Export Format</Label>
            <Select value={exportFormat} onValueChange={setExportFormat}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF Document</SelectItem>
                <SelectItem value="csv">CSV Spreadsheet</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedReportType && (
            <Card className="bg-blue-50 border-blue-200 mb-6">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <selectedReportType.icon className="w-6 h-6 text-blue-600 mt-1" />
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-1">{selectedReportType.label}</h4>
                    <p className="text-sm text-slate-700">{selectedReportType.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-3">
            {['outcomes_by_diagnosis', 'staff_comparison', 'financial_detailed', 'trend_analysis'].includes(reportType) && (
              <Button
                onClick={generatePreview}
                variant="outline"
                className="flex-1"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                Preview with Charts
              </Button>
            )}
            <Button
              onClick={generateReport}
              disabled={isGenerating}
              className="bg-blue-600 hover:bg-blue-700 flex-1"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Download {exportFormat.toUpperCase()}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Report Previews */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reportTypes.map(type => (
          <Card key={type.value} className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setReportType(type.value)}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-navy-500 rounded-lg flex items-center justify-center">
                  <type.icon className="w-6 h-6 text-white" />
                </div>
                {reportType === type.value && (
                  <Badge className="bg-green-500">Selected</Badge>
                )}
              </div>
              <h3 className="font-semibold text-slate-900 mb-2">{type.label}</h3>
              <p className="text-sm text-slate-600">{type.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Report Preview with Charts */}
      {showPreview && reportPreview && (
        <Card className="border-2 border-blue-500">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Report Preview - {selectedReportType?.label}</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowPreview(false)}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {reportType === 'outcomes_by_diagnosis' && reportPreview && (
              <>
                <div>
                  <h3 className="font-semibold mb-4">Visit Distribution by Diagnosis</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={reportPreview.slice(0, 8)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="diagnosis" angle={-45} textAnchor="end" height={100} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="visitCount" fill="#3557b0" name="Total Visits" />
                      <Bar dataKey="completedVisits" fill="#10b981" name="Completed" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div>
                  <h3 className="font-semibold mb-4">Incident Rates by Diagnosis</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={reportPreview.slice(0, 8)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="diagnosis" angle={-45} textAnchor="end" height={100} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="falls" fill="#f59e0b" name="Falls" />
                      <Bar dataKey="hospitalizations" fill="#ef4444" name="Hospitalizations" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  {reportPreview.slice(0, 3).map((d, idx) => (
                    <Card key={idx} className="bg-gradient-to-br from-blue-50 to-indigo-50">
                      <CardContent className="p-4">
                        <h4 className="font-semibold text-sm mb-2">{d.diagnosis}</h4>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span>Patients:</span>
                            <span className="font-bold">{d.patientCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Visits:</span>
                            <span className="font-bold">{d.visitCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Incidents:</span>
                            <span className="font-bold text-red-600">{d.incidents}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}

            {reportType === 'staff_comparison' && reportPreview && (
              <>
                <div>
                  <h3 className="font-semibold mb-4">Staff Performance Comparison</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={reportPreview}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="completionRate" fill="#3557b0" name="Completion Rate %" />
                      <Bar dataKey="docQuality" fill="#10b981" name="Doc Quality %" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rank</TableHead>
                      <TableHead>Nurse</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                      <TableHead className="text-right">Completion %</TableHead>
                      <TableHead className="text-right">Quality %</TableHead>
                      <TableHead className="text-right">Avg/Day</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportPreview.map((d, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Badge className={idx === 0 ? 'bg-gold-400 text-navy-900' : idx === 1 ? 'bg-slate-300 text-slate-800' : idx === 2 ? 'bg-amber-500 text-white' : 'bg-navy-500 text-white'}>
                            #{idx + 1}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell className="text-right">{d.totalVisits}</TableCell>
                        <TableCell className="text-right">{d.completionRate}%</TableCell>
                        <TableCell className="text-right">{d.docQuality}%</TableCell>
                        <TableCell className="text-right">{d.avgVisitsPerDay}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}

            {reportType === 'financial_detailed' && reportPreview && (
              <>
                <div>
                  <h3 className="font-semibold mb-4">Revenue Distribution by Visit Type</h3>
                  <ResponsiveContainer width="100%" height={400}>
                    <RechartsPieChart>
                      <Pie
                        data={reportPreview.visitTypes}
                        dataKey="revenue"
                        nameKey="type"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        labelLine={true}
                        label={(entry) => {
                          const name = (entry.type || '').replace(/_/g, ' ');
                          const percent = ((entry.revenue / reportPreview.totalRevenue) * 100).toFixed(0);
                          return `${name} (${percent}%)`;
                        }}
                      >
                        {reportPreview.visitTypes.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => `$${value}`} />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  <Card className="bg-gradient-to-br from-green-50 to-emerald-50">
                    <CardContent className="p-6">
                      <p className="text-sm text-slate-600 mb-1">Total Revenue</p>
                      <p className="text-3xl font-bold text-green-600">${reportPreview.totalRevenue.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-gradient-to-br from-blue-50 to-indigo-50">
                    <CardContent className="p-6">
                      <p className="text-sm text-slate-600 mb-1">Cost Savings</p>
                      <p className="text-3xl font-bold text-blue-600">${Math.round(reportPreview.costSavings).toLocaleString()}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-gradient-to-br from-navy-50 to-gold-50">
                    <CardContent className="p-6">
                      <p className="text-sm text-slate-600 mb-1">ROI</p>
                      <p className="text-3xl font-bold text-navy-600">{reportPreview.roi}%</p>
                    </CardContent>
                  </Card>
                </div>

                <div>
                  <h3 className="font-semibold mb-4">Revenue by Visit Type</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={reportPreview.visitTypes}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="type" angle={-45} textAnchor="end" height={100} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="count" fill="#3557b0" name="Visit Count" />
                      <Bar dataKey="revenue" fill="#10b981" name="Revenue ($)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}

            {reportType === 'trend_analysis' && reportPreview && (
              <>
                <div>
                  <h3 className="font-semibold mb-4">Visit Trends Over Time</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <RechartsLineChart data={reportPreview}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="visits" stroke="#3557b0" strokeWidth={2} name="Total Visits" />
                      <Line type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={2} name="Completed" />
                      <Line type="monotone" dataKey="incidents" stroke="#ef4444" strokeWidth={2} name="Incidents" />
                    </RechartsLineChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-slate-600 mb-1">Avg Daily Visits</p>
                      <p className="text-2xl font-bold">
                        {Math.round(reportPreview.reduce((sum, d) => sum + d.visits, 0) / reportPreview.length)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-slate-600 mb-1">Peak Day</p>
                      <p className="text-2xl font-bold">
                        {reportPreview.reduce((max, d) => d.visits > max.visits ? d : max, reportPreview[0])?.date}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-slate-600 mb-1">Total Incidents</p>
                      <p className="text-2xl font-bold text-red-600">
                        {reportPreview.reduce((sum, d) => sum + d.incidents, 0)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-slate-600 mb-1">Completion Rate</p>
                      <p className="text-2xl font-bold text-green-600">
                        {(() => {
                          const totalVisits = reportPreview.reduce((sum, d) => sum + d.visits, 0);
                          return totalVisits > 0
                            ? Math.round((reportPreview.reduce((sum, d) => sum + d.completed, 0) / totalVisits) * 100)
                            : 0;
                        })()}%
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}