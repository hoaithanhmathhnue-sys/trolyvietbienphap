import React, { useState, useRef } from 'react';
import { Upload, FileText, AlertTriangle, CheckCircle, Loader2, Star, ChevronDown, ChevronUp, Stethoscope, Pill } from 'lucide-react';
import mammoth from 'mammoth';
import { analyzeOldDocument } from '../services/geminiService';

interface ReviewOldDocPanelProps {
  apiKey: string;
  selectedModel: string;
}

interface AnalysisResult {
  totalScore: number;
  criteria: Array<{ name: string; score: number; maxScore: number; details: string }>;
  suggestions: string[];
  summary: string;
}

const ReviewOldDocPanel: React.FC<ReviewOldDocPanelProps> = ({ apiKey, selectedModel }) => {
  const [fileName, setFileName] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string>('');
  const [expandedCriteria, setExpandedCriteria] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError('');
    setResult(null);
    setFileName(file.name);

    try {
      if (file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        setFileContent(result.value);
      } else if (file.name.endsWith('.txt')) {
        const text = await file.text();
        setFileContent(text);
      } else {
        setError('Chỉ hỗ trợ file .docx và .txt');
        setFileName('');
      }
    } catch (err: any) {
      setError(`Lỗi đọc file: ${err.message}`);
      setFileName('');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!fileContent || !apiKey) return;

    setIsLoading(true);
    setError('');
    setResult(null);

    try {
      const analysisResult = await analyzeOldDocument(apiKey, fileContent, selectedModel);
      setResult(analysisResult);
    } catch (err: any) {
      setError(`Lỗi phân tích: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const getScoreColor = (score: number, max: number) => {
    const pct = (score / max) * 100;
    if (pct >= 80) return 'text-emerald-600';
    if (pct >= 60) return 'text-amber-600';
    return 'text-red-600';
  };

  const getScoreBg = (score: number, max: number) => {
    const pct = (score / max) * 100;
    if (pct >= 80) return 'bg-emerald-500';
    if (pct >= 60) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const getOverallVerdict = (score: number) => {
    if (score >= 80) return { text: 'Tốt - Cần chỉnh sửa nhỏ', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: '✅' };
    if (score >= 60) return { text: 'Trung bình - Cần cải thiện đáng kể', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', icon: '⚠️' };
    if (score >= 40) return { text: 'Yếu - Cần viết lại nhiều phần', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', icon: '🔶' };
    return { text: 'Rất yếu - Nên viết lại hoàn toàn', color: 'text-red-700', bg: 'bg-red-50 border-red-200', icon: '❌' };
  };

  return (
    <div className="max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-3 bg-gradient-to-r from-rose-500 to-pink-500 text-white px-6 py-3 rounded-2xl shadow-lg mb-4">
          <Stethoscope className="w-7 h-7" />
          <h2 className="text-xl font-bold">Khám & Chữa Bệnh Biện Pháp Cũ</h2>
        </div>
        <p className="text-gray-600 text-sm max-w-lg mx-auto">
          Upload biện pháp cũ để AI <strong>chấm điểm</strong>, <strong>phân tích</strong> điểm mạnh/yếu và <strong>đề xuất cải thiện</strong> cụ thể.
        </p>
      </div>

      {/* Upload Zone */}
      <div
        className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer
          ${fileContent ? 'border-emerald-300 bg-emerald-50/50' : 'border-sky-300 bg-sky-50/30 hover:border-sky-400 hover:bg-sky-50/60'}`}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.txt"
          onChange={handleFileUpload}
          className="hidden"
        />
        {isUploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-sky-500 animate-spin" />
            <p className="text-sky-700 font-medium">Đang đọc file...</p>
          </div>
        ) : fileContent ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center">
              <FileText className="w-7 h-7 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-emerald-800">{fileName}</p>
              <p className="text-sm text-emerald-600 mt-1">{fileContent.length.toLocaleString()} ký tự · Sẵn sàng phân tích</p>
            </div>
            <p className="text-xs text-gray-400 mt-2">Bấm để đổi file khác</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 bg-sky-100 rounded-2xl flex items-center justify-center">
              <Upload className="w-7 h-7 text-sky-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-700">Kéo thả hoặc bấm để tải lên</p>
              <p className="text-sm text-gray-500 mt-1">Hỗ trợ: .docx, .txt</p>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {/* Analyze Button */}
      {fileContent && !result && (
        <div className="mt-6 text-center">
          <button
            onClick={handleAnalyze}
            disabled={isLoading || !apiKey}
            className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white rounded-2xl font-bold text-lg shadow-xl hover:shadow-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                Đang khám bệnh...
              </>
            ) : (
              <>
                <Stethoscope className="w-6 h-6" />
                🩺 Bắt Đầu Khám Bệnh
              </>
            )}
          </button>
          {!apiKey && (
            <p className="text-sm text-amber-600 mt-3">⚠️ Vui lòng cài đặt API Key trước khi phân tích</p>
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="mt-8 space-y-6">
          {/* Overall Score */}
          <div className={`p-6 rounded-2xl border-2 ${getOverallVerdict(result.totalScore).bg}`}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-800">Kết Quả Khám Bệnh</h3>
                <p className={`text-sm font-medium mt-1 ${getOverallVerdict(result.totalScore).color}`}>
                  {getOverallVerdict(result.totalScore).icon} {getOverallVerdict(result.totalScore).text}
                </p>
              </div>
              <div className="text-center">
                <div className={`text-4xl font-black ${getScoreColor(result.totalScore, 100)}`}>
                  {result.totalScore}
                </div>
                <div className="text-sm text-gray-500 font-medium">/100 điểm</div>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="p-5 bg-white border border-gray-200 rounded-2xl shadow-sm">
            <h4 className="font-bold text-gray-800 mb-2 flex items-center gap-2">
              <FileText className="w-5 h-5 text-sky-600" />
              Tổng Quan
            </h4>
            <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">{result.summary}</p>
          </div>

          {/* Criteria Breakdown */}
          <div className="space-y-3">
            <h4 className="font-bold text-gray-800 flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-500" />
              Chi Tiết Từng Tiêu Chí
            </h4>
            {result.criteria.map((criterion, index) => (
              <div
                key={index}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
              >
                <button
                  className="w-full p-4 flex items-center justify-between text-left"
                  onClick={() => setExpandedCriteria(expandedCriteria === index ? null : index)}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className={`text-xl font-black ${getScoreColor(criterion.score, criterion.maxScore)}`}>
                      {criterion.score}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-800 text-sm">{criterion.name}</p>
                      <div className="w-full bg-gray-100 rounded-full h-2 mt-1.5">
                        <div
                          className={`h-2 rounded-full transition-all ${getScoreBg(criterion.score, criterion.maxScore)}`}
                          style={{ width: `${(criterion.score / criterion.maxScore) * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-gray-400">/{criterion.maxScore}</span>
                  </div>
                  {expandedCriteria === index ? (
                    <ChevronUp className="w-5 h-5 text-gray-400 ml-3" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400 ml-3" />
                  )}
                </button>
                {expandedCriteria === index && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    <p className="text-sm text-gray-600 leading-relaxed pt-3 whitespace-pre-line">{criterion.details}</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Suggestions */}
          {result.suggestions.length > 0 && (
            <div className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl">
              <h4 className="font-bold text-blue-800 mb-3 flex items-center gap-2">
                <Pill className="w-5 h-5" />
                🩹 Đơn Thuốc - Gợi Ý Cải Thiện
              </h4>
              <ul className="space-y-2">
                {result.suggestions.map((suggestion, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-blue-900">
                    <span className="text-blue-400 mt-0.5 flex-shrink-0">→</span>
                    <span>{suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Re-analyze button */}
          <div className="text-center pt-2">
            <button
              onClick={() => {
                setResult(null);
                setFileContent('');
                setFileName('');
              }}
              className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors text-sm"
            >
              🔄 Khám file khác
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewOldDocPanel;
