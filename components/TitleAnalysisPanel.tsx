import React from 'react';
import { TitleAnalysisResult } from '../types';

interface TitleAnalysisPanelProps {
    result: TitleAnalysisResult;
    onClose: () => void;
    onSelectTitle: (title: string) => void;
}

const TitleAnalysisPanel: React.FC<TitleAnalysisPanelProps> = ({ result, onClose, onSelectTitle }) => {
    const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-600';
        if (score >= 60) return 'text-yellow-600';
        if (score >= 40) return 'text-orange-500';
        return 'text-red-600';
    };

    const getScoreBg = (score: number) => {
        if (score >= 80) return 'bg-green-500';
        if (score >= 60) return 'bg-yellow-500';
        if (score >= 40) return 'bg-orange-500';
        return 'bg-red-500';
    };

    const getDuplicateBadge = (level: string) => {
        switch (level) {
            case 'Thấp':
                return <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium flex items-center gap-1">✅ Thấp</span>;
            case 'Trung bình':
                return <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium flex items-center gap-1">⚠️ Trung bình</span>;
            case 'Cao':
                return <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium flex items-center gap-1">❌ Cao</span>;
            default:
                return null;
        }
    };

    const getVerdictEmoji = (total: number) => {
        if (total >= 90) return '🏆 Xuất sắc';
        if (total >= 75) return '✨ Tốt';
        if (total >= 60) return '👍 Khá';
        if (total >= 40) return '⚠️ Trung bình';
        return '❌ Cần cải thiện';
    };

    const handleCopy = (title: string, index: number) => {
        navigator.clipboard.writeText(title);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden animate-fade-in-up">
                {/* Header */}
                <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-5 text-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-xl">
                            <span className="text-2xl">🎯</span>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">Phân Tích Tên Đề Tài</h2>
                            <p className="text-purple-100 text-sm">Kết quả đánh giá chi tiết (Quy trình 3 lớp)</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-colors text-xl">
                        ✕
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[calc(90vh-100px)] space-y-6">
                    {/* Score Overview */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Total Score */}
                        <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 text-center">
                            <p className="text-gray-600 mb-2">Tổng điểm</p>
                            <div className={`text-5xl font-bold ${getScoreColor(result.scores.total)}`}>
                                {result.scores.total}
                                <span className="text-2xl text-gray-400">/100</span>
                            </div>
                            <p className="mt-2 text-lg">{getVerdictEmoji(result.scores.total)}</p>
                        </div>

                        {/* Duplicate Level */}
                        <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6">
                            <p className="text-gray-600 mb-3">Mức độ trùng lặp</p>
                            <div className="mb-3">{getDuplicateBadge(result.duplicateLevel)}</div>
                            <p className="text-sm text-gray-600">{result.duplicateDetails}</p>
                        </div>
                    </div>

                    {/* Score Details */}
                    <div className="bg-white border rounded-xl p-5">
                        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                            📊 Chi tiết điểm số
                        </h3>
                        <div className="space-y-4">
                            {result.scoreDetails.map((detail, index) => (
                                <div key={index}>
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-sm font-medium text-gray-700">{detail.category}</span>
                                        <span className="text-sm font-bold">{detail.score}/{detail.maxScore}</span>
                                    </div>
                                    <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full ${getScoreBg(detail.score / detail.maxScore * 100)} transition-all duration-500`}
                                            style={{ width: `${(detail.score / detail.maxScore) * 100}%` }}
                                        />
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">{detail.reason}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Structure Analysis */}
                    <div className="bg-white border rounded-xl p-5">
                        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                            👁️ Cấu trúc tên đề tài
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            {[
                                { label: 'Hành động', value: result.structure.action },
                                { label: 'Công cụ', value: result.structure.tool },
                                { label: 'Môn học', value: result.structure.subject },
                                { label: 'Phạm vi', value: result.structure.scope },
                                { label: 'Mục đích', value: result.structure.purpose },
                            ].map((item, i) => (
                                <div key={i} className="bg-gray-50 rounded-lg p-3 text-center">
                                    <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                                    <p className={`text-sm font-medium ${item.value ? 'text-gray-800' : 'text-gray-400 italic'}`}>
                                        {item.value || 'Không có'}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Problems */}
                    {result.problems.length > 0 && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                            <h3 className="font-bold text-red-700 mb-3 flex items-center gap-2">
                                ⚠️ Vấn đề cần khắc phục ({result.problems.length})
                            </h3>
                            <ul className="space-y-2">
                                {result.problems.map((problem, index) => (
                                    <li key={index} className="flex items-start gap-2 text-red-700 text-sm">
                                        <span className="text-red-400 mt-0.5">•</span>
                                        {problem}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Suggestions */}
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                        <h3 className="font-bold text-blue-700 mb-4 flex items-center gap-2">
                            💡 Đề xuất tên thay thế
                        </h3>
                        <div className="space-y-3">
                            {result.suggestions.map((suggestion, index) => (
                                <div key={index} className="bg-white rounded-lg p-4 border border-blue-100 hover:shadow-md transition-shadow">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex-1">
                                            <p className="font-medium text-gray-800 mb-1">{suggestion.title}</p>
                                            <p className="text-xs text-gray-500">{suggestion.strength}</p>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${getScoreColor(suggestion.predictedScore)} bg-gray-100`}>
                                                {suggestion.predictedScore}đ
                                            </span>
                                            <button
                                                onClick={() => handleCopy(suggestion.title, index)}
                                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                title="Sao chép"
                                            >
                                                {copiedIndex === index ? '✅' : '📋'}
                                            </button>
                                            <button
                                                onClick={() => onSelectTitle(suggestion.title)}
                                                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
                                            >
                                                Sử dụng
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Related Topics */}
                    {result.relatedTopics.length > 0 && (
                        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
                            <h3 className="font-bold text-green-700 mb-3 flex items-center gap-2">
                                🌟 Đề tài mới nổi liên quan
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {result.relatedTopics.map((topic, index) => (
                                    <span key={index} className="px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-sm">
                                        {topic}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Overall Verdict */}
                    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-5">
                        <h3 className="font-bold text-indigo-700 mb-2">📋 Kết luận</h3>
                        <p className="text-gray-700">{result.overallVerdict}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TitleAnalysisPanel;
