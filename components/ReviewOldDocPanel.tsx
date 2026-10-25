import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, CheckCircle, AlertTriangle, ShieldAlert, Sparkles, Loader2, Play, Microscope, Download, FileDown, X, ChevronDown, ChevronUp } from 'lucide-react';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { analyzeOldDocument, EnhancedAnalysisResult } from '../services/geminiService';
import { processDocxFile } from '../services/docxEditorService';
import { exportReviewToDocx, exportReviewToPdf } from '../services/reviewExportService';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

import { AiProvider } from '../types';
import { DEFAULT_GEMINI_MODEL, DEFAULT_AGENT_PLATFORM_MODEL } from '../constants';

interface ReviewOldDocPanelProps {
  onHealDoc: (originalContent: string, analysisResult: any) => void;
  apiKey?: string;
  selectedModel?: string;
  provider?: AiProvider;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// ===================== SVG Donut Chart Component =====================
const DonutChart: React.FC<{
  value: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  bgColor?: string;
  label: string;
  sublabel?: string;
  suffix?: string;
}> = ({ value, max, size = 120, strokeWidth = 10, color, bgColor = '#e5e7eb', label, sublabel, suffix = '' }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(value / max, 1);
  const offset = circumference * (1 - pct);

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={bgColor} strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-1000 ease-out" />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-2xl font-black" style={{ color }}>{value}{suffix}</span>
        <span className="text-[10px] text-gray-400 font-medium">{sublabel || `/${max}`}</span>
      </div>
      <p className="text-xs font-bold text-gray-600 mt-2 uppercase tracking-wider text-center">{label}</p>
    </div>
  );
};

// ===================== Radar Chart (CSS Polygon SVG) =====================
const RadarChart: React.FC<{ criteria: Array<{ name: string; score: number; maxScore: number }> }> = ({ criteria }) => {
  if (criteria.length < 3) return null;

  const size = 200;
  const center = size / 2;
  const maxR = 70;
  const n = criteria.length;
  const angleStep = (2 * Math.PI) / n;

  const getPoint = (i: number, r: number) => {
    const angle = i * angleStep - Math.PI / 2;
    return { x: center + r * Math.cos(angle), y: center + r * Math.sin(angle) };
  };

  // Grid lines
  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const gridPolygons = gridLevels.map(level => {
    const pts = Array.from({ length: n }, (_, i) => getPoint(i, maxR * level));
    return pts.map(p => `${p.x},${p.y}`).join(' ');
  });

  // Data polygon
  const dataPts = criteria.map((c, i) => getPoint(i, maxR * (c.score / c.maxScore)));
  const dataPolygon = dataPts.map(p => `${p.x},${p.y}`).join(' ');

  // Labels
  const labelPts = criteria.map((c, i) => getPoint(i, maxR + 22));

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[220px] mx-auto">
      {/* Grid */}
      {gridPolygons.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="#e5e7eb" strokeWidth="0.5" />
      ))}
      {/* Axes */}
      {Array.from({ length: n }, (_, i) => {
        const p = getPoint(i, maxR);
        return <line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="#d1d5db" strokeWidth="0.5" />;
      })}
      {/* Data */}
      <polygon points={dataPolygon} fill="rgba(13,148,136,0.2)" stroke="#0D9488" strokeWidth="2" />
      {dataPts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="#0D9488" />
      ))}
      {/* Labels */}
      {labelPts.map((p, i) => (
        <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
          className="fill-gray-600" style={{ fontSize: '8px', fontWeight: 600 }}>
          {criteria[i].name.length > 8 ? criteria[i].name.substring(0, 8) + '…' : criteria[i].name}
        </text>
      ))}
    </svg>
  );
};

// ===================== Bar Chart =====================
const BarChart: React.FC<{ criteria: Array<{ name: string; score: number; maxScore: number }> }> = ({ criteria }) => {
  const getBarColor = (score: number, max: number) => {
    const pct = score / max;
    if (pct >= 0.8) return 'bg-emerald-500';
    if (pct >= 0.6) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <div className="space-y-2.5">
      {criteria.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-600 w-20 truncate text-right" title={c.name}>{c.name}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
            <div className={`h-full rounded-full ${getBarColor(c.score, c.maxScore)} transition-all duration-700`}
              style={{ width: `${(c.score / c.maxScore) * 100}%` }} />
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-800">
              {c.score}/{c.maxScore}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

// ===================== Structure Checklist =====================
const StructureChecklist: React.FC<{ sections: EnhancedAnalysisResult['detectedSections'] }> = ({ sections }) => {
  const statusConfig: Record<string, { icon: React.ReactNode; color: string }> = {
    pass: { icon: <CheckCircle className="w-4 h-4 text-green-500" />, color: 'text-green-700' },
    warn: { icon: <AlertTriangle className="w-4 h-4 text-amber-500" />, color: 'text-amber-700' },
    fail: { icon: <X className="w-4 h-4 text-red-500" />, color: 'text-red-700' },
  };

  return (
    <div className="space-y-1.5">
      {sections.map((s, i) => {
        const cfg = statusConfig[s.status] || statusConfig.warn;
        return (
          <div key={i} className="flex items-start gap-2 text-sm" title={s.comment}>
            <span className="mt-0.5 shrink-0">{cfg.icon}</span>
            <span className={`font-medium ${cfg.color}`}>{s.name}</span>
          </div>
        );
      })}
    </div>
  );
};

// ===================== Main Component =====================
export default function ReviewOldDocPanel({ onHealDoc, apiKey, selectedModel, provider }: ReviewOldDocPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [fileProgress, setFileProgress] = useState('');
  const [originalContent, setOriginalContent] = useState('');

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<EnhancedAnalysisResult | null>(null);

  const [isImprovingDocx, setIsImprovingDocx] = useState(false);
  const [improveProgress, setImproveProgress] = useState(0);
  const [improveMessage, setImproveMessage] = useState('');
  const [improvedDocxUrl, setImprovedDocxUrl] = useState<string | null>(null);
  const [improvedDocxName, setImprovedDocxName] = useState<string>('');

  const [showDetails, setShowDetails] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Trích xuất text từ PDF
  const extractTextFromPdf = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    const dataCopy = new Uint8Array(arrayBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: dataCopy, disableAutoFetch: true, disableStream: true });
    const pdf = await loadingTask.promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      fullText += textContent.items.map((item: any) => item.str).join(' ') + '\n\n';
      page.cleanup();
    }
    try { pdf.destroy(); } catch (e) { }
    return fullText;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    if (selectedFile.size > MAX_FILE_SIZE) { alert(`File quá dung lượng 100MB.`); return; }

    setFile(selectedFile);
    setIsProcessingFile(true);
    setFileProgress(`Đang đọc file ${selectedFile.name}...`);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      let extractedText = '';
      const lowerName = selectedFile.name.toLowerCase();
      if (selectedFile.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
        extractedText = await extractTextFromPdf(arrayBuffer);
      } else if (selectedFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx')) {
        const result = await mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value;
      } else {
        extractedText = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsText(selectedFile);
        });
      }
      if (!extractedText.trim()) {
        alert("File không chứa văn bản có thể trích xuất (có thể là PDF dạng ảnh/scan). Vui lòng dùng file Word hoặc PDF có chữ.");
        setFile(null);
        setOriginalContent('');
        return;
      }
      setOriginalContent(extractedText);
    } catch (error) {
      alert("Không thể đọc file. Vui lòng sử dụng file DOCX hoặc PDF.");
      setFile(null);
    } finally {
      setIsProcessingFile(false);
      setFileProgress('');
    }
  };

  const startAnalysis = async () => {
    if (!originalContent || !apiKey) {
      if (!apiKey) alert("Vui lòng nhập API Key để dùng tính năng Thẩm định AI.");
      return;
    }
    setIsAnalyzing(true);
    try {
      const result = await analyzeOldDocument(apiKey, originalContent, selectedModel, provider);
      setAnalysisResult(result);
    } catch (error: any) {
      alert("Lỗi phân tích biện pháp AI: " + error.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleImproveDocx = async () => {
    if (!file || !apiKey) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      alert('Tính năng sửa trực tiếp chỉ hỗ trợ file .docx.');
      onHealDoc(originalContent, analysisResult);
      return;
    }
    setIsImprovingDocx(true);
    setImproveProgress(0);
    setImproveMessage('Bắt đầu xử lý...');
    try {
      const defaultModel = provider === 'agent-platform' ? DEFAULT_AGENT_PLATFORM_MODEL : DEFAULT_GEMINI_MODEL;
      const { blob, failedBatches, totalBatches } = await processDocxFile(file, apiKey, selectedModel || defaultModel, (percent, msg) => {
        setImproveProgress(percent);
        setImproveMessage(msg);
      }, analysisResult || undefined, provider);
      const url = window.URL.createObjectURL(blob);
      // Giải phóng blob URL của lần cải thiện trước (nếu có)
      if (improvedDocxUrl) window.URL.revokeObjectURL(improvedDocxUrl);
      setImprovedDocxUrl(url);
      setImprovedDocxName(`[DA_CAI_THIEN]_${file.name}`);
      const a = document.createElement('a');
      a.href = url; a.download = `[DA_CAI_THIEN]_${file.name}`;
      document.body.appendChild(a); a.click(); a.remove();
      if (failedBatches > 0) {
        setImproveMessage(`Hoàn tất, nhưng ${failedBatches}/${totalBatches} lô xử lý bị lỗi — một số đoạn chưa được cải thiện. Vui lòng kiểm tra lại file.`);
      } else {
        setImproveMessage('Hoàn tất!');
      }
      setTimeout(() => setIsImprovingDocx(false), 2500);
    } catch (error: any) {
      alert('Lỗi cải thiện DOCX: ' + error.message);
      setIsImprovingDocx(false);
    }
  };

  // Color helpers
  const getScoreColor = (score: number, max: number) => {
    const pct = score / max;
    if (pct >= 0.8) return '#16A34A';
    if (pct >= 0.6) return '#D97706';
    return '#DC2626';
  };

  const getRiskColor = (level: string) => {
    const l = level.toLowerCase();
    if (l.includes('chưa xác định')) return '#6B7280';
    if (l.includes('cao') || l.includes('nguy hiểm') || l.includes('rất')) return '#DC2626';
    if (l.includes('trung bình')) return '#D97706';
    return '#16A34A';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 90) return 'Xuất sắc';
    if (score >= 80) return 'Giỏi';
    if (score >= 70) return 'Khá';
    if (score >= 60) return 'Trung bình';
    return 'Cần cải thiện';
  };

  const r = analysisResult;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mt-6 mb-8 max-w-5xl mx-auto">
      <div className="bg-gradient-to-r from-teal-600 to-emerald-600 px-6 py-4">
        <div className="flex items-center gap-3">
          <Microscope className="w-6 h-6 text-white" />
          <h2 className="text-xl font-bold text-white">THẨM ĐỊNH BIỆN PHÁP</h2>
        </div>
        <p className="text-teal-100 text-sm mt-1">AI phân tích toàn diện: chất lượng, đạo văn, nguy cơ AI — và tự động nâng cấp biện pháp.</p>
      </div>

      <div className="p-6">
        {/* Upload */}
        {!r && (
          <div className="mb-6">
            <div className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${file ? 'border-teal-300 bg-teal-50' : 'border-gray-300 hover:border-teal-400 bg-gray-50'}`}>
              {!file && !isProcessingFile ? (
                <>
                  <UploadCloud className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-1">Tải file Báo cáo / Biện pháp cũ lên đây</h3>
                  <p className="text-sm text-gray-500 mb-4">Hỗ trợ định dạng .docx, .pdf</p>
                  <button onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                    Chọn File
                  </button>
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload}
                    accept=".docx,.pdf" className="hidden" />
                </>
              ) : (
                <div className="flex flex-col items-center">
                  {isProcessingFile ? (
                    <>
                      <Loader2 className="w-10 h-10 text-teal-500 animate-spin mb-3" />
                      <p className="text-teal-600 font-medium">{fileProgress || 'Đang bóc tách văn bản...'}</p>
                    </>
                  ) : (
                    <>
                      <FileText className="w-12 h-12 text-teal-500 mb-3" />
                      <p className="text-gray-900 font-medium">{file?.name}</p>
                      <p className="text-sm text-gray-500 mb-4">Đã trích xuất {originalContent.length.toLocaleString()} ký tự</p>
                      <button onClick={startAnalysis} disabled={isAnalyzing}
                        className="flex items-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 shadow-sm disabled:opacity-50">
                        {isAnalyzing ? (
                          <><Loader2 className="w-5 h-5 animate-spin" /> Đang thẩm định biện pháp...</>
                        ) : (
                          <><Microscope className="w-5 h-5" /> Bắt đầu Thẩm định AI</>
                        )}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============ KẾT QUẢ THẨM ĐỊNH (Dashboard) ============ */}
        {r && (
          <div className="space-y-6 animate-fade-in-up">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-extrabold text-gray-900 flex items-center gap-2">
                <ShieldAlert className="w-6 h-6 text-teal-500" /> Kết quả Phân tích
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={() => {
                  setAnalysisResult(null); setFile(null); setOriginalContent('');
                  if (improvedDocxUrl) window.URL.revokeObjectURL(improvedDocxUrl);
                  setImprovedDocxUrl(null); setImprovedDocxName('');
                }}
                  className="text-sm text-gray-500 hover:text-gray-700 underline">
                  Thẩm định file khác
                </button>
              </div>
            </div>

            <p className="text-sm text-gray-600 italic bg-teal-50 px-4 py-2 rounded-lg border border-teal-100">
              {r.summary}
            </p>

            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
              ⚠️ <strong>Lưu ý quan trọng:</strong> Các chỉ số "Nguy cơ đạo văn" và "Nguy cơ AI" dưới đây là <strong>ước lượng chủ quan của mô hình AI</strong> dựa trên văn phong, KHÔNG phải kết quả đối chiếu với cơ sở dữ liệu văn bản thật (không dùng Turnitin, iThenticate hay công cụ đối chiếu nguồn nào). Nguồn/% tương tự do AI suy diễn, cần tự kiểm tra lại trước khi kết luận.
            </div>

            {r.totalChars > r.analyzedChars && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                ✂️ <strong>Văn bản dài nên chỉ được chấm một phần:</strong> AI mới đánh giá {r.analyzedChars.toLocaleString()} / {r.totalChars.toLocaleString()} ký tự đầu (khoảng {Math.round((r.analyzedChars / r.totalChars) * 100)}%). Các mục nằm ở phần sau của văn bản chưa được xem xét.
              </div>
            )}

            {/* ===== ROW 1: 4 Cards (Chất lượng, Đạo văn, AI, Cấu trúc) ===== */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card: Chất lượng */}
              <div className="bg-gradient-to-br from-white to-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center relative">
                <DonutChart value={r.totalScore} max={100} color={getScoreColor(r.totalScore, 100)}
                  label="CHẤT LƯỢNG TỔNG THỂ" sublabel={`/ 100 điểm`} />
                <span className={`mt-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                  r.totalScore >= 80 ? 'bg-green-100 text-green-700' :
                  r.totalScore >= 60 ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>{getScoreLabel(r.totalScore)}</span>
              </div>

              {/* Card: Đạo văn */}
              <div className="bg-gradient-to-br from-white to-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center relative">
                <DonutChart value={r.plagiarismPercent} max={100} color={getRiskColor(r.plagiarismLevel)}
                  label="NGUY CƠ ĐẠO VĂN" sublabel="trùng lặp" suffix="%" />
                <span className={`mt-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                  r.plagiarismPercent <= 15 ? 'bg-green-100 text-green-700' :
                  r.plagiarismPercent <= 30 ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>{r.plagiarismLevel}</span>
              </div>

              {/* Card: AI */}
              <div className="bg-gradient-to-br from-white to-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center relative">
                <DonutChart value={r.aiRiskPercent} max={100} color={getRiskColor(r.aiRiskLevel)}
                  label="NGUY CƠ AI" sublabel="nguy cơ AI" suffix="%" />
                <span className={`mt-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                  r.aiRiskPercent <= 15 ? 'bg-green-100 text-green-700' :
                  r.aiRiskPercent <= 35 ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>{r.aiRiskLevel}</span>
              </div>

              {/* Card: Cấu trúc */}
              <div className="bg-gradient-to-br from-white to-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm">
                <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 text-center">CẤU TRÚC BIỆN PHÁP</h4>
                <StructureChecklist sections={r.detectedSections} />
              </div>
            </div>

            {/* ===== ROW 2: Radar + Bar Chart ===== */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Radar */}
              <div className="bg-gradient-to-br from-white to-gray-50 p-5 rounded-xl border border-gray-200 shadow-sm">
                <h4 className="text-sm font-bold text-gray-700 mb-3">📊 Tổng quan tiêu chí</h4>
                <RadarChart criteria={r.qualityCriteria} />
              </div>
              {/* Bar */}
              <div className="bg-gradient-to-br from-white to-gray-50 p-5 rounded-xl border border-gray-200 shadow-sm">
                <h4 className="text-sm font-bold text-gray-700 mb-3">📈 Chi tiết điểm số</h4>
                <BarChart criteria={r.qualityCriteria} />
              </div>
            </div>

            {/* ===== Nút Export DOCX + PDF ===== */}
            <div className="flex flex-wrap items-center gap-3 bg-sky-50 rounded-xl p-4 border border-sky-200">
              <span className="text-sm font-bold text-sky-800">📥 Tải kết quả thẩm định:</span>
              <button onClick={() => exportReviewToDocx(r)}
                className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-semibold hover:bg-sky-700 shadow-sm transition-colors">
                <FileDown className="w-4 h-4" /> Tải file DOCX
              </button>
              <button onClick={() => exportReviewToPdf(r)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 shadow-sm transition-colors">
                <Download className="w-4 h-4" /> Tải file PDF
              </button>
            </div>

            {/* ===== Chi tiết mở rộng ===== */}
            <button onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-2 text-sm font-semibold text-teal-700 hover:text-teal-900 transition-colors">
              {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {showDetails ? 'Ẩn chi tiết đạo văn & AI' : 'Xem chi tiết đạo văn & AI'}
            </button>

            {showDetails && (
              <div className="space-y-4 animate-fade-in">
                {/* Đạo văn chi tiết */}
                {r.plagiarismSegments.length > 0 && (
                  <div className="bg-red-50 rounded-xl p-4 border border-red-200">
                    <h4 className="font-bold text-red-800 text-sm mb-3 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Các đoạn nghi ngờ đạo văn
                    </h4>
                    <div className="space-y-2">
                      {r.plagiarismSegments.map((p, i) => (
                        <div key={i} className="bg-white rounded-lg p-3 border border-red-100 text-sm">
                          <p className="text-red-900 font-medium italic">"{p.segment}"</p>
                          <p className="text-red-600 text-xs mt-1">→ Nguồn: {p.source} ({p.similarity}% tương tự)</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI chi tiết */}
                <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
                  <h4 className="font-bold text-orange-800 text-sm mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" /> Chi tiết phân tích AI
                  </h4>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    {[
                      { label: 'Perplexity', value: r.aiRiskDetails.perplexity, desc: 'AI: 20-40, Người: 40-80+' },
                      { label: 'Burstiness', value: r.aiRiskDetails.burstiness, desc: 'AI: thấp, Người: cao' },
                      { label: 'Pattern', value: r.aiRiskDetails.patternDensity, desc: 'Càng cao = càng nhiều AI' },
                    ].map((m, i) => (
                      <div key={i} className="text-center bg-white rounded-lg p-2 border border-orange-100">
                        <div className="text-lg font-bold text-orange-700">{m.value}</div>
                        <div className="text-[10px] font-semibold text-orange-600 uppercase">{m.label}</div>
                        <div className="text-[9px] text-gray-400">{m.desc}</div>
                      </div>
                    ))}
                  </div>
                  {r.aiRiskDetails.suspiciousPatterns.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-bold text-orange-700 mb-1">Mẫu câu AI phát hiện:</p>
                      {r.aiRiskDetails.suspiciousPatterns.map((p, i) => (
                        <p key={i} className="text-xs text-orange-800 bg-orange-100/50 rounded px-2 py-1 mb-1">• "{p}"</p>
                      ))}
                    </div>
                  )}
                  {r.aiRiskDetails.recommendations.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-bold text-blue-700 mb-1">💡 Gợi ý giảm AI:</p>
                      {r.aiRiskDetails.recommendations.map((rec, i) => (
                        <p key={i} className="text-xs text-blue-800 bg-blue-50 rounded px-2 py-1 mb-1">• {rec}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===== Giải pháp & Cải thiện ===== */}
            <div className="bg-green-50 rounded-xl p-5 border border-green-200 shadow-sm">
              <h4 className="font-bold text-green-800 flex items-center gap-2 mb-3">
                <CheckCircle className="w-5 h-5" /> Giải Pháp Đề Xuất (AI Nâng Cấp)
              </h4>
              <ul className="space-y-2">
                {r.suggestions.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-green-900">
                    <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-green-200 text-green-700 text-xs font-bold mt-0.5">{i + 1}</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>

              {r.aiRiskPercent >= 30 && (
                <div className="mt-3 bg-orange-100 border border-orange-300 rounded-lg p-3 text-sm text-orange-800">
                  <strong>⚠️ Lưu ý:</strong> Nguy cơ AI ước lượng ({r.aiRiskPercent}%) khá cao theo đánh giá của AI. Khi bấm "Xác nhận Cải thiện", hệ thống sẽ viết lại các đoạn này theo hướng rõ ràng, mạch lạc và tự nhiên hơn — <strong>không nhằm né tránh bất kỳ công cụ phát hiện AI nào</strong>.
                </div>
              )}

              <div className="mt-6 pt-5 border-t border-green-200/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex-1 w-full">
                  <p className="text-sm text-green-700 bg-green-100/50 px-3 py-1.5 rounded-md mb-2">
                    Hệ thống sẽ <strong>sửa trực tiếp trên file DOCX</strong> của bạn, giữ nguyên định dạng và bôi đỏ chữ mới.
                  </p>
                  {isImprovingDocx && (
                    <div className="mt-2 text-left">
                      <div className="flex justify-between items-center text-xs text-green-800 font-semibold mb-1">
                        <span>{improveMessage}</span><span>{improveProgress}%</span>
                      </div>
                      <div className="w-full bg-green-200 rounded-full h-2">
                        <div className="bg-green-600 h-2 rounded-full transition-all duration-300" style={{ width: `${improveProgress}%` }} />
                      </div>
                    </div>
                  )}
                  {improvedDocxUrl && !isImprovingDocx && (
                    <div className="mt-3">
                      <a href={improvedDocxUrl} download={improvedDocxName}
                        className="inline-flex flex-col items-start px-4 py-2 bg-green-50 border border-green-400 rounded-lg shadow-sm hover:bg-green-100 transition-colors">
                        <span className="flex items-center gap-2 font-bold text-green-700">
                          <FileText className="w-4 h-4" /> BẤM VÀO ĐÂY ĐỂ TẢI XUỐNG BẢN CẢI THIỆN
                        </span>
                        <span className="text-xs text-green-600 mt-1">{improvedDocxName}</span>
                      </a>
                    </div>
                  )}
                </div>
                <button onClick={handleImproveDocx} disabled={isImprovingDocx}
                  className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 shadow-md shrink-0 transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                  {isImprovingDocx ? (
                    <><Loader2 className="w-5 h-5 animate-spin text-white" /> ĐANG XỬ LÝ...</>
                  ) : (
                    <><Play className="w-5 h-5 fill-white" /> XÁC NHẬN CẢI THIỆN</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
