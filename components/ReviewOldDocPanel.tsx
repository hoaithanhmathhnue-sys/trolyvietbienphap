import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, CheckCircle, AlertTriangle, ShieldAlert, Sparkles, Loader2, Play, Stethoscope } from 'lucide-react';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { analyzeOldDocument } from '../services/geminiService';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

interface ReviewOldDocPanelProps {
  onHealDoc: (originalContent: string, analysisResult: any) => void;
  apiKey?: string;
  selectedModel?: string;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export default function ReviewOldDocPanel({ onHealDoc, apiKey, selectedModel }: ReviewOldDocPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [fileProgress, setFileProgress] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Trích xuất text từ PDF (copy & giản lược từ SKKNForm)
  const extractTextFromPdf = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    const dataCopy = new Uint8Array(arrayBuffer);
    const loadingTask = pdfjsLib.getDocument({
      data: dataCopy,
      disableAutoFetch: true,
      disableStream: true,
    });
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;
    let fullText = '';

    for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        fullText += pageText + '\n\n';
        page.cleanup();
    }
    try { pdf.destroy(); } catch (e) { }
    return fullText;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (selectedFile.size > MAX_FILE_SIZE) {
      alert(`File "${selectedFile.name}" quá dung lượng 100MB.`);
      return;
    }

    setFile(selectedFile);
    setIsProcessingFile(true);
    setFileProgress(`Đang đọc file ${selectedFile.name}...`);
    
    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      let extractedText = '';

      if (selectedFile.type === 'application/pdf') {
        extractedText = await extractTextFromPdf(arrayBuffer);
      } else if (
        selectedFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        selectedFile.name.endsWith('.docx')
      ) {
        const result = await mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value;
      } else {
        extractedText = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsText(selectedFile);
        });
      }

      setOriginalContent(extractedText);
      console.log("Đã đọc xong file, dodai:", extractedText.length);
      
    } catch (error) {
      console.error("Lỗi đọc file:", error);
      alert("Không thể đọc file. Vui lòng sử dụng file DOCX hoặc PDF.");
      setFile(null);
    } finally {
      setIsProcessingFile(false);
      setFileProgress('');
    }
  };

  const startAnalysis = async () => {
    if (!originalContent) return;
    if (!apiKey) {
      alert("Vui lòng nhập API Key để dùng tính năng Khám Bệnh AI.");
      return;
    }
    
    setIsAnalyzing(true);
  const startAnalysis = async () => {
    if (!originalContent) return;
    if (!apiKey) {
      alert("Vui lòng nhập API Key để dùng tính năng Khám Bệnh AI.");
      return;
    }
    
    setIsAnalyzing(true);
    
    try {
       const result = await analyzeOldDocument(apiKey, originalContent, selectedModel);
       setAnalysisResult(result);
    } catch (error: any) {
       console.error("Lỗi khám bệnh:", error);
       alert("Lôi phân tích bệnh án AI: " + error.message);
    } finally {
       setIsAnalyzing(false);
    }
  };
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mt-6 mb-8 max-w-4xl mx-auto">
      <div className="bg-gradient-to-r from-red-600 to-rose-600 px-6 py-4">
        <div className="flex items-center gap-3">
          <Stethoscope className="w-6 h-6 text-white" />
          <h2 className="text-xl font-bold text-white">Thẩm định và sửa SKKN cũ</h2>
        </div>
        <p className="text-red-100 text-sm mt-1">AI phân tích điểm yếu và tự động nâng cấp báo cáo cũ của bạn thành phiên bản GVG xuất sắc.</p>
      </div>

      <div className="p-6">
        {/* Upload Status */}
        {!analysisResult && (
          <div className="mb-6">
             <div 
               className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${file ? 'border-red-300 bg-red-50' : 'border-gray-300 hover:border-red-400 bg-gray-50'}`}
             >
               {!file && !isProcessingFile ? (
                 <>
                   <div className="mb-4">
                     <UploadCloud className="w-12 h-12 text-gray-400 mx-auto" />
                   </div>
                   <h3 className="text-lg font-medium text-gray-900 mb-1">Tải file Báo cáo / SKKN cũ lên đây</h3>
                   <p className="text-sm text-gray-500 mb-4">Hỗ trợ định dạng .docx, .pdf (văn bản)</p>
                   <button
                     onClick={() => fileInputRef.current?.click()}
                     className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 uppercase tracking-wide"
                   >
                     Chọn File
                   </button>
                   <input
                     type="file"
                     ref={fileInputRef}
                     onChange={handleFileUpload}
                     accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,application/pdf"
                     className="hidden"
                   />
                 </>
               ) : (
                 <div className="flex flex-col items-center">
                   {isProcessingFile ? (
                     <>
                       <Loader2 className="w-10 h-10 text-red-500 animate-spin mb-3" />
                       <p className="text-red-600 font-medium">{fileProgress || 'Đang bóc tách văn bản...'}</p>
                     </>
                   ) : (
                     <>
                       <FileText className="w-12 h-12 text-red-500 mb-3" />
                       <p className="text-gray-900 font-medium">{file?.name}</p>
                       <p className="text-sm text-gray-500 mb-4">Đã trích xuất {originalContent.length.toLocaleString()} ký tự</p>
                       
                       <button
                         onClick={startAnalysis}
                         disabled={isAnalyzing}
                         className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 shadow-sm disabled:opacity-50"
                       >
                         {isAnalyzing ? (
                           <><Loader2 className="w-5 h-5 animate-spin" /> Đang khám tổng quát...</>
                         ) : (
                           <><Stethoscope className="w-5 h-5" /> Bắt đầu Máy Quét AI</>
                         )}
                       </button>
                     </>
                   )}
                 </div>
               )}
             </div>
          </div>
        )}

        {/* Kết Quả Khám (Bảng Điểm) */}
        {analysisResult && (
          <div className="space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
               <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                 <ShieldAlert className="w-5 h-5 text-red-500" /> Kết quả khám SKKN
               </h3>
               <button 
                  onClick={() => setAnalysisResult(null)}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
               >Khám lại file khác</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
               {/* Điểm tổng */}
               <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col items-center justify-center text-center">
                  <div className="text-sm text-gray-500 uppercase tracking-widest mb-1 font-semibold">Điểm Tổng Thể</div>
                  <div className={`text-5xl font-black ${analysisResult.totalScore > 80 ? 'text-green-600' : analysisResult.totalScore > 60 ? 'text-amber-500' : 'text-red-500'}`}>
                    {analysisResult.totalScore}<span className="text-2xl text-gray-400">/100</span>
                  </div>
                  <div className="mt-2 text-sm text-gray-600 font-medium">
                     {analysisResult.summary}
                  </div>
               </div>

               {/* Chẩn đoán */}
               <div className="md:col-span-2 space-y-3">
                  {analysisResult.criteria && analysisResult.criteria.map((c: any, index: number) => {
                     let icon;
                     let bgColor, textColor, borderColor;
                     let scoreStr = `${c.score}/${c.maxScore}`;

                     // Assign color logic based on the score percentage
                     const percent = c.score / c.maxScore;
                     if (percent < 0.6) {
                        icon = <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />;
                        bgColor = 'bg-red-50'; borderColor = 'border-red-100'; textColor = 'text-red-800';
                     } else if (percent < 0.8) {
                        icon = <Sparkles className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />;
                        bgColor = 'bg-amber-50'; borderColor = 'border-amber-100'; textColor = 'text-amber-800';
                     } else {
                        icon = <CheckCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />;
                        bgColor = 'bg-blue-50'; borderColor = 'border-blue-100'; textColor = 'text-blue-800';
                     }

                     return (
                       <div key={index} className={`p-3 rounded-lg border flex items-start gap-2 ${bgColor} ${borderColor}`}>
                         {icon}
                         <div>
                           <span className={`font-semibold text-sm uppercase ${textColor}`}>
                              {c.name} ({scoreStr}): 
                           </span>
                           <span className={`text-sm ${textColor} opacity-90 ml-1`}>{c.details}</span>
                         </div>
                       </div>
                     );
                  })}
               </div>
            </div>

            {/* Toa Thuốc */}
            <div className="bg-green-50 rounded-xl p-5 border border-green-200 shadow-sm mt-6">
              <h4 className="font-bold text-green-800 flex items-center gap-2 mb-3">
                <CheckCircle className="w-5 h-5" /> Đơn Thuốc Đề Xuất (AI Nâng Cấp)
              </h4>
              <ul className="space-y-2">
                {analysisResult.suggestions && analysisResult.suggestions.map((rec: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-green-900">
                    <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-green-200 text-green-700 text-xs font-bold mt-0.5">{i+1}</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
              
              <div className="mt-6 pt-5 border-t border-green-200/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                 <p className="text-sm text-green-700 bg-green-100/50 px-3 py-1.5 rounded-md">
                   Bấm nút bên phải để AI tự động <strong>viết lại bài của bạn</strong> dựa trên toa thuốc này.
                 </p>
                 <button 
                   onClick={() => onHealDoc(originalContent, analysisResult)}
                   className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 shadow-md shrink-0 transition-transform active:scale-95"
                 >
                   <Play className="w-5 h-5 fill-white" /> XÁC NHẬN CHỮA BỆNH
                 </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
