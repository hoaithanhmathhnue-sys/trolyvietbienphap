import React, { useState, useRef, useEffect } from 'react';
import { UserInfo, SKKNTemplate, SKKNSection, TitleAnalysisResult } from '../types';
import { Button } from './Button';
import { InputWithHistory, TextareaWithHistory } from './InputWithHistory';
import { saveFormToHistory } from '../services/inputHistory';
import { HIGHER_ED_LEVELS, HIGHER_ED_GRADES } from '../constants';
import { SUBJECTS_DATA, SUBJECT_GROUPS, searchSubjects, getSubjectsByGroup } from '../data/subjectsData';
import { TEACHING_METHODS } from '../data/teachingMethods';
import { analyzeDocumentForSKKN, extractSKKNStructure, analyzeTitleSKKN } from '../services/geminiService';
import TitleAnalysisPanel from './TitleAnalysisPanel';
import { BrainstormTopicModal } from './BrainstormTopicModal';
import { BookOpen, School, GraduationCap, PenTool, MapPin, Calendar, Users, Cpu, Target, Monitor, FileUp, Sparkles, ClipboardPaste, Loader2, FileText, Search, X, CheckCircle, List, Save, ChevronDown } from 'lucide-react';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Define worker source for PDF.js
// Using a CDN to avoid complex build configuration for web workers in standard Vite setups
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

interface Props {
  userInfo: UserInfo;
  onChange: (field: keyof UserInfo, value: string) => void;
  onSubmit: () => void;
  onManualSubmit: (content: string) => void;
  isSubmitting: boolean;
  apiKey?: string;  // Thêm API key để gọi AI phân tích
  selectedModel?: string;  // Model đang sử dụng
}

interface InputGroupProps {
  label: string;
  icon: any;
  required?: boolean;
  children: React.ReactNode;
}

const InputGroup: React.FC<InputGroupProps> = ({ label, icon: Icon, required, children }) => (
  <div className="w-full">
    <label className="block text-sm font-semibold text-gray-900 mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    <div className="relative rounded-md shadow-sm">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Icon className="h-5 w-5 text-gray-400" />
      </div>
      {children}
    </div>
  </div>
);

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export const SKKNForm: React.FC<Props> = ({ userInfo, onChange, onSubmit, onManualSubmit, isSubmitting, apiKey, selectedModel }) => {
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [manualContent, setManualContent] = useState('');
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isProcessingRefFiles, setIsProcessingRefFiles] = useState(false);
  const [isProcessingTemplateFile, setIsProcessingTemplateFile] = useState(false);
  const [refFileNames, setRefFileNames] = useState<string[]>(() => {
    // Khôi phục danh sách file từ sessionStorage
    try {
      const saved = sessionStorage.getItem('skkn_ref_file_names');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  }); // Danh sách tên file đã tải
  const [templateFileName, setTemplateFileName] = useState<string>(''); // Tên file mẫu Biện pháp
  // State cho phân tích tài liệu
  const [isAnalyzingRef, setIsAnalyzingRef] = useState(false);
  const [isAnalyzingTemplate, setIsAnalyzingTemplate] = useState(false);
  const [refAnalysisResult, setRefAnalysisResult] = useState('');
  const [templateAnalysisResult, setTemplateAnalysisResult] = useState('');
  const [showAnalysisModal, setShowAnalysisModal] = useState<'ref' | 'template' | null>(null);
  const [isBrainstormModalOpen, setIsBrainstormModalOpen] = useState(false);

  // State cho phân tích tên đề tài
  const [isAnalyzingTitle, setIsAnalyzingTitle] = useState(false);
  const [titleAnalysis, setTitleAnalysis] = useState<TitleAnalysisResult | null>(null);

  // State cho tiến trình xử lý file
  const [fileProgress, setFileProgress] = useState('');

  // State cho autocomplete Môn học/Lĩnh vực
  const [showSubjectDropdown, setShowSubjectDropdown] = useState(false);
  const [subjectSearch, setSubjectSearch] = useState('');
  const subjectDropdownRef = useRef<HTMLDivElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);
  const templateFileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    onChange(e.target.name as keyof UserInfo, e.target.value);
  };

  // Wrapper để lưu lịch sử trước khi submit
  const handleSubmitWithHistory = () => {
    // Lưu tất cả thông tin vào lịch sử
    saveFormToHistory(userInfo as unknown as Record<string, string>);
    // Gọi submit gốc
    onSubmit();
  };

  // Lưu refFileNames vào sessionStorage khi thay đổi
  useEffect(() => {
    try {
      sessionStorage.setItem('skkn_ref_file_names', JSON.stringify(refFileNames));
    } catch (e) { /* ignore */ }
  }, [refFileNames]);

  // Đóng dropdown Môn học khi click bên ngoài
  useEffect(() => {
    const handleClickOutsideSubject = (event: MouseEvent) => {
      if (subjectDropdownRef.current && !subjectDropdownRef.current.contains(event.target as Node)) {
        setShowSubjectDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutsideSubject);
    return () => document.removeEventListener('mousedown', handleClickOutsideSubject);
  }, []);

  // Trích xuất text từ PDF - hỗ trợ file lớn bằng cách xử lý theo batch
  const extractTextFromPdf = async (arrayBuffer: ArrayBuffer, onProgress?: (msg: string) => void): Promise<string> => {
    const BATCH_SIZE = 10; // Số trang xử lý mỗi batch

    console.log(`📄 Bắt đầu đọc PDF (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)}MB)...`);

    // Copy arrayBuffer vì pdfjs có thể transfer ownership
    const dataCopy = new Uint8Array(arrayBuffer);

    onProgress?.('Đang tải PDF...');

    // Tạo loading task với timeout bảo vệ
    const loadingTask = pdfjsLib.getDocument({
      data: dataCopy,
      // Tắt auto fetch và stream để tránh lỗi với worker
      disableAutoFetch: true,
      disableStream: true,
    });

    // Timeout 30 giây khi load PDF
    const pdf = await Promise.race([
      loadingTask.promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          loadingTask.destroy();
          reject(new Error('Hết thời gian tải PDF (30s). File có thể bị lỗi hoặc bảo mật.'));
        }, 30000)
      )
    ]);

    const totalPages = pdf.numPages;
    console.log(`📄 PDF có ${totalPages} trang. Bắt đầu trích xuất text...`);
    let fullText = '';

    onProgress?.(`Đang đọc PDF: 0/${totalPages} trang...`);

    // Xử lý từng batch để tránh tràn bộ nhớ
    for (let batchStart = 1; batchStart <= totalPages; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalPages);

      for (let i = batchStart; i <= batchEnd; i++) {
        try {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ');
          fullText += pageText + '\n\n';
          // Giải phóng tài nguyên trang
          page.cleanup();
        } catch (pageError) {
          console.warn(`⚠️ Không thể đọc trang ${i}:`, pageError);
          fullText += `[Không đọc được trang ${i}]\n\n`;
        }
      }

      onProgress?.(`Đang đọc PDF: ${batchEnd}/${totalPages} trang...`);

      // Cho phép UI cập nhật giữa các batch
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Giải phóng tài nguyên PDF  
    try { pdf.cleanup(); } catch (e) { /* ignore cleanup errors */ }
    try { pdf.destroy(); } catch (e) { /* ignore cleanup errors */ }

    console.log(`✅ Hoàn thành đọc PDF: ${totalPages} trang, ${fullText.length} ký tự`);

    // Cảnh báo nếu PDF không có text (có thể là PDF scan/ảnh)
    if (!fullText.trim()) {
      console.warn('⚠️ PDF không chứa text. Có thể là PDF dạng ảnh/scan.');
      return '[PDF này không chứa text có thể trích xuất. Có thể đây là file PDF dạng ảnh/scan. Vui lòng sử dụng file Word hoặc PDF có text.]';
    }

    return fullText;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      alert(`File "${file.name}" có dung lượng ${(file.size / 1024 / 1024).toFixed(1)}MB, vượt quá giới hạn 100MB. Vui lòng chọn file nhỏ hơn.`);
      return;
    }

    setIsProcessingFile(true);
    setFileProgress(`Đang đọc file ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      let extractedText = '';

      if (file.type === 'application/pdf') {
        extractedText = await extractTextFromPdf(arrayBuffer, setFileProgress);
      } else if (
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.name.endsWith('.docx')
      ) {
        const result = await mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value;
        if (result.messages.length > 0) {
          console.warn("Mammoth messages:", result.messages);
        }
      } else {
        // Fallback for text files
        extractedText = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsText(file);
        });
      }

      setManualContent(prev => prev ? prev + '\n\n' + extractedText : extractedText);
    } catch (error) {
      console.error("Error reading file:", error);
      alert("Không thể đọc file. Vui lòng thử lại hoặc copy nội dung thủ công.");
    } finally {
      setIsProcessingFile(false);
      setFileProgress('');
      // Reset input value to allow re-uploading the same file if needed
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle Reference Documents Upload (Multiple PDFs)
  const handleRefFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Kiểm tra kích thước từng file
    for (let i = 0; i < files.length; i++) {
      if (files[i].size > MAX_FILE_SIZE) {
        alert(`File "${files[i].name}" có dung lượng ${(files[i].size / 1024 / 1024).toFixed(1)}MB, vượt quá giới hạn 100MB. Vui lòng chọn file nhỏ hơn.`);
        return;
      }
    }

    setIsProcessingRefFiles(true);
    try {
      let allExtractedText = userInfo.referenceDocuments || '';
      const newFileNames: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`📎 Đang xử lý file ${i + 1}/${files.length}: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB, type: ${file.type})`);
        setFileProgress(`Đang đọc file ${i + 1}/${files.length}: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)...`);

        try {
          const arrayBuffer = await file.arrayBuffer();
          let extractedText = '';

          if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            extractedText = await extractTextFromPdf(arrayBuffer, (msg) => {
              setFileProgress(`File ${i + 1}/${files.length} - ${msg}`);
            });
          } else if (
            file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            file.name.endsWith('.docx')
          ) {
            const result = await mammoth.extractRawText({ arrayBuffer });
            extractedText = result.value;
          } else {
            // Fallback for text files
            extractedText = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.readAsText(file);
            });
          }

          // Luôn thêm file, kể cả khi text rỗng (thông báo cho user)
          if (extractedText.trim()) {
            allExtractedText += `\n\n=== TÀI LIỆU: ${file.name} ===\n${extractedText}`;
            newFileNames.push(file.name);
            console.log(`✅ Đã đọc file ${file.name}: ${extractedText.length} ký tự`);
          } else {
            newFileNames.push(`${file.name} (không có text)`);
            console.warn(`⚠️ File ${file.name} không trích xuất được text`);
          }
        } catch (fileError: any) {
          console.error(`❌ Lỗi đọc file ${file.name}:`, fileError);
          // Tiếp tục với file khác thay vì dừng hết
          alert(`Không thể đọc file "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)}MB).\nLỗi: ${fileError?.message || 'Không xác định'}\nFile này sẽ bị bỏ qua.`);
        }
      }

      onChange('referenceDocuments', allExtractedText);
      setRefFileNames(prev => [...prev, ...newFileNames]);
    } catch (error) {
      console.error("Error reading reference files:", error);
      alert("Không thể đọc một số file tài liệu. Vui lòng thử lại.");
    } finally {
      setIsProcessingRefFiles(false);
      setFileProgress('');
      if (refFileInputRef.current) {
        refFileInputRef.current.value = '';
      }
    }
  };

  // Handle Biện pháp Template Upload - Tự động trích xuất cấu trúc
  const [isExtractingStructure, setIsExtractingStructure] = useState(false);
  const [parsedTemplate, setParsedTemplate] = useState<SKKNTemplate | null>(null);

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      alert(`File "${file.name}" có dung lượng ${(file.size / 1024 / 1024).toFixed(1)}MB, vượt quá giới hạn 100MB. Vui lòng chọn file nhỏ hơn.`);
      return;
    }

    setIsProcessingTemplateFile(true);
    setParsedTemplate(null); // Reset template khi upload file mới
    setFileProgress(`Đang đọc mẫu ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      let extractedText = '';

      if (file.type === 'application/pdf') {
        extractedText = await extractTextFromPdf(arrayBuffer, setFileProgress);
      } else if (
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.name.endsWith('.docx')
      ) {
        const result = await mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value;
      } else {
        // Fallback for text files
        extractedText = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsText(file);
        });
      }

      if (extractedText.trim()) {
        onChange('skknTemplate', extractedText);
        setTemplateFileName(file.name);

        // TỰ ĐỘNG TRÍCH XUẤT CẤU TRÚC NếU CÓ API KEY
        if (apiKey) {
          setIsExtractingStructure(true);
          try {
            const sections = await extractSKKNStructure(apiKey, extractedText, selectedModel);

            if (sections.length > 0) {
              const customTemplate: SKKNTemplate = {
                name: file.name,
                sections,
                rawContent: extractedText
              };
              onChange('customTemplate', JSON.stringify(customTemplate) as any);
              setParsedTemplate(customTemplate);
              console.log(`✅ Đã trích xuất ${sections.length} mục từ mẫu Biện pháp`);
            } else {
              console.log('⚠️ Không trích xuất được cấu trúc - sẽ dùng mẫu chuẩn');
            }
          } catch (structureError) {
            console.error('Lỗi trích xuất cấu trúc:', structureError);
            // Không hiển thị lỗi cho user - fallback về mẫu chuẩn
          } finally {
            setIsExtractingStructure(false);
          }
        }
      }
    } catch (error) {
      console.error("Error reading template file:", error);
      alert("Không thể đọc file mẫu Biện pháp. Vui lòng thử lại.");
    } finally {
      setIsProcessingTemplateFile(false);
      setFileProgress('');
      if (templateFileInputRef.current) {
        templateFileInputRef.current.value = '';
      }
    }
  };

  // Clear all reference documents
  const clearRefDocuments = () => {
    onChange('referenceDocuments', '');
    setRefFileNames([]);
    try {
      sessionStorage.removeItem('skkn_ref_docs');
      sessionStorage.removeItem('skkn_ref_file_names');
    } catch (e) { /* ignore */ }
  };

  // Clear template
  const clearTemplate = () => {
    onChange('skknTemplate', '');
    onChange('customTemplate' as keyof UserInfo, '');
    setTemplateFileName('');
    setParsedTemplate(null);
  };

  // Hàm phân tích tài liệu tham khảo bằng AI
  const handleAnalyzeRefDocs = async () => {
    if (!userInfo.referenceDocuments || !apiKey) {
      alert('Vui lòng tải lên tài liệu và đảm bảo đã nhập API Key.');
      return;
    }
    setIsAnalyzingRef(true);
    try {
      const result = await analyzeDocumentForSKKN(
        apiKey,
        userInfo.referenceDocuments,
        'reference',
        selectedModel
      );
      setRefAnalysisResult(result);
      setShowAnalysisModal('ref');
    } catch (error: any) {
      alert('Lỗi khi phân tích tài liệu: ' + (error.message || 'Vui lòng thử lại.'));
    } finally {
      setIsAnalyzingRef(false);
    }
  };

  // Hàm phân tích mẫu Biện pháp bằng AI
  const handleAnalyzeTemplate = async () => {
    if (!userInfo.skknTemplate || !apiKey) {
      alert('Vui lòng tải lên mẫu Biện pháp và đảm bảo đã nhập API Key.');
      return;
    }
    setIsAnalyzingTemplate(true);
    try {
      const result = await analyzeDocumentForSKKN(
        apiKey,
        userInfo.skknTemplate,
        'template',
        selectedModel
      );
      setTemplateAnalysisResult(result);
      setShowAnalysisModal('template');
    } catch (error: any) {
      alert('Lỗi khi phân tích mẫu: ' + (error.message || 'Vui lòng thử lại.'));
    } finally {
      setIsAnalyzingTemplate(false);
    }
  };

  // Hàm phân tích tên đề tài bằng AI
  const handleAnalyzeTitle = async () => {
    if (!userInfo.topic.trim()) {
      alert('Vui lòng nhập tên đề tài trước khi phân tích.');
      return;
    }
    if (!apiKey) {
      alert('Vui lòng cấu hình API Key trước.');
      return;
    }
    setIsAnalyzingTitle(true);
    try {
      const result = await analyzeTitleSKKN(
        apiKey,
        userInfo.topic,
        userInfo.subject,
        userInfo.level,
        selectedModel,
        userInfo.teachingMethod
      );
      setTitleAnalysis(result);
    } catch (error: any) {
      alert('Lỗi phân tích đề tài: ' + error.message);
    } finally {
      setIsAnalyzingTitle(false);
    }
  };

  // Callback khi chọn gợi ý đề tài
  const handleSelectTitle = (title: string) => {
    onChange('topic', title);
    setTitleAnalysis(null);
  };

  // Check valid based on mode - chỉ check các field là string
  const requiredFields: (keyof UserInfo)[] = ['topic', 'subject'];
  const isInfoValid = requiredFields.every(key => {
    const value = userInfo[key];
    return typeof value === 'string' && value.trim() !== '';
  });
  const isManualValid = manualContent.trim().length > 50; // Minimum length check

  return (
    <div className="w-full max-w-4xl mx-auto bg-white rounded-xl shadow-xl border border-sky-100 overflow-hidden my-8">
      <div className="bg-sky-600 p-6 text-white text-center">
        <h2 className="text-3xl font-bold mb-2">Trợ Lý Viết Biện Pháp GVG/GVCN Giỏi</h2>
        <p className="text-sky-100 opacity-90">Hoàn thành nhanh chóng, đúng chuẩn và tự nhiên</p>
      </div>

      <div className="p-8 space-y-8">

        {/* SECTION 1: REQUIRED INFO */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-sky-100 pb-2 mb-4 gap-2">
            <h3 className="text-lg font-bold text-sky-800 uppercase tracking-wide m-0">
              1. Thông tin bắt buộc
            </h3>
            <button
              type="button"
              onClick={() => setIsBrainstormModalOpen(true)}
              className="text-sm bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 flex items-center gap-1.5 font-bold transition-all border border-indigo-200 rounded-md w-max"
            >
              <Sparkles size={16} className="text-indigo-600"/>
              Đề xuất tên đề tài (AI)
            </button>
          </div>

          <div className="space-y-5">
            <InputGroup label="Tên đề tài Biện pháp" icon={PenTool} required>
              <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
                <div className="flex-1 w-full relative">
                  <InputWithHistory
                    name="topic"
                    value={userInfo.topic}
                    onChange={handleChange}
                    className="bg-gray-50 focus:bg-white focus:ring-sky-500 focus:border-sky-500 block w-full pl-10 text-sm border-gray-300 rounded-md p-3 border text-gray-900 placeholder-gray-500"
                    placeholder='VD: "Ứng dụng AI để nâng cao hiệu quả dạy học môn Toán THPT"'
                    required
                  />
                </div>
                
                <div className="w-full md:w-64 relative shrink-0">
                  <select
                    name="teachingMethod"
                    value={userInfo.teachingMethod || ''}
                    onChange={handleChange}
                    className="bg-gray-50 focus:bg-white focus:ring-sky-500 focus:border-sky-500 block w-full text-sm border-gray-300 rounded-md p-3 border text-gray-900 appearance-none cursor-pointer"
                  >
                    <option value="">-- Chọn PP dạy học (Tùy chọn) --</option>
                    {TEACHING_METHODS.map((method, idx) => (
                      <option key={idx} value={method}>{method}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                    <ChevronDown size={14} />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleAnalyzeTitle}
                  disabled={isAnalyzingTitle || !userInfo.topic.trim()}
                  className={`px-3 py-3 rounded-lg font-medium text-white flex items-center gap-2 transition-all whitespace-nowrap ${isAnalyzingTitle || !userInfo.topic.trim()
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-purple-600 hover:bg-purple-700 hover:shadow-lg'
                    }`}
                  title="Phân tích tên đề tài"
                >
                  {isAnalyzingTitle ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Search size={18} />
                  )}
                  <span className="hidden sm:inline">Phân tích</span>
                </button>
              </div>
            </InputGroup>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <InputGroup label="Môn học/Lĩnh vực" icon={BookOpen} required>
                <div className="relative" ref={subjectDropdownRef}>
                  <div className="relative">
                    <input
                      type="text"
                      name="subject"
                      value={userInfo.subject}
                      onChange={(e) => {
                        onChange('subject', e.target.value);
                        setSubjectSearch(e.target.value);
                        setShowSubjectDropdown(true);
                      }}
                      onFocus={() => {
                        setSubjectSearch(userInfo.subject);
                        setShowSubjectDropdown(true);
                      }}
                      ref={subjectInputRef}
                      className="bg-gray-50 focus:bg-white focus:ring-sky-500 focus:border-sky-500 block w-full pl-10 pr-8 text-sm border-gray-300 rounded-md p-3 border text-gray-900 placeholder-gray-500"
                      placeholder="Chọn hoặc nhập môn học/lĩnh vực..."
                      required
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSubjectDropdown(!showSubjectDropdown)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                      tabIndex={-1}
                    >
                      <ChevronDown size={16} className={`transition-transform ${showSubjectDropdown ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {/* Dropdown danh sách gợi ý */}
                  {showSubjectDropdown && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-72 overflow-y-auto">
                      {(() => {
                        const filtered = searchSubjects(userInfo.subject);
                        if (filtered.length === 0) {
                          return (
                            <div className="p-3 text-sm text-gray-500 text-center">
                              Không tìm thấy. Bạn có thể tự nhập tên môn/lĩnh vực.
                            </div>
                          );
                        }
                        // Nhóm kết quả theo group
                        const grouped: Record<string, typeof filtered> = {};
                        filtered.forEach(item => {
                          if (!grouped[item.group]) grouped[item.group] = [];
                          grouped[item.group].push(item);
                        });
                        return Object.entries(grouped).map(([group, items]) => (
                          <div key={group}>
                            <div className="px-3 py-1.5 text-[11px] font-semibold text-sky-600 bg-sky-50 uppercase tracking-wider sticky top-0">
                              {group}
                            </div>
                            {items.map(item => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  onChange('subject', item.name);
                                  setShowSubjectDropdown(false);
                                  subjectInputRef.current?.blur();
                                }}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-sky-50 transition-colors flex flex-col ${userInfo.subject === item.name ? 'bg-sky-50 text-sky-700 font-medium' : 'text-gray-700'}`}
                              >
                                <span>{item.name}</span>
                                <span className="text-[11px] text-gray-400 mt-0.5">{item.description}</span>
                              </button>
                            ))}
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              </InputGroup>

              <div className="grid grid-cols-2 gap-3">
                <InputGroup label="Cấp học" icon={GraduationCap}>
                  <select
                    name="level"
                    value={userInfo.level}
                    onChange={handleChange}
                    className="bg-gray-50 focus:bg-white focus:ring-sky-500 focus:border-sky-500 block w-full pl-10 text-sm border-gray-300 rounded-md p-3 border appearance-none text-gray-900"
                  >
                    <option value="">Chọn cấp...</option>
                    <option value="Mầm non">Mầm non</option>
                    <option value="Tiểu học">Tiểu học</option>
                    <option value="THCS">THCS</option>
                    <option value="THPT">THPT</option>
                    <option value="GDTX">GDTX</option>
                    <option value="Trung cấp">Trung cấp</option>
                    <option value="Cao đẳng">Cao đẳng</option>
                    <option value="Đại học">Đại học</option>
                  </select>
                </InputGroup>
                <InputGroup label="Khối lớp" icon={GraduationCap}>
                  {HIGHER_ED_LEVELS.includes(userInfo.level) ? (
                    <select
                      name="grade"
                      value={userInfo.grade}
                      onChange={handleChange}
                      className="bg-gray-50 focus:bg-white focus:ring-sky-500 focus:border-sky-500 block w-full pl-10 text-sm border-gray-300 rounded-md p-3 border appearance-none text-gray-900"
                    >
                      <option value="">Chọn đối tượng...</option>
                      {HIGHER_ED_GRADES.map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      name="grade"
                      value={userInfo.grade}
                      onChange={handleChange}
                      className="bg-gray-50 focus:bg-white focus:ring-sky-500 focus:border-sky-500 block w-full pl-10 text-sm border-gray-300 rounded-md p-3 border text-gray-900 placeholder-gray-500"
                      placeholder="VD: Lớp 12, Khối 6-9"
                    />
                  )}
                </InputGroup>
              </div>
            </div>


          </div>
        </div>

        {/* SECTION 2: REFERENCE DOCUMENTS & TEMPLATE */}
        <div>
          <h3 className="text-lg font-bold text-sky-800 border-b border-sky-100 pb-2 mb-4 uppercase tracking-wide flex items-center">
            2. Tài liệu tham khảo
            <span className="ml-2 text-xs bg-sky-100 text-sky-800 py-1 px-2 rounded-full font-normal capitalize normal-case tracking-normal">
              (Tùy chọn - Giúp AI bám sát nội dung)
            </span>
          </h3>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* LEFT COLUMN: Reference Documents */}
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 relative">
              {isProcessingRefFiles && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10 backdrop-blur-sm rounded-lg">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-sky-600 animate-spin" />
                    <p className="text-sm font-medium text-sky-700">{fileProgress || 'Đang đọc tài liệu...'}</p>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-start mb-3">
                <label className="text-sm font-semibold text-gray-700">
                  Tải lên tài liệu PDF/Word để AI tham khảo:
                </label>
                <div className="flex gap-2 flex-shrink-0">
                  {refFileNames.length > 0 && (
                    <button
                      onClick={clearRefDocuments}
                      className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-1 rounded hover:bg-red-100 transition-colors border border-red-100"
                    >
                      Xóa
                    </button>
                  )}
                  <input
                    type="file"
                    ref={refFileInputRef}
                    onChange={handleRefFileUpload}
                    className="hidden"
                    accept=".pdf,.docx,.txt"
                    multiple
                  />
                  <button
                    onClick={() => refFileInputRef.current?.click()}
                    className="text-xs font-semibold text-sky-600 bg-sky-50 px-2 py-1 rounded hover:bg-sky-100 transition-colors flex items-center gap-1 border border-sky-100"
                  >
                    <FileUp size={12} /> Tải lên
                  </button>
                </div>
              </div>

              {refFileNames.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 mb-2">Đã tải ({refFileNames.length} file):</p>
                  <div className="flex flex-wrap gap-1">
                    {refFileNames.map((name, index) => (
                      <span key={index} className="inline-flex items-center gap-1 px-2 py-1 bg-sky-100 text-sky-800 text-xs rounded-full">
                        <FileText size={10} />
                        {name.length > 20 ? name.substring(0, 20) + '...' : name}
                      </span>
                    ))}
                  </div>
                  {/* Hiển thị thông tin kích thước text đã extract */}
                  {userInfo.referenceDocuments && (
                    <div className={`mt-2 p-2 rounded text-xs ${userInfo.referenceDocuments.length > 80000
                      ? 'bg-amber-50 border border-amber-200 text-amber-700'
                      : 'bg-green-50 border border-green-200 text-green-700'
                      }`}>
                      <p className="font-medium">
                        📊 {(userInfo.referenceDocuments.length / 1000).toFixed(0)}K ký tự
                        (~{Math.round(userInfo.referenceDocuments.length / 2500)} trang A4)
                      </p>
                      {userInfo.referenceDocuments.length > 80000 && (
                        <p className="mt-1 text-[11px]">
                          ⚠️ Nội dung lớn sẽ được tóm tắt (~80K ký tự đầu) khi gửi AI để đảm bảo chất lượng xử lý.
                        </p>
                      )}
                    </div>
                  )}
                  {/* Nút Phân tích sơ bộ */}
                  <button
                    onClick={handleAnalyzeRefDocs}
                    disabled={isAnalyzingRef || !apiKey}
                    className="mt-3 w-full text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-emerald-200 transition-colors"
                  >
                    {isAnalyzingRef ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Đang phân tích...
                      </>
                    ) : (
                      <>
                        <Search size={14} />
                        🔍 Phân tích sơ bộ bằng AI
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="text-center py-3 text-gray-500">
                  <FileUp size={24} className="mx-auto mb-2 opacity-50" />
                  <p className="text-xs font-medium text-gray-600 mb-2">Chưa có tài liệu</p>
                  <div className="text-xs text-left bg-white p-2 rounded border border-gray-100">
                    <p className="font-semibold text-sky-700 mb-1">💡 Gợi ý:</p>
                    <ul className="space-y-0.5 text-gray-600 text-[11px]">
                      <li>• SGK/Sách giáo viên</li>
                      <li>• Tài liệu chuyên môn</li>
                      <li>• Đề kiểm tra/Bài tập</li>
                      <li>• Văn bản pháp quy</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: Biện pháp Template */}
            <div className="bg-amber-50 p-4 rounded-lg border border-amber-200 relative">
              {isProcessingTemplateFile && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10 backdrop-blur-sm rounded-lg">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
                    <p className="text-sm font-medium text-amber-700">{fileProgress || 'Đang đọc mẫu...'}</p>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-start mb-3">
                <label className="text-sm font-semibold text-gray-700">
                  Tải lên mẫu yêu cầu Biện pháp:
                </label>
                <div className="flex gap-2 flex-shrink-0">
                  {templateFileName && (
                    <button
                      onClick={clearTemplate}
                      className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-1 rounded hover:bg-red-100 transition-colors border border-red-100"
                    >
                      Xóa
                    </button>
                  )}
                  <input
                    type="file"
                    ref={templateFileInputRef}
                    onChange={handleTemplateUpload}
                    className="hidden"
                    accept=".pdf,.docx,.txt"
                  />
                  <button
                    onClick={() => templateFileInputRef.current?.click()}
                    className="text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-1 rounded hover:bg-amber-200 transition-colors flex items-center gap-1 border border-amber-200"
                  >
                    <FileUp size={12} /> Tải lên
                  </button>
                </div>
              </div>

              {templateFileName ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 mb-2">Mẫu Biện pháp đã tải:</p>
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-100 text-amber-800 rounded-lg">
                    <FileText size={16} />
                    <span className="text-sm font-medium truncate">{templateFileName}</span>
                  </div>
                  <p className="text-xs text-green-600 font-medium">✓ AI sẽ bám sát cấu trúc mẫu này</p>
                  {/* Nút Phân tích sơ bộ mẫu Biện pháp */}
                  <button
                    onClick={handleAnalyzeTemplate}
                    disabled={isAnalyzingTemplate || !apiKey}
                    className="mt-2 w-full text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-emerald-200 transition-colors"
                  >
                    {isAnalyzingTemplate ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Đang phân tích...
                      </>
                    ) : (
                      <>
                        <Search size={14} />
                        🔍 Phân tích sơ bộ bằng AI
                      </>
                    )}
                  </button>

                  {/* Hiển thị trạng thái trích xuất cấu trúc */}
                  {isExtractingStructure && (
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200 flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin text-blue-600" />
                      <span className="text-xs text-blue-700">Đang trích xuất cấu trúc mẫu...</span>
                    </div>
                  )}

                  {/* Hiển thị cấu trúc đã trích xuất */}
                  {parsedTemplate && parsedTemplate.sections.length > 0 && !isExtractingStructure && (
                    <div className="mt-3 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle size={14} className="text-emerald-600" />
                        <span className="text-xs font-semibold text-emerald-700">
                          ✅ Đã trích xuất {parsedTemplate.sections.length} mục từ mẫu
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 max-h-36 overflow-y-auto bg-white p-2 rounded border border-emerald-100">
                        <ul className="space-y-0.5">
                          {parsedTemplate.sections.slice(0, 8).map((s, idx) => (
                            <li
                              key={idx}
                              style={{ paddingLeft: `${(s.level - 1) * 12}px` }}
                              className={s.level === 1 ? 'font-semibold text-emerald-800' : 'text-gray-600'}
                            >
                              {s.level === 1 ? '📌' : s.level === 2 ? '•' : '○'} {s.title}
                            </li>
                          ))}
                          {parsedTemplate.sections.length > 8 && (
                            <li className="text-gray-400 italic">... và {parsedTemplate.sections.length - 8} mục khác</li>
                          )}
                        </ul>
                      </div>
                      <p className="text-[10px] text-emerald-600 mt-2 italic">
                        💡 AI sẽ tạo dàn ý và nội dung theo cấu trúc này
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-3 text-gray-500">
                  <FileText size={24} className="mx-auto mb-2 opacity-50 text-amber-400" />
                  <p className="text-xs font-medium text-gray-600 mb-2">Chưa có mẫu</p>
                  <div className="text-xs text-left bg-white p-2 rounded border border-amber-100">
                    <p className="font-semibold text-amber-700 mb-1">📋 Mẫu yêu cầu Biện pháp:</p>
                    <ul className="space-y-0.5 text-gray-600 text-[11px]">
                      <li>• File Word/PDF mẫu từ Sở/Phòng GD</li>
                      <li>• AI sẽ bám sát cấu trúc mẫu</li>
                      <li>• Nếu không có, dùng mẫu chuẩn</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 3: SPECIAL REQUIREMENTS */}
        <div>
          <h3 className="text-lg font-bold text-sky-800 border-b border-sky-100 pb-2 mb-4 uppercase tracking-wide flex items-center">
            3. Yêu cầu khác
            <span className="ml-2 text-xs bg-purple-100 text-purple-800 py-1 px-2 rounded-full font-normal capitalize normal-case tracking-normal">
              (Tùy chọn - AI sẽ tuân thủ nghiêm ngặt)
            </span>
          </h3>

          {/* Checkbox viết thêm Giải pháp 4-5 */}
          <div className="flex items-center gap-3 mb-4 p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg border border-amber-200">
            <input
              type="checkbox"
              id="includeSolution4_5"
              name="includeSolution4_5"
              checked={userInfo.includeSolution4_5 || false}
              onChange={(e) => onChange('includeSolution4_5', e.target.checked as any)}
              className="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-amber-500 cursor-pointer"
            />
            <label htmlFor="includeSolution4_5" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
              ✨ Viết thêm <strong className="text-amber-700">Giải pháp 4 và 5</strong>
              <span className="block text-xs text-gray-500 font-normal mt-0.5">
                (Mặc định chỉ viết 3 giải pháp. Tick nếu muốn viết 5 giải pháp)
              </span>
            </label>
          </div>

          {/* Các tùy chọn yêu cầu chi tiết */}
          <div className="bg-purple-50 p-4 rounded-lg border border-purple-200 space-y-4">
            {/* 1. Số trang giới hạn */}
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-gray-700 w-64 flex items-center gap-2">
                📄 Số trang Biện pháp cần giới hạn:
              </label>
              <input
                type="number"
                name="pageLimit"
                value={userInfo.pageLimit || ''}
                onChange={(e) => onChange('pageLimit', e.target.value === '' ? '' : parseInt(e.target.value) as any)}
                placeholder="VD: 25, 30..."
                min={1}
                max={200}
                className="w-24 p-2 border border-purple-200 rounded-lg text-sm focus:ring-purple-500 focus:border-purple-500 bg-white text-center"
              />
              <span className="text-xs text-gray-500">(Để trống nếu không giới hạn)</span>
            </div>

            {/* 2. Thêm bài toán thực tế */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="includePracticalExamples"
                name="includePracticalExamples"
                checked={userInfo.includePracticalExamples || false}
                onChange={(e) => onChange('includePracticalExamples', e.target.checked as any)}
                className="w-5 h-5 text-purple-600 border-gray-300 rounded focus:ring-purple-500 cursor-pointer"
              />
              <label htmlFor="includePracticalExamples" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
                📊 Thêm nhiều <strong className="text-purple-700">bài toán thực tế, ví dụ minh họa</strong>
              </label>
            </div>

            {/* 3. Bổ sung bảng biểu */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="includeStatistics"
                name="includeStatistics"
                checked={userInfo.includeStatistics || false}
                onChange={(e) => onChange('includeStatistics', e.target.checked as any)}
                className="w-5 h-5 text-purple-600 border-gray-300 rounded focus:ring-purple-500 cursor-pointer"
              />
              <label htmlFor="includeStatistics" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
                📈 Bổ sung <strong className="text-purple-700">bảng biểu, số liệu thống kê</strong>
              </label>
            </div>

            {/* 4. Textarea cho yêu cầu bổ sung */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                ✏️ Yêu cầu bổ sung khác (tùy ý):
              </label>
              <textarea
                name="specialRequirements"
                value={userInfo.specialRequirements || ''}
                onChange={handleChange}
                placeholder="Nhập các yêu cầu đặc biệt khác của bạn. Ví dụ:
• Viết ngắn gọn phần cơ sở lý luận (khoảng 3 trang)
• Tập trung vào giải pháp ứng dụng AI
• Viết theo phong cách học thuật nghiêm túc..."
                className="w-full h-24 p-3 border border-purple-200 rounded-lg text-sm focus:ring-purple-500 focus:border-purple-500 bg-white placeholder-gray-400 resize-none"
              />
            </div>

            {/* Nút xác nhận lưu yêu cầu */}
            <div className="pt-3 border-t border-purple-200">
              <button
                onClick={() => onChange('requirementsConfirmed', !userInfo.requirementsConfirmed as any)}
                className={`w-full py-3 px-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${userInfo.requirementsConfirmed
                  ? 'bg-green-600 text-white hover:bg-green-700 shadow-md'
                  : 'bg-purple-600 text-white hover:bg-purple-700 shadow-md'
                  }`}
              >
                {userInfo.requirementsConfirmed ? (
                  <>
                    <CheckCircle size={20} />
                    ✅ Đã xác nhận lưu yêu cầu - Bấm để sửa lại
                  </>
                ) : (
                  <>
                    <Save size={20} />
                    💾 Xác nhận lưu các yêu cầu này
                  </>
                )}
              </button>
              {userInfo.requirementsConfirmed && (
                <p className="mt-2 text-xs text-green-700 text-center font-medium">
                  ✅ Các yêu cầu đã được lưu! AI sẽ tuân thủ NGHIÊM NGẶT khi viết Biện pháp.
                </p>
              )}
              {!userInfo.requirementsConfirmed && (
                <p className="mt-2 text-xs text-purple-600 text-center">
                  💡 Hãy xác nhận để AI biết chính xác yêu cầu của bạn.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 4: MODE SELECTION */}
        <div className="pt-4 border-t border-gray-100">
          <h3 className="text-lg font-bold text-sky-800 mb-4">4. Tùy chọn khởi tạo</h3>

          <div className="flex space-x-4 mb-6">
            <button
              onClick={() => setMode('ai')}
              className={`flex-1 py-3 px-4 rounded-lg border-2 flex items-center justify-center gap-2 transition-all ${mode === 'ai'
                ? 'border-sky-500 bg-sky-50 text-sky-700 font-bold shadow-sm'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
            >
              <Sparkles size={20} />
              AI Lập Dàn Ý Chi Tiết
            </button>
            <button
              onClick={() => setMode('manual')}
              className={`flex-1 py-3 px-4 rounded-lg border-2 flex items-center justify-center gap-2 transition-all ${mode === 'manual'
                ? 'border-sky-500 bg-sky-50 text-sky-700 font-bold shadow-sm'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
            >
              <FileUp size={20} />
              Sử Dụng Dàn Ý Có Sẵn
            </button>
          </div>

          {mode === 'ai' ? (
            <div className="space-y-4 animate-fadeIn">
              <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-800 flex items-start gap-2">
                <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p>Hệ thống AI sẽ tự động phân tích đề tài và tạo ra dàn ý chi tiết gồm 6 phần chuẩn Bộ GD&ĐT. Bạn có thể chỉnh sửa lại sau khi tạo xong.</p>
              </div>
              <Button
                onClick={handleSubmitWithHistory}
                disabled={!isInfoValid || isSubmitting}
                isLoading={isSubmitting}
                className="w-full py-4 text-lg font-bold shadow-sky-500/30 shadow-lg"
              >
                {isSubmitting ? 'Đang khởi tạo...' : '🚀 Bắt đầu lập dàn ý ngay'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4 animate-fadeIn">
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 relative">
                {isProcessingFile && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10 backdrop-blur-sm rounded-lg">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-8 h-8 text-sky-600 animate-spin" />
                      <p className="text-sm font-medium text-sky-700">{fileProgress || 'Đang đọc tài liệu...'}</p>
                    </div>
                  </div>
                )}
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-semibold text-gray-700">Nội dung dàn ý của bạn:</label>
                  <div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      className="hidden"
                      accept=".txt,.md,.docx,.pdf"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs font-semibold text-sky-600 bg-sky-50 px-3 py-1.5 rounded hover:bg-sky-100 transition-colors flex items-center gap-1.5 border border-sky-100"
                    >
                      <FileUp size={14} /> Upload (.docx, .pdf, .txt)
                    </button>
                  </div>
                </div>
                <textarea
                  value={manualContent}
                  onChange={(e) => setManualContent(e.target.value)}
                  placeholder="Nội dung sẽ xuất hiện ở đây sau khi upload file, hoặc bạn có thể dán (paste) trực tiếp..."
                  className="w-full h-64 p-3 border border-gray-300 rounded-md text-sm focus:ring-sky-500 focus:border-sky-500 font-mono"
                />
              </div>
              <Button
                onClick={() => onManualSubmit(manualContent)}
                disabled={!isInfoValid || !isManualValid || isProcessingFile}
                className="w-full py-4 text-lg font-bold bg-green-600 hover:bg-green-700 shadow-green-500/30 shadow-lg"
                icon={<ClipboardPaste size={20} />}
              >
                Sử dụng Dàn ý này & Tiếp tục
              </Button>
              {!isManualValid && (
                <p className="text-center text-xs text-gray-500">Vui lòng nhập nội dung dàn ý (tối thiểu 50 ký tự)</p>
              )}
            </div>
          )}

          {!isInfoValid && (
            <p className="text-center text-red-500 text-sm mt-4">Vui lòng điền đầy đủ các thông tin bắt buộc (*) ở phần trên trước khi tiếp tục.</p>
          )}
        </div>
      </div>

      {/* Modal hiển thị kết quả phân tích */}
      {showAnalysisModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="p-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex justify-between items-center">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Search size={20} />
                📊 Kết quả phân tích sơ bộ
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
                  {showAnalysisModal === 'ref' ? 'Tài liệu tham khảo' : 'Mẫu Biện pháp'}
                </span>
              </h3>
              <button
                onClick={() => setShowAnalysisModal(null)}
                className="p-1 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 overflow-y-auto max-h-[65vh] prose prose-sm prose-emerald max-w-none">
              <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                {showAnalysisModal === 'ref' ? refAnalysisResult : templateAnalysisResult}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => setShowAnalysisModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Title Analysis Panel */}
      {titleAnalysis && (
        <TitleAnalysisPanel
          result={titleAnalysis}
          onClose={() => setTitleAnalysis(null)}
          onSelectTitle={handleSelectTitle}
        />
      )}
      {/* Brainstorm Topic Modal */}
      <BrainstormTopicModal
        isOpen={isBrainstormModalOpen}
        onClose={() => setIsBrainstormModalOpen(false)}
        apiKey={apiKey}
        selectedModel={selectedModel}
        initialSubject={userInfo.subject}
        initialLevel={userInfo.level}
        onSelectTopic={(topic, method) => {
          onChange('topic', topic);
          if (method) {
            onChange('teachingMethod', method);
          }
        }}
      />
    </div>
  );
};
