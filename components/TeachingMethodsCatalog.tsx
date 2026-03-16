import React, { useState } from 'react';
import { X, Search, Users, Brain, BarChart3, Globe, Rocket, Bot, ChevronDown, ChevronUp, Zap, BookOpen, Lightbulb } from 'lucide-react';

// ─── Dữ liệu chi tiết 48 PP/KT chia 6 nhóm ───
// Nguồn: TongHop_KyThuat_DayHoc_v4.docx (Trần Hoài Thanh, v4.0, 2026)

interface MethodItem {
  name: string;
  nameEn: string;
  desc: string;
  usage: string;
}

interface MethodGroup {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  color: string;        // gradient classes
  borderColor: string;
  bgLight: string;
  items: MethodItem[];
}

const GROUPS: MethodGroup[] = [
  {
    id: 'A',
    title: 'Tương tác nhóm truyền thống',
    subtitle: 'Kỹ thuật nền tảng, phù hợp mọi cấp học',
    icon: <Users className="w-5 h-5" />,
    color: 'from-blue-500 to-cyan-500',
    borderColor: 'border-blue-200',
    bgLight: 'bg-blue-50',
    items: [
      { name: 'Khăn trải bàn', nameEn: 'Tablecloth Technique', desc: 'Nhóm viết ý cá nhân ra 4 góc → thống nhất ý chung ở giữa tấm khăn.', usage: 'Brainstorming, kích hoạt kiến thức cũ' },
      { name: 'Các mảnh ghép', nameEn: 'Jigsaw Method', desc: 'Vòng chuyên gia nghiên cứu chuyên sâu → quay về nhóm gốc dạy lại.', usage: 'Bài nhiều phần độc lập, đọc hiểu' },
      { name: 'Lẩu băng chuyền', nameEn: 'Station Rotation / Carousel', desc: 'Các trạm học tập xoay vòng, nhóm bổ sung ý kiến qua từng trạm.', usage: 'Ôn tập nhiều chủ đề đồng thời' },
      { name: 'Bể cá', nameEn: 'Fishbowl Discussion', desc: 'Vòng trong thảo luận sâu, vòng ngoài quan sát và nhận xét.', usage: 'Thảo luận chuyên sâu, lớp đông' },
      { name: 'Ổ bi', nameEn: 'Inside-Outside Circle', desc: '2 vòng tròn đồng tâm xoay ngược chiều gặp bạn mới, trao đổi nhanh.', usage: 'Luyện giao tiếp, ngôn ngữ' },
      { name: 'World Café', nameEn: 'World Café', desc: 'Xoay "quán cà phê" thảo luận đa chủ đề, chủ bàn giữ nguyên.', usage: 'Chủ đề rộng, nhiều góc nhìn' },
    ]
  },
  {
    id: 'B',
    title: 'Kỹ thuật tư duy',
    subtitle: 'Kích thích sáng tạo & phản biện',
    icon: <Brain className="w-5 h-5" />,
    color: 'from-purple-500 to-fuchsia-500',
    borderColor: 'border-purple-200',
    bgLight: 'bg-purple-50',
    items: [
      { name: 'Động não', nameEn: 'Brainstorming', desc: 'Tự do đưa ý kiến không phê phán, ghi nhận tất cả, chọn lọc sau.', usage: 'Khởi động, tìm ý tưởng' },
      { name: 'Kỹ thuật XYZ', nameEn: 'Brainwriting 635', desc: 'X người × Y ý × Z phút, viết giấy và chuyền vòng tròn.', usage: 'Tạo ý kiến đa dạng, HS rụt rè' },
      { name: 'Tia chớp', nameEn: 'Lightning Round', desc: 'Mỗi người nêu ý kiến 1 câu cực nhanh, không tranh luận.', usage: 'Phản hồi nhanh, cuối tiết' },
      { name: 'Kỹ thuật 3 lần 3', nameEn: 'Three-Three Technique', desc: '3 điểm tốt + 3 điểm chưa tốt + 3 đề xuất cải thiện.', usage: 'Đánh giá hoạt động, sản phẩm' },
    ]
  },
  {
    id: 'C',
    title: 'Đánh giá & Hệ thống hóa',
    subtitle: 'Tổ chức kiến thức khoa học',
    icon: <BarChart3 className="w-5 h-5" />,
    color: 'from-emerald-500 to-teal-500',
    borderColor: 'border-emerald-200',
    bgLight: 'bg-emerald-50',
    items: [
      { name: 'Lược đồ tư duy', nameEn: 'Mind Map', desc: 'Sơ đồ phân nhánh từ trung tâm ra ngoài, dùng màu sắc và hình ảnh.', usage: 'Ôn tập, hệ thống kiến thức' },
      { name: 'Sơ đồ KWL', nameEn: 'KWL Chart', desc: 'Know (Biết) → Want (Muốn biết) → Learned (Đã học).', usage: 'Đầu và cuối bài học' },
      { name: 'Kipling 5W1H', nameEn: 'Kipling Method', desc: 'Phân tích theo Who / What / Where / When / Why / How.', usage: 'Phân tích sự kiện, hiện tượng' },
      { name: 'Exit Ticket', nameEn: 'Phiếu phản hồi cuối tiết', desc: 'Phiếu 2–3 phút cuối tiết: điều quan trọng nhất, thắc mắc còn lại.', usage: 'Kiểm tra hiểu bài nhanh' },
      { name: 'Dạy học theo góc', nameEn: 'Learning Corners', desc: 'HS tự chọn góc học tập phù hợp phong cách cá nhân.', usage: 'Cá nhân hóa học tập' },
    ]
  },
  {
    id: 'D',
    title: 'Kỹ thuật quốc tế',
    subtitle: 'Tinh hoa sư phạm thế giới',
    icon: <Globe className="w-5 h-5" />,
    color: 'from-sky-500 to-blue-600',
    borderColor: 'border-sky-200',
    bgLight: 'bg-sky-50',
    items: [
      { name: 'Nghĩ–Đôi–Chia sẻ', nameEn: 'Think–Pair–Share', desc: 'Suy nghĩ cá nhân → bắt cặp trao đổi → chia sẻ cả lớp.', usage: 'Kiểm tra hiểu bài nhanh, mọi môn' },
      { name: 'Lớp học đảo ngược', nameEn: 'Flipped Classroom', desc: 'Học lý thuyết ở nhà (video, tài liệu) → lên lớp thực hành, thảo luận.', usage: 'Toán, Lý, Hóa, bậc cao' },
      { name: 'Đặt câu hỏi Socrates', nameEn: 'Socratic Questioning', desc: 'Chuỗi câu hỏi mở dẫn dắt HS tự khám phá kiến thức.', usage: 'Khái niệm phức tạp, tư duy phản biện' },
      { name: 'CATs', nameEn: 'Classroom Assessment Techniques', desc: 'Đánh giá nhanh giữa tiết bằng nhiều hình thức sáng tạo.', usage: 'Kiểm tra hiểu bài, điều chỉnh GD' },
      { name: 'Phỏng vấn ba bước', nameEn: 'Three-Step Interview', desc: 'A phỏng vấn B → B phỏng vấn A → cùng chia sẻ với lớp.', usage: 'Ngôn ngữ, KHXH, kỹ năng giao tiếp' },
      { name: 'Học tập trải nghiệm', nameEn: 'Experiential Learning', desc: 'Học qua làm theo mô hình Kolb: trải nghiệm→phản ánh→khái niệm→thử nghiệm.', usage: 'Thực hành, kết nối thực tiễn' },
      { name: 'Điểm khó hiểu nhất', nameEn: 'Muddiest Point', desc: 'HS viết ra điểm khó hiểu nhất cuối tiết, GV điều chỉnh.', usage: 'Bài khó, điều chỉnh giảng dạy' },
      { name: 'Bài viết 1 phút', nameEn: 'One-Minute Paper', desc: 'Viết 1–2 phút trả lời câu hỏi mở: "Điều quan trọng nhất bạn học được?"', usage: 'Củng cố, phản ánh' },
      { name: 'Bản đồ khái niệm', nameEn: 'Concept Mapping', desc: 'Sơ đồ khái niệm có nhãn mối quan hệ giữa các ý tưởng.', usage: 'Ôn tập chương, hệ thống hóa' },
      { name: 'Tranh luận có cấu trúc', nameEn: 'Structured Academic Controversy', desc: 'Tranh luận 2 phe → đổi vai → tìm kết luận chung.', usage: 'Vấn đề tranh cãi, KHXH' },
      { name: 'Bốn góc lớp học', nameEn: 'Four Corners', desc: 'HS di chuyển đến 4 góc phòng theo lựa chọn A/B/C/D.', usage: 'Khảo sát ý kiến, khởi động' },
      { name: 'Đường quan điểm', nameEn: 'Continuum Line', desc: 'HS đứng trên 1 đường thể hiện mức độ đồng ý (1→10).', usage: 'Quan điểm đa dạng, tranh luận' },
      { name: 'Đánh giá đồng đẳng', nameEn: 'Peer Review / Peer Teaching', desc: 'HS đánh giá bài bạn theo rubric hoặc dạy lại cho bạn.', usage: 'Sau bài kiểm tra, tăng tương tác' },
      { name: 'Phương pháp tình huống', nameEn: 'Case Study Method', desc: 'Phân tích tình huống thực tế, đề xuất giải pháp có căn cứ.', usage: 'Áp dụng kiến thức, KHXH, Y tế' },
    ]
  },
  {
    id: 'E',
    title: 'Phương pháp mới nhất 2025',
    subtitle: 'Xu hướng giáo dục hiện đại',
    icon: <Rocket className="w-5 h-5" />,
    color: 'from-orange-500 to-amber-500',
    borderColor: 'border-orange-200',
    bgLight: 'bg-orange-50',
    items: [
      { name: 'Tư duy thiết kế', nameEn: 'Design Thinking', desc: '5 bước Stanford d.school: Đồng cảm → Xác định → Ý tưởng → Mẫu thử → Kiểm tra.', usage: 'STEM, sáng tạo, dự án' },
      { name: 'Dạy học dựa trên vấn đề', nameEn: 'Problem-Based Learning (PBL)', desc: 'Xuất phát từ vấn đề thực tế mở, HS tự tìm giải pháp.', usage: 'Tư duy bậc cao, liên ngành' },
      { name: 'Dạy học theo dự án', nameEn: 'Project-Based Learning (PjBL)', desc: 'Dự án thực tế có sản phẩm hữu hình, kéo dài nhiều tuần.', usage: 'Liên môn, kỹ năng thế kỷ 21' },
      { name: 'Dạy học truy vấn', nameEn: 'Inquiry-Based Learning (IBL)', desc: 'HS tự đặt câu hỏi nghiên cứu và tiến hành điều tra.', usage: 'Lý, Hóa, Sinh học' },
      { name: 'POGIL', nameEn: 'Process Oriented Guided Inquiry', desc: 'Mô hình → câu hỏi khám phá có hướng dẫn → kết luận.', usage: 'Hóa, Sinh học, thực hành' },
      { name: 'Mô hình 5E (STEM)', nameEn: '5E Instructional Model', desc: 'Engage → Explore → Explain → Elaborate → Evaluate.', usage: 'STEM, khoa học tự nhiên' },
      { name: 'Gamification', nameEn: 'Trò chơi hóa học tập', desc: 'Tích hợp điểm, huy hiệu, bảng xếp hạng vào bài học.', usage: 'Tăng động lực, mọi cấp' },
      { name: 'Metacognition', nameEn: 'Siêu nhận thức', desc: 'HS học cách tự đánh giá và điều chỉnh chiến lược học tập.', usage: 'Kỹ năng tự học, mọi môn' },
    ]
  },
  {
    id: 'F',
    title: 'Phương pháp AI thực chiến',
    subtitle: 'Tích hợp AI vào giảng dạy',
    icon: <Bot className="w-5 h-5" />,
    color: 'from-violet-500 to-indigo-600',
    borderColor: 'border-violet-200',
    bgLight: 'bg-violet-50',
    items: [
      { name: 'Bài tập phân hóa AI', nameEn: 'AI Differentiated Instruction', desc: 'AI tạo 4 đề theo Bloom\'s Taxonomy trong 30 giây, phù hợp năng lực từng nhóm.', usage: 'Phân hóa HS giỏi/khá/TB/yếu' },
      { name: 'Flashcard AI', nameEn: 'Spaced Repetition', desc: 'Quizlet/Anki + AI: lặp lại ngắt quãng + 3 chế độ học thông minh.', usage: 'Ôn thi, ghi nhớ dài hạn' },
      { name: 'Podcast học tập', nameEn: 'AI Audio Learning (NotebookLM)', desc: 'Upload tài liệu → AI tạo podcast giải thích sinh động.', usage: 'Học qua nghe, ôn bài' },
      { name: 'AI Roleplay', nameEn: 'AI Historical/Scientific Roleplay', desc: 'ChatGPT đóng vai nhân vật lịch sử/khoa học để HS phỏng vấn.', usage: 'Lịch sử, Khoa học, Văn học' },
      { name: 'Bệnh viện tri thức', nameEn: 'AI Learning Clinic', desc: 'AI chẩn đoán lỗi sai của HS, đề xuất bài tập khắc phục cụ thể.', usage: 'Sửa lỗi, bổ trợ cá nhân' },
      { name: 'Thám tử AI', nameEn: 'AI Knowledge Detective', desc: 'AI tạo "vụ án tri thức": manh mối → phá án bằng kiến thức.', usage: 'Game hóa kiểm tra kiến thức' },
      { name: 'Phiên tòa tri thức', nameEn: 'AI Knowledge Court', desc: 'AI làm thẩm phán, HS lập luận bảo vệ quan điểm và bị phản biện.', usage: 'Tư duy phản biện, tranh luận' },
      { name: 'Curipod', nameEn: 'Bài giảng tương tác AI', desc: 'curipod.com: nhập chủ đề → AI tạo slide tương tác + quiz tự động.', usage: 'Tiết kiệm thời gian soạn bài' },
      { name: 'Magic School AI', nameEn: '60+ công cụ AI cho GV', desc: 'magicschool.ai: Lesson Planner, Quiz Maker, Rubric Generator, v.v.', usage: 'Bộ công cụ toàn diện cho GV' },
      { name: 'Thẩm định SKKN với AI', nameEn: 'AI SKKN Review', desc: 'AI phân tích, chấm điểm và đề xuất cải thiện Biện pháp/SKKN.', usage: 'Tự đánh giá SKKN trước nộp' },
    ]
  }
];

interface TeachingMethodsCatalogProps {
  onClose: () => void;
}

const TeachingMethodsCatalog: React.FC<TeachingMethodsCatalogProps> = ({ onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null>('A');

  // Filter
  const filteredGroups = GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item => {
      const q = searchTerm.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.nameEn.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q) ||
        item.usage.toLowerCase().includes(q)
      );
    })
  })).filter(g => g.items.length > 0);

  const totalMethods = GROUPS.reduce((sum, g) => sum + g.items.length, 0);

  const toggleGroup = (id: string) => {
    setExpandedGroup(prev => prev === id ? null : id);
  };

  return (
    <div className="w-full max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl mb-6" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 30%, #0e7490 60%, #06b6d4 100%)' }}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-4 left-8 w-32 h-32 border border-white/30 rounded-full"></div>
          <div className="absolute bottom-2 right-12 w-20 h-20 border border-white/20 rounded-full"></div>
          <div className="absolute top-8 right-32 w-3 h-3 bg-cyan-400 rounded-full animate-pulse"></div>
          <div className="absolute bottom-6 left-40 w-2 h-2 bg-amber-400 rounded-full animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>
        <div className="relative p-6 md:p-8">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-white/15 backdrop-blur-sm rounded-xl flex items-center justify-center border border-white/20">
                  <BookOpen className="w-5 h-5 text-cyan-300" />
                </div>
                <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
                  FULL PHƯƠNG PHÁP / KỸ THUẬT DẠY HỌC
                </h1>
              </div>
              <p className="text-cyan-200/90 text-sm md:text-base mt-1 max-w-2xl">
                Tổng hợp {totalMethods} phương pháp & kỹ thuật dạy học tích cực — từ truyền thống đến AI
              </p>
              <p className="text-cyan-300/60 text-xs mt-2">
                Nguồn: TongHop_KyThuat_DayHoc_v4.docx • Trần Hoài Thanh • Phiên bản 4.0 • 2026
              </p>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap gap-3 mt-5">
            {GROUPS.map(g => (
              <button
                key={g.id}
                onClick={() => { setExpandedGroup(g.id); setSearchTerm(''); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 backdrop-blur-sm rounded-lg text-xs text-white/90 hover:bg-white/20 transition-all border border-white/10 hover:border-white/30 cursor-pointer"
              >
                {g.icon}
                <span className="font-semibold">{g.id}.</span>
                <span className="hidden sm:inline">{g.title}</span>
                <span className="bg-white/20 text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">{g.items.length}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-5">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Tìm kiếm phương pháp, kỹ thuật..."
          className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 text-sm"
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs px-2 py-1 rounded bg-gray-100">
            Xóa
          </button>
        )}
      </div>

      {/* Groups accordion */}
      <div className="space-y-4">
        {filteredGroups.map(group => {
          const isOpen = expandedGroup === group.id || !!searchTerm;
          return (
            <div key={group.id} className={`rounded-2xl border-2 ${group.borderColor} overflow-hidden shadow-sm hover:shadow-md transition-shadow`}>
              {/* Group header */}
              <button
                onClick={() => toggleGroup(group.id)}
                className={`w-full flex items-center justify-between p-4 md:p-5 ${group.bgLight} hover:brightness-95 transition-all`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${group.color} text-white flex items-center justify-center shadow-md`}>
                    {group.icon}
                  </div>
                  <div className="text-left">
                    <h2 className="font-bold text-gray-900 text-base md:text-lg flex items-center gap-2">
                      <span className={`text-xs font-black px-2 py-0.5 rounded-md bg-gradient-to-r ${group.color} text-white`}>
                        {group.id}
                      </span>
                      {group.title}
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">{group.subtitle} • {group.items.length} kỹ thuật</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold text-gray-400 hidden sm:block">{group.items.length} PP/KT</span>
                  {isOpen ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                </div>
              </button>

              {/* Items grid */}
              {isOpen && (
                <div className="p-3 md:p-5 bg-white">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {group.items.map((item, idx) => (
                      <div
                        key={idx}
                        className={`group rounded-xl border ${group.borderColor} p-4 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 ${group.bgLight}/30 hover:${group.bgLight}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${group.color} text-white flex items-center justify-center text-xs font-black shrink-0 shadow-sm`}>
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-gray-900 text-sm leading-snug">{item.name}</h3>
                            <p className="text-[11px] text-gray-400 font-medium">{item.nameEn}</p>
                            <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{item.desc}</p>
                            <div className="mt-2 flex items-start gap-1.5">
                              <Lightbulb className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                              <span className="text-[11px] text-amber-700 font-medium leading-snug">{item.usage}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-xs text-gray-400 pb-6">
        <p>📚 Tổng cộng <strong className="text-gray-600">{totalMethods}</strong> phương pháp & kỹ thuật dạy học tích cực</p>
        <p className="mt-1">Nguồn tham khảo: TongHop_KyThuat_DayHoc_v4.docx — giaovienai.vercel.app</p>
      </div>
    </div>
  );
};

export default TeachingMethodsCatalog;
