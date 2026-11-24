/**
 * Ngân sách độ dài khi người dùng đặt "Số trang Biện pháp cần giới hạn".
 *
 * Mô hình AI không tự đếm trang được, nên app quy đổi trang → số từ, chia số từ theo
 * đúng các phần app thực sự viết, và trước MỖI phần lại tính phần còn lại dựa trên số từ
 * ĐÃ viết thật (phần trước viết lố thì phần sau tự được giao ít hơn).
 */

// 1 trang A4 ≈ 350 từ tiếng Việt (Times New Roman 13–14pt, giãn dòng 1.15–1.5, có tiêu đề/bảng).
// File Word xuất ra (14pt, giãn dòng đơn) chứa được nhiều hơn → để dư một khoảng an toàn.
export const WORDS_PER_PAGE = 350;

export interface BudgetSection {
  key: string;
  label: string;
  weight: number;
}

// Thứ tự đúng như các bước viết trong App: Phần 1 → Phần 2 → Giải pháp → 2.4 → Phần 3 → Phần 4 + TLTK
export const getBudgetSections = (numSolutions: number): BudgetSection[] => {
  const solutionShare = 0.58;
  return [
    { key: 'part1', label: 'Phần 1 – Đặt vấn đề', weight: 0.08 },
    { key: 'part2', label: 'Phần 2 – Cơ sở lý luận & thực tiễn', weight: 0.14 },
    ...Array.from({ length: numSolutions }, (_, i) => ({
      key: `gp${i + 1}`,
      label: `Giải pháp ${i + 1}`,
      weight: solutionShare / numSolutions,
    })),
    { key: 'tinhMoi', label: '2.4 – Tính mới, tính sáng tạo', weight: 0.06 },
    { key: 'phamVi', label: 'Phần 3 – Phạm vi ảnh hưởng, hiệu quả', weight: 0.08 },
    { key: 'ketLuan', label: 'Phần 4 – Kết luận, kiến nghị & TLTK', weight: 0.06 },
  ];
};

// Dòng "khung" do AI sinh ra (menu điều hướng, hộp thoại, đường kẻ) — bị lọc khi xuất Word nên không tính
const isChromeLine = (line: string) =>
  /MENU NAVIGATION|[┌└│━─═╔╚║]|KẾT THÚC GIẢI PHÁP|HƯỚNG DẪN COPY/.test(line) ||
  /Bước\s+\d+.*(Đang thực hiện|Chờ|Hoàn thành|🔵)/.test(line);

export const countWords = (text: string): number => {
  if (!text) return 0;
  return text
    .split('\n')
    .filter(line => !isChromeLine(line))
    .join(' ')
    .replace(/[#*_`>|]/g, ' ')
    .split(/\s+/)
    .filter(w => /[\p{L}\p{N}]/u.test(w)).length;
};

export const estimatePages = (words: number): number => words / WORDS_PER_PAGE;

export const formatPages = (pages: number): string =>
  (Math.round(pages * 10) / 10).toLocaleString('vi-VN');

export interface SectionBudget {
  totalPages: number;
  totalWords: number;
  writtenWords: number;
  remainingWords: number;
  remainingSections: number;
  targetWords: number;
  plannedWords: number;
}

const MIN_SECTION_WORDS = 120;

/** Số từ giao cho một phần, chia lại phần CÒN LẠI theo tỷ trọng của các phần chưa viết. */
export const computeSectionBudget = (
  totalPages: number,
  numSolutions: number,
  sectionKey: string,
  writtenWords: number
): SectionBudget | null => {
  const sections = getBudgetSections(numSolutions);
  const index = sections.findIndex(s => s.key === sectionKey);
  if (index === -1 || totalPages <= 0) return null;

  const totalWords = totalPages * WORDS_PER_PAGE;
  const remaining = sections.slice(index);
  const remainingWeight = remaining.reduce((sum, s) => sum + s.weight, 0);
  const remainingWords = Math.max(0, totalWords - writtenWords);
  const share = sections[index].weight / remainingWeight;

  return {
    totalPages,
    totalWords,
    writtenWords,
    remainingWords,
    remainingSections: remaining.length,
    targetWords: Math.max(MIN_SECTION_WORDS, Math.round((remainingWords * share) / 10) * 10),
    plannedWords: Math.round((totalWords * sections[index].weight) / 10) * 10,
  };
};

/**
 * Xoá các con số độ dài cố định trong prompt mẫu (VD "(3-4 trang)", "(12-15 trang - PHẦN QUAN TRỌNG NHẤT)",
 * "Độ dài: 10-15 trang") — chúng mâu thuẫn và lấn át giới hạn trang người dùng đặt.
 */
export const stripFixedPageHints = (prompt: string): string =>
  prompt
    .replace(/\s*\((?:khoảng|tối đa|~)?\s*\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?\s*trang[^)]*\)/gi, '')
    .replace(/^.*Độ dài:\s*\d+\s*[-–]\s*\d+\s*trang.*$/gim, '');
