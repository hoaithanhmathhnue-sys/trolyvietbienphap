/**
 * Review Export Service - Xuất kết quả thẩm định Biện pháp ra DOCX và PDF
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType, ShadingType
} from 'docx';
import { EnhancedAnalysisResult } from './geminiService';

// ==================== DOCX EXPORT ====================

function createHeaderCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })],
      alignment: AlignmentType.CENTER
    })],
    shading: { fill: "0D9488", type: ShadingType.CLEAR },
    width: { size: 33, type: WidthType.PERCENTAGE }
  });
}

function getScoreColor(score: number, max: number): string {
  const pct = score / max;
  if (pct >= 0.8) return "16A34A";
  if (pct >= 0.6) return "D97706";
  return "DC2626";
}

function getRiskColor(level: string): string {
  const l = level.toLowerCase();
  if (l.includes('chưa xác định')) return "6B7280";
  if (l.includes('cao') || l.includes('nguy hiểm') || l.includes('rất')) return "DC2626";
  if (l.includes('trung bình')) return "D97706";
  return "16A34A";
}

export async function exportReviewToDocx(result: EnhancedAnalysisResult, fileName?: string): Promise<void> {
  const children: any[] = [];

  // Title
  children.push(new Paragraph({
    children: [new TextRun({ text: "KẾT QUẢ TỰ ĐÁNH GIÁ BẰNG AI (THAM KHẢO)", bold: true, size: 32, color: "0D9488" })],
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 }
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: `Ngày tạo: ${new Date().toLocaleDateString('vi-VN')} — Trợ lý Biện pháp GVG`, italics: true, size: 18, color: "6B7280" })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 }
  }));
  children.push(new Paragraph({
    children: [new TextRun({
      text: "⚠️ Tài liệu này KHÔNG phải biên bản thẩm định chính thức. Các chỉ số \"nguy cơ đạo văn\" và \"nguy cơ AI\" là ước lượng chủ quan của mô hình AI dựa trên văn phong, KHÔNG dựa trên đối chiếu với cơ sở dữ liệu văn bản thật (không dùng Turnitin/iThenticate hay công cụ đối chiếu nguồn nào). Vui lòng tự kiểm tra lại trước khi sử dụng cho mục đích chính thức.",
      italics: true, size: 16, color: "B45309"
    })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 }
  }));

  // I. TỔNG QUAN
  children.push(new Paragraph({ text: "I. TỔNG QUAN", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: "Điểm tổng thể: ", bold: true }),
      new TextRun({ text: `${result.totalScore}/100`, bold: true, color: getScoreColor(result.totalScore, 100), size: 28 }),
    ],
    spacing: { after: 100 }
  }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: "Nguy cơ đạo văn: ", bold: true }),
      new TextRun({ text: `${result.plagiarismPercent}% (${result.plagiarismLevel})`, color: getRiskColor(result.plagiarismLevel) }),
    ],
    spacing: { after: 100 }
  }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: "Nguy cơ AI: ", bold: true }),
      new TextRun({ text: `${result.aiRiskPercent}% (${result.aiRiskLevel})`, color: getRiskColor(result.aiRiskLevel) }),
    ],
    spacing: { after: 100 }
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: result.summary, italics: true })],
    spacing: { after: 300 }
  }));

  // II. CẤU TRÚC BIỆN PHÁP
  children.push(new Paragraph({ text: "II. CẤU TRÚC BIỆN PHÁP", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }));
  const statusEmoji: Record<string, string> = { pass: '✅', warn: '⚠️', fail: '❌' };
  result.detectedSections.forEach(s => {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${statusEmoji[s.status] || '•'} ${s.name}`, bold: true }),
        new TextRun({ text: ` — ${s.comment}`, italics: true, color: "6B7280" }),
      ],
      spacing: { after: 80 }
    }));
  });

  // III. TIÊU CHÍ CHẤT LƯỢNG
  children.push(new Paragraph({ text: "III. TIÊU CHÍ CHẤT LƯỢNG", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }));
  const criteriaTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [createHeaderCell("Tiêu chí"), createHeaderCell("Điểm"), createHeaderCell("Nhận xét")] }),
      ...result.qualityCriteria.map(c => new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c.name, bold: true })] })] }),
          new TableCell({
            children: [new Paragraph({
              children: [new TextRun({ text: `${c.score}/${c.maxScore}`, bold: true, color: getScoreColor(c.score, c.maxScore) })],
              alignment: AlignmentType.CENTER
            })]
          }),
          new TableCell({ children: [new Paragraph({ text: c.comment })] }),
        ]
      }))
    ]
  });
  children.push(criteriaTable);

  // IV. PHÂN TÍCH ĐẠO VĂN
  if (result.plagiarismSegments.length > 0) {
    children.push(new Paragraph({ text: "IV. PHÂN TÍCH ĐẠO VĂN", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }));
    result.plagiarismSegments.forEach((p, i) => {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${i + 1}. `, bold: true }),
          new TextRun({ text: `"${p.segment}"`, italics: true }),
          new TextRun({ text: ` → Nguồn: ${p.source} (${p.similarity}% tương tự)`, color: "DC2626" }),
        ],
        spacing: { after: 100 }
      }));
    });
  }

  // V. PHÂN TÍCH NGUY CƠ AI
  children.push(new Paragraph({ text: "V. PHÂN TÍCH NGUY CƠ AI", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: `Perplexity: ${result.aiRiskDetails.perplexity}/100 | Burstiness: ${result.aiRiskDetails.burstiness}/100 | Pattern Density: ${result.aiRiskDetails.patternDensity}/100` }),
    ],
    spacing: { after: 100 }
  }));
  if (result.aiRiskDetails.suspiciousPatterns.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: "Mẫu câu AI phát hiện:", bold: true })], spacing: { after: 50 } }));
    result.aiRiskDetails.suspiciousPatterns.forEach(p => {
      children.push(new Paragraph({ text: `• "${p}"`, spacing: { after: 50 } }));
    });
  }

  // VI. GỢI Ý CẢI THIỆN
  children.push(new Paragraph({ text: "VI. GỢI Ý CẢI THIỆN", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }));
  result.suggestions.forEach((s, i) => {
    children.push(new Paragraph({
      children: [new TextRun({ text: `${i + 1}. ${s}` })],
      spacing: { after: 80 }
    }));
  });

  // Footer
  children.push(new Paragraph({
    children: [new TextRun({ text: "─".repeat(60), color: "D1D5DB" })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 400 }
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: `Báo cáo tạo bởi Trợ lý Biện pháp GVG — ${new Date().toLocaleString('vi-VN')}`, size: 18, color: "9CA3AF", italics: true })],
    alignment: AlignmentType.CENTER,
  }));

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(doc);
  const fName = fileName || `BaoCao_ThamDinh_${new Date().toISOString().split('T')[0]}.docx`;
  
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ==================== PDF EXPORT (Print-based) ====================

// Escape HTML để chống XSS: toàn bộ nội dung trong result là do AI sinh ra
// từ tài liệu người dùng tải lên, không được tin cậy khi chèn trực tiếp vào DOM/HTML (xem P2.4).
function escapeHtml(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function exportReviewToPdf(result: EnhancedAnalysisResult): void {
  const statusEmoji: Record<string, string> = { pass: '✅', warn: '⚠️', fail: '❌' };

  const getScoreColorHtml = (score: number, max: number) => {
    const pct = score / max;
    if (pct >= 0.8) return '#16A34A';
    if (pct >= 0.6) return '#D97706';
    return '#DC2626';
  };

  const getRiskColorHtml = (level: string) => {
    const l = level.toLowerCase();
    if (l.includes('chưa xác định')) return '#6B7280';
    if (l.includes('cao') || l.includes('nguy hiểm') || l.includes('rất')) return '#DC2626';
    if (l.includes('trung bình')) return '#D97706';
    return '#16A34A';
  };

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Kết quả tự đánh giá bằng AI</title>
<style>
  body { font-family: 'Times New Roman', serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; font-size: 13pt; line-height: 1.6; }
  h1 { text-align: center; color: #0D9488; border-bottom: 2px solid #0D9488; padding-bottom: 10px; }
  h2 { color: #0D9488; margin-top: 24px; border-left: 4px solid #0D9488; padding-left: 10px; }
  .overview { display: flex; justify-content: space-around; gap: 16px; margin: 20px 0; flex-wrap: wrap; }
  .overview-card { text-align: center; padding: 14px 20px; border-radius: 10px; border: 1px solid #e5e7eb; flex: 1; min-width: 180px; }
  .score-big { font-size: 32pt; font-weight: bold; }
  .section-item { padding: 5px 0; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }
  th { background: #0D9488; color: white; }
  .plagiarism-item { background: #FEF2F2; padding: 8px 12px; border-left: 3px solid #DC2626; margin: 6px 0; border-radius: 4px; }
  .suggestion-item { padding: 4px 0; }
  .disclaimer { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; font-size: 10pt; padding: 10px 14px; border-radius: 6px; margin: 16px 0; }
  .footer { text-align: center; color: #9CA3AF; font-size: 10pt; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 10px; }
  @media print { body { margin: 0; } .no-print { display: none; } }
</style>
</head><body>
<h1>KẾT QUẢ TỰ ĐÁNH GIÁ BẰNG AI (THAM KHẢO)</h1>
<p style="text-align:center;color:#6B7280;font-style:italic;">Ngày: ${escapeHtml(new Date().toLocaleDateString('vi-VN'))} — Trợ lý Biện pháp GVG</p>

<div class="disclaimer">
  ⚠️ Đây KHÔNG phải biên bản thẩm định chính thức. Các chỉ số "nguy cơ đạo văn" và "nguy cơ AI" là ước lượng chủ quan của mô hình AI dựa trên văn phong, KHÔNG dựa trên đối chiếu với cơ sở dữ liệu văn bản thật. Vui lòng tự kiểm tra lại trước khi dùng cho mục đích chính thức.
</div>

<div class="overview">
  <div class="overview-card">
    <div style="color:#6B7280;font-size:10pt;text-transform:uppercase;letter-spacing:1px;">Chất lượng tổng thể</div>
    <div class="score-big" style="color:${getScoreColorHtml(result.totalScore, 100)}">${escapeHtml(result.totalScore)}<span style="font-size:14pt;color:#9CA3AF">/100</span></div>
  </div>
  <div class="overview-card">
    <div style="color:#6B7280;font-size:10pt;text-transform:uppercase;letter-spacing:1px;">Nguy cơ đạo văn (ước lượng)</div>
    <div class="score-big" style="color:${getRiskColorHtml(result.plagiarismLevel)}">${escapeHtml(result.plagiarismPercent)}%</div>
    <div style="font-size:10pt;color:${getRiskColorHtml(result.plagiarismLevel)}">${escapeHtml(result.plagiarismLevel)}</div>
  </div>
  <div class="overview-card">
    <div style="color:#6B7280;font-size:10pt;text-transform:uppercase;letter-spacing:1px;">Nguy cơ AI (ước lượng)</div>
    <div class="score-big" style="color:${getRiskColorHtml(result.aiRiskLevel)}">${escapeHtml(result.aiRiskPercent)}%</div>
    <div style="font-size:10pt;color:${getRiskColorHtml(result.aiRiskLevel)}">${escapeHtml(result.aiRiskLevel)}</div>
  </div>
</div>

<p style="font-style:italic;background:#f0fdfa;padding:10px;border-radius:6px;">${escapeHtml(result.summary)}</p>

<h2>CẤU TRÚC BIỆN PHÁP</h2>
${result.detectedSections.map(s => `<div class="section-item">${statusEmoji[s.status] || '•'} <strong>${escapeHtml(s.name)}</strong> — <span style="color:#6B7280">${escapeHtml(s.comment)}</span></div>`).join('')}

<h2>TIÊU CHÍ CHẤT LƯỢNG</h2>
<table>
<tr><th>Tiêu chí</th><th style="width:70px;text-align:center">Điểm</th><th>Nhận xét</th></tr>
${result.qualityCriteria.map(c => `<tr><td><strong>${escapeHtml(c.name)}</strong></td><td style="text-align:center;color:${getScoreColorHtml(c.score, c.maxScore)};font-weight:bold">${escapeHtml(c.score)}/${escapeHtml(c.maxScore)}</td><td>${escapeHtml(c.comment)}</td></tr>`).join('')}
</table>

${result.plagiarismSegments.length > 0 ? `
<h2>CÁC ĐOẠN CÓ VĂN PHONG TRÙNG LẶP/PHỔ BIẾN (ước lượng, chưa đối chiếu nguồn thật)</h2>
${result.plagiarismSegments.map((p, i) => `<div class="plagiarism-item"><strong>${i + 1}.</strong> "${escapeHtml(p.segment)}" → <span style="color:#DC2626">${escapeHtml(p.source)} (${escapeHtml(p.similarity)}%)</span></div>`).join('')}
` : ''}

<h2>PHÂN TÍCH NGUY CƠ AI</h2>
<p>Perplexity: <strong>${escapeHtml(result.aiRiskDetails.perplexity)}/100</strong> | Burstiness: <strong>${escapeHtml(result.aiRiskDetails.burstiness)}/100</strong> | Pattern Density: <strong>${escapeHtml(result.aiRiskDetails.patternDensity)}/100</strong></p>
${result.aiRiskDetails.suspiciousPatterns.length > 0 ? `<p><strong>Mẫu câu AI:</strong></p><ul>${result.aiRiskDetails.suspiciousPatterns.map(p => `<li>"${escapeHtml(p)}"</li>`).join('')}</ul>` : ''}

<h2>GỢI Ý CẢI THIỆN</h2>
${result.suggestions.map((s, i) => `<div class="suggestion-item"><strong>${i + 1}.</strong> ${escapeHtml(s)}</div>`).join('')}

<div class="footer">Báo cáo tạo bởi Trợ lý Biện pháp GVG — ${escapeHtml(new Date().toLocaleString('vi-VN'))}</div>

</body></html>`;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
    }, 500);
  }
}
