/**
 * Converts a number to Thai Baht text (e.g., 897.00 -> แปดร้อยเก้าสิบเจ็ดบาทถ้วน)
 * @param {number|string} num - The amount to convert
 * @returns {string} The Thai Baht text representation
 */
function thaiBahtText(num) {
    if (num === null || num === undefined) return '';
    
    const parsed = parseFloat(num);
    if (isNaN(parsed)) return '';
    
    // Round to 2 decimal places to avoid floating point issues
    const rounded = Math.round(parsed * 100) / 100;
    if (rounded === 0) return 'ศูนย์บาทถ้วน';
    
    const THAI_NUMBERS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
    const THAI_UNITS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];
    
    const parts = rounded.toFixed(2).split('.');
    const bahtPart = parts[0];
    const satangPart = parts[1];
    
    let text = '';
    
    function convertChunk(str) {
        let chunkText = '';
        const len = str.length;
        for (let i = 0; i < len; i++) {
            const digit = parseInt(str[i], 10);
            const pos = len - i - 1;
            if (digit !== 0) {
                if (pos === 0 && digit === 1 && len > 1) {
                    chunkText += 'เอ็ด';
                } else if (pos === 1 && digit === 1) {
                    chunkText += 'สิบ';
                } else if (pos === 1 && digit === 2) {
                    chunkText += 'ยี่สิบ';
                } else {
                    chunkText += THAI_NUMBERS[digit] + THAI_UNITS[pos];
                }
            }
        }
        return chunkText;
    }
    
    // Process millions chunk by chunk
    let bahtStr = bahtPart;
    let millionText = '';
    while (bahtStr.length > 6) {
        const chunk = bahtStr.slice(-6);
        bahtStr = bahtStr.slice(0, -6);
        const chunkConverted = convertChunk(chunk);
        if (chunkConverted) {
            millionText = chunkConverted + 'ล้าน' + millionText;
        } else {
            millionText = 'ล้าน' + millionText;
        }
    }
    const leadingText = convertChunk(bahtStr);
    if (leadingText) {
        text += leadingText + (millionText ? 'ล้าน' + millionText : '');
    } else {
        text += millionText;
    }
    
    if (text) text += 'บาท';
    
    if (satangPart === '00') {
        text += 'ถ้วน';
    } else {
        const satangVal = parseInt(satangPart, 10);
        if (satangVal !== 0) {
            text += convertChunk(satangPart) + 'สตางค์';
        } else {
            text += 'ถ้วน';
        }
    }
    
    return text;
}

module.exports = thaiBahtText;
