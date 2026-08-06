import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

export const exportToPDF = async (options = {}) => {
  const {
    filename = 'report.pdf',
    title = 'Report',
    subtitle = '',
    elementId = null,
    content = [],
    orientation = 'portrait',
    includeTimestamp = true,
    // 'save' downloads the file (default); 'blob' returns the PDF Blob instead
    // (for callers that upload/fax the document rather than download it).
    output = 'save'
  } = options;

  const doc = new jsPDF(orientation, 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  let yPosition = margin;

  // Header
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text(title, margin, yPosition);
  yPosition += 10;

  if (subtitle) {
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text(subtitle, margin, yPosition);
    yPosition += 8;
  }

  if (includeTimestamp) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, margin, yPosition);
    yPosition += 10;
  }

  doc.setTextColor(0);
  doc.setDrawColor(200);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 10;

  // If elementId provided, capture that element
  if (elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      try {
        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          logging: false
        });
        
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = pageWidth - (2 * margin);
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        
        // Handle multi-page content
        let heightLeft = imgHeight;
        let position = yPosition;

        doc.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
        heightLeft -= (pageHeight - position - margin);

        while (heightLeft > 0) {
          position = heightLeft - imgHeight + margin;
          doc.addPage();
          doc.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
          heightLeft -= (pageHeight - margin);
        }
      } catch (error) {
        console.error('Error capturing element:', error);
      }
    }
  }

  // If content array provided, add it
  if (content.length > 0) {
    for (const section of content) {
      // Check if we need a new page
      if (yPosition > pageHeight - 30) {
        doc.addPage();
        yPosition = margin;
      }

      if (section.type === 'heading') {
        doc.setFontSize(section.size || 14);
        doc.setFont(undefined, 'bold');
        doc.text(section.text, margin, yPosition);
        yPosition += 8;
      } else if (section.type === 'text') {
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        const lines = doc.splitTextToSize(section.text, pageWidth - (2 * margin));
        doc.text(lines, margin, yPosition);
        yPosition += lines.length * 5;
      } else if (section.type === 'table') {
        // Accept both table shapes so no caller silently renders a blank table:
        //   1. { headers: [...], rows: [[...]] }                         (most callers)
        //   2. { columns: [{ header, key | accessor }], data: [{...}] }  (src/components/reports/*)
        // The column/data shape previously fell through with `headers`
        // undefined, throwing on `headers.length` — breaking the OASIS, PDGM,
        // Nurse-Performance and Referral report exports.
        let { headers, rows } = section;
        if ((!headers || !rows) && Array.isArray(section.columns)) {
          headers = section.columns.map((c) => c.header ?? c.key ?? '');
          rows = (section.data || []).map((row) =>
            section.columns.map((c) => {
              const v = typeof c.accessor === 'function' ? c.accessor(row) : row[c.key];
              return v == null ? '' : String(v);
            })
          );
        }
        headers = headers || [];
        rows = rows || [];
        if (headers.length === 0) continue; // nothing to render for an empty table
        const colWidth = (pageWidth - (2 * margin)) / headers.length;
        
        // Headers
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.setFillColor(240, 240, 240);
        doc.rect(margin, yPosition - 5, pageWidth - (2 * margin), 8, 'F');
        
        headers.forEach((header, i) => {
          doc.text(header, margin + (i * colWidth) + 2, yPosition);
        });
        yPosition += 10;

        // Rows
        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');
        rows.forEach((row, rowIndex) => {
          if (yPosition > pageHeight - 25) {
            doc.addPage();
            yPosition = margin;
            
            // Repeat headers on new page
            doc.setFontSize(9);
            doc.setFont(undefined, 'bold');
            doc.setFillColor(240, 240, 240);
            doc.rect(margin, yPosition - 5, pageWidth - (2 * margin), 8, 'F');
            headers.forEach((header, i) => {
              doc.text(header, margin + (i * colWidth) + 2, yPosition);
            });
            yPosition += 10;
            doc.setFontSize(8);
            doc.setFont(undefined, 'normal');
          }

          // Calculate max height needed for this row
          let maxHeight = 0;
          const cellLines = row.map((cell, _i) => {
            const cellText = String(cell ?? '');
            const lines = doc.splitTextToSize(cellText, colWidth - 4);
            maxHeight = Math.max(maxHeight, lines.length);
            return lines;
          });

          // Draw alternating row background
          if (rowIndex % 2 === 0) {
            doc.setFillColor(250, 250, 250);
            doc.rect(margin, yPosition - 4, pageWidth - (2 * margin), maxHeight * 4.5 + 2, 'F');
          }

          // Render each cell
          cellLines.forEach((lines, i) => {
            doc.text(lines, margin + (i * colWidth) + 2, yPosition);
          });
          
          yPosition += maxHeight * 4.5 + 2;
        });
        yPosition += 5;
      } else if (section.type === 'spacer') {
        yPosition += section.height || 5;
      } else if (section.type === 'line') {
        doc.setDrawColor(200);
        doc.line(margin, yPosition, pageWidth - margin, yPosition);
        yPosition += 5;
      } else if (section.type === 'pageBreak') {
        doc.addPage();
        yPosition = margin;
      } else if (section.type === 'barChart') {
        const { data, xKey, yKey, _title, height = 80, maxBars = 20 } = section;
        const chartWidth = pageWidth - (2 * margin);
        const chartHeight = height;
        const displayData = data.slice(0, maxBars);
        
        if (displayData.length === 0) {
          yPosition += 5;
          continue;
        }
        
        // Draw chart area background
        doc.setFillColor(250, 250, 250);
        doc.rect(margin, yPosition, chartWidth, chartHeight, 'F');
        
        // Find max value for scaling
        const maxValue = Math.max(...displayData.map(d => d[yKey] || 0));
        const barWidth = chartWidth / displayData.length;
        const scale = maxValue > 0 ? (chartHeight - 20) / maxValue : 1;
        
        // Draw bars
        displayData.forEach((item, i) => {
          const value = item[yKey] || 0;
          const barHeight = value * scale;
          const x = margin + (i * barWidth);
          const y = yPosition + chartHeight - barHeight - 10;
          
          // Bar
          doc.setFillColor(59, 130, 246);
          doc.rect(x + 2, y, barWidth - 4, barHeight, 'F');
          
          // Value label on top of bar
          doc.setFontSize(7);
          doc.setTextColor(0);
          doc.text(String(value), x + barWidth / 2, y - 2, { align: 'center' });
          
          // X-axis label
          doc.setFontSize(6);
          const label = String(item[xKey] || '');
          const labelText = label.length > 8 ? label.substring(0, 7) + '...' : label;
          doc.text(labelText, x + barWidth / 2, yPosition + chartHeight - 2, { align: 'center', angle: 45, maxWidth: barWidth });
        });
        
        // Draw axes
        doc.setDrawColor(100);
        doc.line(margin, yPosition + chartHeight - 10, margin + chartWidth, yPosition + chartHeight - 10);
        doc.line(margin, yPosition, margin, yPosition + chartHeight - 10);
        
        yPosition += chartHeight + 15;
      } else if (section.type === 'pieChart') {
        const { data, nameKey, valueKey, _title, radius = 40 } = section;
        
        if (data.length === 0) {
          yPosition += 5;
          continue;
        }
        
        const centerX = pageWidth / 2;
        const centerY = yPosition + radius + 10;
        
        // Calculate total and angles
        const total = data.reduce((sum, item) => sum + (item[valueKey] || 0), 0);
        let startAngle = -90;
        
        const colors = [
          [59, 130, 246],   // blue
          [16, 185, 129],   // green
          [245, 158, 11],   // orange
          [239, 68, 68],    // red
          [139, 92, 246],   // purple
          [220, 171, 53],   // gold
          [20, 184, 166],   // teal
          [249, 115, 22]    // orange-alt
        ];
        
        // Draw pie slices
        data.forEach((item, i) => {
          const value = item[valueKey] || 0;
          const angle = (value / total) * 360;
          const endAngle = startAngle + angle;
          
          const sliceColor = colors[i % colors.length];
          doc.setFillColor(sliceColor[0], sliceColor[1], sliceColor[2]);
          
          // Draw slice using triangle approximation
          const steps = Math.ceil(angle / 5);
          for (let j = 0; j < steps; j++) {
            const a1 = (startAngle + (angle * j / steps)) * Math.PI / 180;
            const a2 = (startAngle + (angle * (j + 1) / steps)) * Math.PI / 180;
            
            doc.triangle(
              centerX,
              centerY,
              centerX + radius * Math.cos(a1),
              centerY + radius * Math.sin(a1),
              centerX + radius * Math.cos(a2),
              centerY + radius * Math.sin(a2),
              'F'
            );
          }
          
          startAngle = endAngle;
        });
        
        yPosition += (radius * 2) + 20;
        
        // Legend
        doc.setFontSize(8);
        let legendY = yPosition;
        data.forEach((item, i) => {
          if (legendY > pageHeight - 30) {
            doc.addPage();
            legendY = margin;
          }
          
          const percentage = total > 0 ? Math.round((item[valueKey] / total) * 100) : 0;
          
          // Color box
          const legendColor = colors[i % colors.length];
          doc.setFillColor(legendColor[0], legendColor[1], legendColor[2]);
          doc.rect(margin, legendY - 3, 4, 4, 'F');
          
          // Label
          doc.setTextColor(0);
          doc.text(`${item[nameKey]}: ${item[valueKey]} (${percentage}%)`, margin + 7, legendY);
          legendY += 6;
        });
        
        yPosition = legendY + 5;
      }
    }
  }

  // Footer on all pages
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
  }

  if (output === 'blob') {
    return doc.output('blob');
  }
  doc.save(filename);
  return true;
};

export const exportDataTableToPDF = (data, columns, options = {}) => {
  const headers = columns.map(col => col.header || col.key);
  const rows = data.map(item => 
    columns.map(col => {
      const value = item[col.key];
      if (col.format) return col.format(value);
      return value;
    })
  );

  return exportToPDF({
    filename: options.filename || 'data-export.pdf',
    title: options.title || 'Data Export',
    subtitle: options.subtitle,
    content: [
      { type: 'table', headers, rows }
    ]
  });
};