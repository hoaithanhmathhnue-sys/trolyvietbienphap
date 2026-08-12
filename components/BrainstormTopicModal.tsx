import React, { useState } from 'react';
import { X, Search, ChevronRight, ChevronLeft, CheckCircle, Loader2, Wand2, Sparkles } from 'lucide-react';
import { TEACHING_METHODS } from '../data/teachingMethods';
import { brainstormTopicNames, suggestMethods } from '../services/geminiService';

import { AiProvider } from '../types';

interface BrainstormTopicModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey?: string;
  selectedModel?: string;
  provider?: AiProvider;
  initialSubject: string;
  initialLevel: string;
  onSelectTopic: (topic: string, method?: string) => void;
}

export const BrainstormTopicModal: React.FC<BrainstormTopicModalProps> = ({
  isOpen, onClose, apiKey, selectedModel, provider, initialSubject, initialLevel, onSelectTopic
}) => {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    subject: initialSubject || '',
    level: initialLevel || '',
    grade: '',
    topicArea: '',
    chapter: '',
    targetCompetence: '',
    otherRequirements: '',
    selectedMethods: [] as string[]
  });

  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<{title: string, rationale: string}[]>([]);
  const [error, setError] = useState('');

  // AI gợi ý phương pháp
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestedMethods, setSuggestedMethods] = useState<{method: string, reason: string}[]>([]);
  const [suggestError, setSuggestError] = useState('');

  if (!isOpen) return null;

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleMethod = (method: string) => {
    setFormData(prev => {
      const current = prev.selectedMethods;
      if (current.includes(method)) {
        return { ...prev, selectedMethods: current.filter(m => m !== method) };
      } else {
        return { ...prev, selectedMethods: [...current, method] };
      }
    });
  };

  const validateStep = (_currentStep: number) => {
    // Không bắt buộc điền hết — user có thể bỏ trống bất kỳ field nào
    return true;
  };

  const handleNext = () => {
    if (validateStep(step)) {
      setStep(prev => prev + 1);
    } else {
      alert("Vui lòng điền đủ thông tin cần thiết ở bước này!");
    }
  };

  const handlePrev = () => setStep(prev => prev - 1);

  const handleSubmit = async () => {
    if (!apiKey) {
      alert("Vui lòng nhập API Key ở Settings trước khi tải AI.");
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const resp = await brainstormTopicNames(apiKey, formData, selectedModel, provider);
      setResults(resp);
      setStep(4); // Bước hiển thị kết quả
    } catch (err: any) {
      setError(err.message || "Lỗi tạo đề tài.");
    } finally {
      setIsLoading(false);
    }
  };

  // Hàm gọi AI gợi ý PP/KT
  const handleSuggestMethods = async () => {
    if (!apiKey) {
      alert("Vui lòng nhập API Key ở Settings trước khi dùng AI gợi ý.");
      return;
    }
    setSuggestError('');
    setIsSuggesting(true);
    try {
      const resp = await suggestMethods(apiKey, formData, selectedModel, provider);
      setSuggestedMethods(resp);
      // Tự động check các PP được AI gợi ý
      const suggestedNames = resp.map(r => r.method);
      setFormData(prev => {
        const newMethods = [...prev.selectedMethods];
        suggestedNames.forEach(name => {
          if (!newMethods.includes(name)) {
            newMethods.push(name);
          }
        });
        return { ...prev, selectedMethods: newMethods };
      });
    } catch (err: any) {
      setSuggestError(err.message || "Lỗi gợi ý phương pháp.");
    } finally {
      setIsSuggesting(false);
    }
  };

  // Kiểm tra xem PP này có được AI gợi ý không
  const isSuggestedMethod = (method: string) => {
    return suggestedMethods.some(s => s.method === method);
  };

  const getSuggestedReason = (method: string) => {
    return suggestedMethods.find(s => s.method === method)?.reason || '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-sky-50">
          <h3 className="text-xl font-bold text-sky-800 flex items-center gap-2">
            <Search className="w-5 h-5" /> Đề xuất Tên Đề tài (Brainstorm)
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-sky-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {/* Timeline */}
          {step < 4 && (
            <div className="flex items-center justify-between mb-8 relative">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-gray-200 -z-10"></div>
              <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-sky-500 -z-10 transition-all" style={{ width: `${(step - 1) * 50}%` }}></div>
              {[1, 2, 3].map(i => (
                <div key={i} className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border-2 ${step >= i ? 'bg-sky-500 border-sky-500 text-white' : 'bg-white border-gray-300 text-gray-400'}`}>
                  {i}
                </div>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 animate-in fade-in">
              <h4 className="font-semibold text-lg text-gray-800 mb-4">Bước 1: Bối cảnh cơ bản</h4>
              <div>
                <label className="block text-sm font-medium mb-1">Môn học / Lĩnh vực</label>
                <input type="text" value={formData.subject} onChange={e => handleChange('subject', e.target.value)} className="w-full border rounded p-2" placeholder="VD: Toán, Văn, Công tác chủ nhiệm, Quản lý..." />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Cấp học</label>
                <select value={formData.level} onChange={e => handleChange('level', e.target.value)} className="w-full border rounded p-2">
                  <option value="">-- Chọn Cấp --</option>
                  <option value="Mầm non">Mầm non</option>
                  <option value="Tiểu học">Tiểu học</option>
                  <option value="Trung học Cơ sở">Trung học Cơ sở</option>
                  <option value="Trung học Phổ thông">Trung học Phổ thông</option>
                  <option value="GDTX">GDTX</option>
                  <option value="Đại học/Cao đẳng">Đại học/Cao đẳng</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Khối/Lớp</label>
                <input type="text" value={formData.grade} onChange={e => handleChange('grade', e.target.value)} className="w-full border rounded p-2" placeholder="VD: Lớp 10, Lớp 10A1..." />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-in fade-in">
              <h4 className="font-semibold text-lg text-gray-800 mb-4">Bước 2: Mục tiêu chuyên môn</h4>
              <div>
                <label className="block text-sm font-medium mb-1">Chuyên đề nghiên cứu</label>
                <input type="text" value={formData.topicArea} onChange={e => handleChange('topicArea', e.target.value)} className="w-full border rounded p-2" placeholder="VD: Khám phá không gian, Hình học không gian..." />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Chương / Bài</label>
                <input type="text" value={formData.chapter} onChange={e => handleChange('chapter', e.target.value)} className="w-full border rounded p-2" placeholder="VD: Chương 2, Bài 5..." />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Năng lực / Phẩm chất cần đạt thiết yếu</label>
                <textarea value={formData.targetCompetence} onChange={e => handleChange('targetCompetence', e.target.value)} className="w-full border rounded p-2 h-20" placeholder="VD: Tư duy phản biện, tự học, giải quyết vấn đề..." />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-indigo-700">Yêu cầu khác</label>
                <textarea
                  value={formData.otherRequirements}
                  onChange={e => handleChange('otherRequirements', e.target.value)}
                  className="w-full border border-indigo-200 rounded p-2 h-20 bg-indigo-50/30 focus:bg-white focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="VD: Có dùng AI không? Đã có giải pháp hay ý tưởng trò chơi nào chưa? Muốn tích hợp công nghệ gì?..."
                />
                <p className="text-xs text-gray-400 mt-1">Bổ sung thông tin giúp AI gợi ý phương pháp và đề tài chính xác hơn.</p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 animate-in fade-in h-max flex flex-col">
              <h4 className="font-semibold text-lg text-gray-800 mb-2">Bước 3: Chọn Phương pháp / Kỹ thuật</h4>
              <p className="text-sm text-gray-500 mb-2">Bạn có thể chọn nhiều kỹ thuật dự kiến sẽ áp dụng (tùy chọn).</p>
              
              {/* Nút AI gợi ý */}
              <button
                onClick={handleSuggestMethods}
                disabled={isSuggesting}
                className="w-full px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 font-medium disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSuggesting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang phân tích...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    AI gợi ý phương pháp phù hợp
                  </>
                )}
              </button>

              {suggestError && (
                <div className="p-2 bg-red-50 text-red-600 rounded text-xs">{suggestError}</div>
              )}

              {/* Hiển thị kết quả gợi ý */}
              {suggestedMethods.length > 0 && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-indigo-700 mb-2 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> AI đã gợi ý {suggestedMethods.length} phương pháp:
                  </p>
                  <div className="space-y-1.5">
                    {suggestedMethods.map((s, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs">
                        <span className="text-indigo-600 font-bold shrink-0">✦</span>
                        <div>
                          <span className="font-semibold text-indigo-800">{s.method}</span>
                          <span className="text-gray-600 ml-1">— {s.reason}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="flex-1 overflow-y-auto pr-2 border rounded p-2 bg-gray-50 max-h-60">
                {TEACHING_METHODS.map((method, idx) => (
                  <label
                    key={idx}
                    className={`flex items-start gap-2 p-2 hover:bg-white rounded cursor-pointer border-b border-gray-100 last:border-0 ${
                      isSuggestedMethod(method) ? 'bg-indigo-50/70 ring-1 ring-indigo-200' : ''
                    }`}
                    title={getSuggestedReason(method) || undefined}
                  >
                    <input 
                      type="checkbox" 
                      className="mt-1"
                      checked={formData.selectedMethods.includes(method)}
                      onChange={() => toggleMethod(method)}
                    />
                    <span className="text-sm">
                      {method}
                      {isSuggestedMethod(method) && (
                        <span className="ml-1.5 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-medium">
                          AI gợi ý
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 animate-in fade-in">
              <h4 className="font-semibold text-lg text-sky-800 mb-4 flex items-center gap-2"><CheckCircle className="text-green-500" /> Kết quả Đề xuất</h4>
              {results.length === 0 ? (
                <div className="text-red-500 italic p-4 bg-red-50 rounded">Không có kết quả. Vui lòng thử lại.</div>
              ) : (
                <div className="space-y-4">
                  {results.map((r, i) => (
                    <div key={i} className="border border-sky-100 rounded-lg p-4 hover:border-sky-300 hover:shadow-md transition-all bg-white">
                      <h5 className="font-bold text-gray-900 mb-2">{r.title}</h5>
                      <p className="text-sm text-gray-600 mb-3"><span className="font-semibold">Lý do:</span> {r.rationale}</p>
                      <button 
                        onClick={() => {
                          onSelectTopic(r.title, formData.selectedMethods[0] || ''); // Lấy PP đầu tiên match
                          onClose();
                        }}
                        className="text-sm bg-sky-100 text-sky-700 px-3 py-1.5 rounded hover:bg-sky-200 font-medium"
                      >
                        Sử dụng tên này
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <div className="mt-4 p-3 bg-red-50 text-red-600 rounded text-sm">{error}</div>}
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-between items-center rounded-b-xl">
          {step > 1 && step < 4 ? (
            <button onClick={handlePrev} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded flex items-center gap-1">
              <ChevronLeft className="w-4 h-4" /> Quay lại
            </button>
          ) : <div></div>}

          {step < 3 ? (
            <button onClick={handleNext} className="px-4 py-2 bg-sky-600 text-white hover:bg-sky-700 rounded flex items-center gap-1 font-medium shadow-sm">
              Tiếp tục <ChevronRight className="w-4 h-4" />
            </button>
          ) : step === 3 ? (
            <button onClick={handleSubmit} disabled={isLoading} className="px-6 py-2 bg-gradient-to-r from-sky-600 to-indigo-600 text-white hover:shadow-lg rounded flex items-center gap-2 font-medium">
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin"/> : <Search className="w-5 h-5"/>}
              {isLoading ? 'Đang tạo...' : 'Tạo Đề xuất'}
            </button>
          ) : (
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded">
              Đóng
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
