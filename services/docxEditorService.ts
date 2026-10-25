import JSZip from 'jszip';
import { ThinkingLevel } from '@google/genai';
import { SYSTEM_INSTRUCTION } from '../constants';
import { generateContentWithModelFallback } from './geminiService';
import { AiProvider } from '../types';

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// Hàm xử lý chuỗi XML an toàn
function escapeXml(unsafe: string) {
    return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
        return c;
    });
}

// Tạo thẻ w:r bôi đỏ
function createRedRunElement(xmlDoc: Document, text: string): Node {
    const escapedText = escapeXml(text);
    const tempXml = `<w:r xmlns:w="${W_NS}">
        <w:rPr><w:color w:val="FF0000"/><w:i/></w:rPr>
        <w:t xml:space="preserve">${escapedText}</w:t>
    </w:r>`;
    const tempDoc = new DOMParser().parseFromString(tempXml, "application/xml");
    return xmlDoc.importNode(tempDoc.documentElement, true);
}

// Gửi một mảng text sang AI
async function rewriteTextBatch(apiKey: string, selectedModel: string, items: { [key: string]: string }, aiReductionPrompt?: string, provider?: AiProvider) {
    const prompt = `Bạn là chuyên gia thẩm định và viết Sáng kiến kinh nghiệm, biện pháp GVG/GVCN chuyên nghiệp.
Nhiệm vụ: CẢI THIỆN các đoạn văn bản dưới đây thành một phiên bản học thuật, khoa học, thực tế và thuyết phục hơn.
- KHÔNG gộp các đoạn lại với nhau. Giữ nguyên số lượng đoạn.
- Trả về đúng định dạng JSON mà key là số như đầu vào, value là nội dung sau khi viết lại.
- Dùng ngữ điệu khách quan, dùng từ ngữ chuyên môn giáo dục.
- BẮT BUỘC TRẢ VỀ JSON THUẦN!
${aiReductionPrompt || ''}

Dữ liệu gốc:
${JSON.stringify(items, null, 2)}
`;
    
    const response = await generateContentWithModelFallback({
        apiKey,
        selectedModel,
        provider,
        contents: prompt,
        thinkingLevel: ThinkingLevel.MEDIUM,
        config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            maxOutputTokens: 16384
        },
        logLabel: 'Rewrite DOCX batch'
    });

    let jsonText = response.text || '';
    if (jsonText.includes('```json')) {
        jsonText = jsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/,'');
    }

    const match = jsonText.match(/\{[\s\S]*\}/);
    if (match) {
        return JSON.parse(match[0]);
    }
    return JSON.parse(jsonText);
}

// Tạo prompt yêu cầu viết lại cho rõ ràng, mạch lạc, đúng văn phong học thuật.
// KHÔNG nhắm tới việc né bộ phát hiện AI hay đặt ngưỡng % — mục tiêu duy nhất là chất lượng văn bản.
function buildClarityImprovementPrompt(analysisResult?: any): string {
    if (!analysisResult) return '';

    const recommendations = (analysisResult.aiRiskDetails?.recommendations || []).slice(0, 5);
    const recommendationsList = recommendations.length > 0
        ? recommendations.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n')
        : '';

    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✍️ YÊU CẦU VIẾT LẠI RÕ RÀNG, MẠCH LẠC, TỰ NHIÊN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hãy viết lại các đoạn dưới đây để:
- Giọng văn tự nhiên như một giáo viên chia sẻ kinh nghiệm thực tế của chính mình, có suy nghĩ, quan sát cá nhân.
- Đa dạng độ dài câu và cấu trúc câu, tránh lặp từ/cụm từ sáo rỗng.
- Giữ nguyên số liệu, tên riêng, trích dẫn pháp lý — KHÔNG tự thêm hoặc chỉnh số liệu.
${recommendationsList ? `\nGợi ý cải thiện từ bước thẩm định:\n${recommendationsList}` : ''}

⚠️ KHÔNG hướng tới việc "vượt qua" bất kỳ công cụ phát hiện AI nào, không đặt mục tiêu theo phần trăm điểm số. Chỉ tập trung vào việc văn bản rõ ràng, mạch lạc và trung thực.
`;
}

export async function processDocxFile(
    file: File,
    apiKey: string,
    selectedModel: string,
    onProgress: (percent: number, message: string) => void,
    analysisResult?: any,
    provider?: AiProvider
): Promise<{ blob: Blob; failedBatches: number; totalBatches: number }> {
    const clarityPrompt = buildClarityImprovementPrompt(analysisResult);
    onProgress(5, "Đang mở file tài liệu gốc...");
    
    // Đọc array buffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Tải vào JSZip
    const zip = new JSZip();
    await zip.loadAsync(arrayBuffer);
    
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) {
        throw new Error("Không tìm thấy tệp word/document.xml. Đây có thể không phải file docx chuẩn.");
    }
    
    const xmlContent = await docXmlFile.async("text");
    const xmlDoc = new DOMParser().parseFromString(xmlContent, "application/xml");
    
    onProgress(15, "Đang trích xuất các đoạn văn...");
    const paragraphs = Array.from(xmlDoc.getElementsByTagName("w:p"));
    
    const targetParagraphs: { pNode: Element, text: string }[] = [];
    
    // Trích xuất text
    paragraphs.forEach((p) => {
        let text = '';
        const texts = p.getElementsByTagName("w:t");
        for (let i = 0; i < texts.length; i++) {
            text += texts[i].textContent || '';
        }
        text = text.trim();
        // Lọc đi các đoạn quá ngắn hoặc dường như là heading ngắn
        if (text.length > 50 && !text.toUpperCase().includes('BẢNG') && !text.toUpperCase().includes('HÌNH')) {
            targetParagraphs.push({ pNode: p, text: text });
        }
    });

    if (targetParagraphs.length === 0) {
        throw new Error("Không tìm thấy đoạn văn nào phù hợp để cải thiện trong file (nội dung quá ngắn).");
    }

    onProgress(20, `Tìm thấy ${targetParagraphs.length} đoạn văn. Bắt đầu xử lý AI...`);

    // Xử lý theo từng lô (Batching)
    const BATCH_SIZE = 5; 
    let completed = 0;
    const totalBatches = Math.ceil(targetParagraphs.length / BATCH_SIZE);
    let failedBatches = 0;
    
    for (let i = 0; i < targetParagraphs.length; i += BATCH_SIZE) {
        const batch = targetParagraphs.slice(i, i + BATCH_SIZE);
        const payload: { [key: string]: string } = {};
        
        batch.forEach((nodeObj, idx) => {
            payload[(i + idx).toString()] = nodeObj.text;
        });
        
        try {
            const rewrittenObj = await rewriteTextBatch(apiKey, selectedModel, payload, clarityPrompt, provider);
            
            // Tiến hành thay thế trong DOM
            Object.keys(rewrittenObj).forEach(key => {
                const globalIdx = parseInt(key);
                // Đảm bảo globalIdx hợp lệ và AI trả về text khác so với ban đầu
                if (!isNaN(globalIdx) && globalIdx < targetParagraphs.length) {
                    const rewrittenText = rewrittenObj[key];
                    const targetNode = targetParagraphs[globalIdx].pNode;
                    
                    if (rewrittenText && rewrittenText.length > 20 && rewrittenText !== targetParagraphs[globalIdx].text) {
                        // Bước 1: xoá toàn bộ thẻ w:t bên trong pNode này để clear chữ cũ
                        const texts = targetNode.getElementsByTagName("w:t");
                        // Gỡ từng cái từ dưới lên
                        for (let k = texts.length - 1; k >= 0; k--) {
                            texts[k].parentNode?.removeChild(texts[k]);
                        }
                        
                        // Bước 2: Thêm thẻ w:r màu đỏ + chữ mới vào
                        const redRun = createRedRunElement(xmlDoc, rewrittenText);
                        targetNode.appendChild(redRun);
                    }
                }
            });
        } catch (error) {
            // Không âm thầm bỏ qua: đếm số lô lỗi để báo rõ cho người dùng ở cuối quá trình,
            // vì phần văn bản tương ứng sẽ KHÔNG được cải thiện (xem P1.7 trong báo cáo rà soát).
            failedBatches++;
            console.error(`Lỗi khi xử lý batch (đoạn ${i + 1}-${Math.min(i + BATCH_SIZE, targetParagraphs.length)}):`, error);
        }
        
        completed += batch.length;
        const p = 20 + Math.round((completed / targetParagraphs.length) * 60);
        onProgress(p, `Đã cải thiện ${completed} / ${targetParagraphs.length} đoạn...`);
    }
    
    onProgress(85, "Đang đóng gói lại file DOCX...");
    
    // Ghi lại XML
    const serializer = new XMLSerializer();
    const newXmlContent = serializer.serializeToString(xmlDoc);
    
    zip.file("word/document.xml", newXmlContent);
    
    // Xuất Blob DOCX
    const blob = await zip.generateAsync({ type: "blob" });
    if (failedBatches > 0) {
        onProgress(100, `Hoàn tất, nhưng ${failedBatches}/${totalBatches} lô xử lý bị lỗi — một số đoạn chưa được cải thiện.`);
    } else {
        onProgress(100, "Hoàn tất!");
    }
    return { blob, failedBatches, totalBatches };
}
