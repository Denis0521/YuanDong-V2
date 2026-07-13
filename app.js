'use strict';

// ==================== 您的專屬憑證資訊 ====================
const CLIENT_ID = '130737953356-9t11ein5pe6l7ihvmbnm39jeg9beel9s.apps.googleusercontent.com';
// ============================================================

let tokenClient;
let accessToken = null;
let spreadsheetId = null;
let folderId = null;
const cloudImageData = { fileId1: '', fileId2: '', fileId3: '', fileId4: '' };

// 用於追蹤本機預覽圖片的 ObjectURL，便於適時釋放記憶體，避免瀏覽器崩潰
const localPreviewUrls = { 1: '', 2: '', 3: '', 4: '' };

const $ = (id) => document.getElementById(id);

// ==================== 初始化 ====================
window.addEventListener('load', () => {
    // 註冊 Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('Service Worker 註冊成功'))
            .catch(err => console.error('Service Worker 註冊失敗', err));
    }

    // 檢查並恢復登入狀態
    restoreLoginState();

    // 初始化 Google OAuth
    initGoogleAuth();

    // 綁定座號同步
    $('seatNumber').value = $('ctrlSeat').value;
    $('ctrlSeat').addEventListener('change', function() {
        $('seatNumber').value = this.value;
    });

    // 動態綁定 1~4 號照片欄位的 change 事件
    for (let i = 1; i <= 4; i++) {
        const fileInput = $('file' + i);
        if (fileInput) {
            fileInput.addEventListener('change', (e) => processImage(e, i));
        }
    }

    // 即時標題綁定
    $('studentName').addEventListener('input', updateDocumentTitle);
    
    // 初始化字詞庫首頁
    backToDictHome();
});

// 更新文件標題，確保列印 100% 抓到正確名字
function updateDocumentTitle() {
    const name = $('studentName').value.trim();
    document.title = name ? `${name}_學習區紀錄` : "未命名幼生_學習區紀錄";
}

// 初始化 Google 認證 (加入離線防錯保護)
function initGoogleAuth() {
    if (typeof google === 'undefined') {
        console.warn('Google Auth SDK 未載入（可能處於離線狀態）。');
        return;
    }
    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
            callback: (tokenResponse) => {
                if (tokenResponse.error !== undefined) {
                    alert('認證失敗：' + tokenResponse.error);
                    return;
                }
                accessToken = tokenResponse.access_token;
                saveLoginState();
                updateAuthUI(true);
                alert('登入成功！已成功連接 Google 雲端帳戶。');
            },
        });
    } catch (e) {
        console.error('初始化 Google Auth 失敗', e);
    }
}

function handleAuthClick() {
    if (typeof google === 'undefined' || !tokenClient) {
        alert('目前無法連接 Google 驗證伺服器，請檢查網路連線。本機列印與複製功能仍可正常使用。');
        return;
    }
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleSignoutClick() {
    if (accessToken) {
        google.accounts.oauth2.revoke(accessToken, () => {
            accessToken = null;
            clearLoginState();
            updateAuthUI(false);
            alert('已成功登出。');
        });
    } else {
        clearLoginState();
        updateAuthUI(false);
    }
}

function saveLoginState() {
    localStorage.setItem('g_access_token', accessToken);
    localStorage.setItem('g_token_time', Date.now().toString());
}

function restoreLoginState() {
    const token = localStorage.getItem('g_access_token');
    const time = localStorage.getItem('g_token_time');
    if (token && time) {
        if (Date.now() - parseInt(time) < 3600 * 1000) {
            accessToken = token;
            updateAuthUI(true);
        } else {
            clearLoginState();
        }
    }
}

function clearLoginState() {
    accessToken = null;
    localStorage.removeItem('g_access_token');
    localStorage.removeItem('g_token_time');
}

function updateAuthUI(isLoggedIn) {
    if (isLoggedIn) {
        $('btnSignIn').style.display = 'none';
        $('btnSignOut').style.display = 'inline-block';
    } else {
        $('btnSignIn').style.display = 'inline-block';
        $('btnSignOut').style.display = 'none';
    }
}

// ==================== 圖片處理優化 (防止記憶體洩漏與崩潰) ====================
function processImage(event, index) {
    const file = event.target.files[0];
    if (!file) return;

    const preview = $('preview' + index);
    const loading = $('loading' + index);

    if (loading) loading.style.display = 'flex';

    // 優化點 1：不再將大圖轉成 Base64 大字串，直接利用暫時性 Object URL 載入，極省記憶體
    const tempImgUrl = URL.createObjectURL(file);
    const img = new Image();
    
    img.onload = function() {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;

        if (width > height) {
            if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
            }
        } else {
            if (height > MAX_HEIGHT) {
                width *= MAX_HEIGHT / height;
                height = MAX_HEIGHT;
            }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // 優化點 2：使用二進位 canvas.toBlob() 代替 toDataURL()，避免長字串撐爆效能
        canvas.toBlob((blob) => {
            URL.revokeObjectURL(tempImgUrl); // 釋放原圖暫存

            if (!blob) {
                if (loading) loading.style.display = 'none';
                alert('圖片壓縮失敗');
                return;
            }

            // 優化點 3：清除舊的預覽圖記憶體，避免切換時越疊越卡
            if (localPreviewUrls[index]) {
                URL.revokeObjectURL(localPreviewUrls[index]);
            }

            const previewUrl = URL.createObjectURL(blob);
            localPreviewUrls[index] = previewUrl;
            preview.src = previewUrl;
            preview.style.display = 'block';

            if (loading) loading.style.display = 'none';

            // 若已聯網登入，自動發送上傳
            if (accessToken) {
                const fileName = `seat_${$('seatNumber').value || '00'}_pic_${index}.jpg`;
                uploadImageToDrive(blob, fileName, index);
            }
        }, 'image/jpeg', 0.6);
    };

    img.onerror = function() {
        URL.revokeObjectURL(tempImgUrl);
        if (loading) loading.style.display = 'none';
        alert('無法載入圖片檔案');
    };

    img.src = tempImgUrl;
}

// 上傳圖片到 Google Drive
async function uploadImageToDrive(blob, fileName, index) {
    if (!accessToken) return;
    try {
        if (!folderId) {
            folderId = await getOrCreateFolder('幼兒學習區紀錄_照片庫');
        }

        const metadata = {
            name: fileName,
            parents: [folderId]
        };

        const formData = new FormData();
        formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        formData.append('file', blob);

        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + accessToken },
            body: formData
        });

        if (!response.ok) throw new Error('上傳失敗');
        const result = await response.json();
        cloudImageData['fileId' + index] = result.id;
        console.log(`照片 ${index} 上傳成功，雲端 ID: ${result.id}`);
    } catch (error) {
        console.error(`照片 ${index} 上傳雲端失敗:`, error);
    }
}

async function getOrCreateFolder(folderName) {
    const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`, {
        headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
        return searchData.files[0].id;
    }

    const metadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
    };
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
    });
    const createData = await createRes.json();
    return createData.id;
}

// ==================== 雲端資料試算表同步與主鍵(ID)防錯 ====================
async function cloudSave() {
    if (!accessToken) {
        alert('請先點擊上方按鈕登入 Google 帳戶才能同步至雲端。');
        return;
    }

    try {
        if (!spreadsheetId) {
            spreadsheetId = await getOrCreateSpreadsheet('幼兒學習區紀錄表');
        }

        const data = getFormData();
        
        // 【核心安全性優化】：採用「班級_座號」不重複字串作為唯一主鍵，防止表格排序後的錯位覆蓋
        const uniqueKey = `${data.className}_${data.seatNumber}`;

        const getRes = await fetch(`https://www.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:A`, {
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });
        const getData = await getRes.json();
        const values = getData.values || [];

        let rowIndex = values.findIndex((row) => row[0] == uniqueKey);
        
        const timestamp = new Date().toLocaleString('zh-TW', { hour12: false });
        const rowData = [
            uniqueKey,          // Col A: 唯一主鍵
            data.className,     // Col B
            data.seatNumber,    // Col C
            data.studentName,   // Col d
            data.recordDate,    // Col E
            data.cb1, data.cb2, data.cb3, data.cb4, data.cb5, data.cb6, // Col F ~ K
            data.area1, data.area2, data.area3, data.area4,             // Col L ~ O
            cloudImageData.fileId1, cloudImageData.fileId2, cloudImageData.fileId3, cloudImageData.fileId4, // Col P ~ S
            data.desc1, data.desc2, // Col T ~ U
            timestamp           // Col V: 更新時間
        ];

        if (rowIndex !== -1) {
            const actualRow = rowIndex + 1;
            const updateRes = await fetch(`https://www.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A${actualRow}:V${actualRow}?valueInputOption=USER_ENTERED`, {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer ' + accessToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ values: [rowData] })
            });
            if (!updateRes.ok) throw new Error('更新雲端資料失敗');
            alert(`成功！已更新 ${data.studentName} 的雲端觀察紀錄。`);
        } else {
            const appendRes = await fetch(`https://www.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + accessToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ values: [rowData] })
            });
            if (!appendRes.ok) throw new Error('寫入新資料失敗');
            alert(`成功！已為 ${data.studentName} 新增一筆雲端觀察紀錄。`);
        }
    } catch (error) {
        console.error('雲端儲存發生錯誤:', error);
        alert('同步失敗，請檢查網路或重新登入。錯誤原因：' + error.message);
    }
}

async function getOrCreateSpreadsheet(title) {
    const q = `name='${title}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`, {
        headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
        return searchData.files[0].id;
    }

    const resource = {
        properties: { title: title },
        sheets: [{
            properties: {
                title: '紀錄總表',
                gridProperties: { frozenRowCount: 1 }
            }
        }]
    };
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(resource)
    });
    const createData = await createRes.json();
    const newId = createData.spreadsheetId;

    const header = [
        ["唯一ID", "班級", "座號", "姓名", "日期", "美勞區", "語文區", "益智區", "積木區", "扮演區", "體能區", "美勞紀錄", "語文紀錄", "益智紀錄", "積木紀錄", "照片1_ID", "照片2_ID", "照片3_ID", "照片4_ID", "照片說明1", "照片說明2", "最後更新時間"]
    ];
    await fetch(`https://www.googleapis.com/v4/spreadsheets/${newId}/values/A1:V1?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: header })
    });

    return newId;
}

async function cloudLoad() {
    if (!accessToken) {
        alert('請先登入 Google 帳戶。');
        return;
    }
    const targetClass = $('ctrlClass').value;
    const targetSeat = $('ctrlSeat').value;
    const searchKey = `${targetClass}_${targetSeat}`;

    try {
        if (!spreadsheetId) {
            spreadsheetId = await getOrCreateSpreadsheet('幼兒學習區紀錄表');
        }

        const getRes = await fetch(`https://www.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:V`, {
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });
        const getData = await getRes.json();
        const values = getData.values || [];

        const row = values.find(r => r[0] == searchKey);
        if (!row) {
            alert(`找不到班級【${targetClass}】座號【${targetSeat}】的雲端紀錄。`);
            return;
        }

        $('className').value = row[1] || '';
        $('seatNumber').value = row[2] || '';
        $('studentName').value = row[3] || '';
        $('recordDate').value = row[4] || '';

        for (let i = 1; i <= 6; i++) {
            $('cb' + i).checked = (row[4 + i] === 'true' || row[4 + i] === true);
        }

        $('area1').value = row[11] || '';
        $('area2').value = row[12] || '';
        $('area3').value = row[13] || '';
        $('area4').value = row[14] || '';

        clearImagesUI();
        for (let i = 1; i <= 4; i++) {
            const fileId = row[14 + i];
            cloudImageData['fileId' + i] = fileId || '';
            if (fileId) {
                loadCloudImageToPreview(fileId, i);
            }
        }

        $('desc1').value = row[19] || '';
        $('desc2').value = row[20] || '';

        updateDocumentTitle();
        alert(`已成功載入 ${row[3]} 的觀察紀錄！`);
    } catch (error) {
        console.error('雲端載入失敗:', error);
        alert('載入失敗：' + error.message);
    }
}

async function loadCloudImageToPreview(fileId, index) {
    const preview = $('preview' + index);
    const loading = $('loading' + index);
    if (loading) loading.style.display = 'flex';

    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });
        if (!res.ok) throw new Error('相片檔案下載失敗');
        const blob = await res.blob();

        if (localPreviewUrls[index]) {
            URL.revokeObjectURL(localPreviewUrls[index]);
        }

        const url = URL.createObjectURL(blob);
        localPreviewUrls[index] = url;
        preview.src = url;
        preview.style.display = 'block';
    } catch (e) {
        console.error(`下載雲端相片 ${index} 失敗:`, e);
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

// ==================== 表單輔助邏輯 ====================
function getFormData() {
    let rawDate = $('recordDate').value;
    if (rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
            rawDate = d.toISOString().split('T')[0]; // 規範化格式 YYYY-MM-DD
        }
    }

    return {
        className: $('className').value,
        seatNumber: $('seatNumber').value,
        studentName: $('studentName').value,
        recordDate: rawDate,
        cb1: $('cb1').checked,
        cb2: $('cb2').checked,
        cb3: $('cb3').checked,
        cb4: $('cb4').checked,
        cb5: $('cb5').checked,
        cb6: $('cb6').checked,
        area1: $('area1').value,
        area2: $('area2').value,
        area3: $('area3').value,
        area4: $('area4').value,
        desc1: $('desc1').value,
        desc2: $('desc2').value
    };
}

function clearForm() {
    if (!confirm('確定要清空全表單欄位嗎？（本機畫面將被重置，不會刪除雲端現存資料）')) return;
    $('studentName').value = '';
    for (let i = 1; i <= 6; i++) $('cb' + i).checked = false;
    $('area1').value = ''; $('area2').value = ''; $('area3').value = ''; $('area4').value = '';
    $('desc1').value = ''; $('desc2').value = '';
    clearImagesUI();
    updateDocumentTitle();
}

function clearImagesUI() {
    for (let i = 1; i <= 4; i++) {
        const preview = $('preview' + i);
        if (preview) {
            preview.src = '';
            preview.style.display = 'none';
        }
        const fileInput = $('file' + i);
        if (fileInput) fileInput.value = '';
        
        if (localPreviewUrls[i]) {
            URL.revokeObjectURL(localPreviewUrls[i]);
            localPreviewUrls[i] = '';
        }
        cloudImageData['fileId' + i] = '';
    }
}

// ==================== 完整字詞庫複製系統 ====================
const phraseDict = {
    '美勞區': {
        '繪畫與色彩': ['能運用豐富且飽和的色彩填滿畫面。', '嘗試混色，發現顏色變化的樂趣。', '能畫出具體的人物結構與背景線條。', '對線條勾勒非常有耐心，構圖完整。'],
        '剪貼與小肌肉': ['手部精細動作發展良好，剪紙流暢。', '能沿著複雜線條剪下圖形，準確度高。', '正確使用雙面膠與白膠進行立體黏貼。', '喜歡嘗試撕貼畫，展現高度手眼協調。'],
        '立體與複合媒材': ['能專注完成複合媒材與資源回收物創作。', '善用摺紙技巧與紙捲，搭建有創意的立體造型。', '對陶土與輕黏土捏塑極具想法與塑形力。']
    },
    '語文區': {
        '閱讀理解': ['熱衷閱讀繪本，能清楚指認故事主要角色。', '能主動向老師或同儕完整講述繪本情節。', '專注聆聽有聲書，並對插圖細節提出提問。', '展現良好的翻書習慣，能愛惜書本。'],
        '前書寫與符號': ['嘗試仿寫或拼寫自己的名字，字形辨識度高。', '對注音符號具備高敏感度，喜歡進行拼音配對。', '能自行創作小書，並用圖畫表達文字涵義。']
    },
    '益智區': {
        '邏輯推理與拼圖': ['能獨立且快速完成30片以上的序列拼圖。', '具備良好的空間幾何概念，圖形配對清晰。', '在數獨與邏輯矩陣遊戲中展現敏銳觀察力。'],
        '數學與操作': ['能正確進行1-20的點數與實物數量配對。', '面對高難度挑戰（如九連環或迷宮）具高專注力。', '能依照規律卡完成複雜的顏色與形狀序列。']
    },
    '積木區': {
        '空間建構與平衡': ['建構作品具備完美的對稱性與高度空間立體感。', '展現優異的重力平衡拿捏，城堡骨架穩固。', '能熟練運用各種特殊造型配件為建築裝飾。'],
        '團隊合作與表達': ['能主動與同儕分工合作搭建大型港口或城堡。', '搭建遇到倒塌時能冷靜調整，極具挫折容忍度。', '完成後能有條理地向大家介紹建築的動線與功能。']
    }
};

let currentTargetTextareaId = null;

function openDictModal(textareaId, categoryTitle) {
    currentTargetTextareaId = textareaId;
    $('dictCategoryTitle').innerText = categoryTitle;
    backToDictHome();
    $('dictModal').style.display = 'flex';
}

function closeDictModal() {
    $('dictModal').style.display = 'none';
    currentTargetTextareaId = null;
}

function backToDictHome() {
    const container = $('phraseListContainer');
    container.innerHTML = '';
    
    // 隱藏返回按鈕
    if ($('btnBackToHome')) $('btnBackToHome').style.display = 'none';

    const category = $('dictCategoryTitle').innerText;
    const subCategories = phraseDict[category];

    if (!subCategories) {
        container.innerHTML = '<div>暫無該區域詞庫資料</div>';
        return;
    }

    // 列出子分類按鈕
    Object.keys(subCategories).forEach(subCat => {
        const item = document.createElement('div');
        item.className = 'phrase-item';
        item.style.fontWeight = 'bold';
        item.style.color = 'var(--primary-blue)';
        item.innerText = '📁 ' + subCat;
        item.onclick = () => showSubCategoryPhrases(subCat);
        container.appendChild(item);
    });
}

function showSubCategoryPhrases(subCat) {
    const container = $('phraseListContainer');
    container.innerHTML = '';
    
    // 顯示返回按鈕
    if ($('btnBackToHome')) $('btnBackToHome').style.display = 'inline-block';

    const category = $('dictCategoryTitle').innerText;
    const phrases = phraseDict[category][subCat] || [];

    phrases.forEach(text => {
        const item = document.createElement('div');
        item.className = 'phrase-item';
        item.innerText = text;
        item.onclick = () => {
            copyTextToClipboard(text);
            closeDictModal();
        };
        container.appendChild(item);
    });
}

function copyTextToClipboard(text) {
    if (currentTargetTextareaId) {
        const txtArea = $(currentTargetTextareaId);
        if (txtArea) {
            const oldVal = txtArea.value;
            txtArea.value = oldVal ? oldVal + '\n' + text : text;
            txtArea.focus();
        }
    }
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showToast).catch(err => console.error(err));
    } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast();
    }
}

function showToast() {
    const toast = $('copyToast');
    if (toast) {
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2000);
    }
}

// ==================== 列印與 PDF 輸出 ====================
function printToPDF() {
    const studentName = $('studentName').value.trim();
    document.title = studentName ? `${studentName}_學習區紀錄` : "未命名幼生_學習區紀錄";
    setTimeout(() => { window.print(); }, 500);
}

// ==================== 相片來源選擇邏輯 ====================
let currentPhotoIndex = null;

function openPhotoSourceModal(index) {
    currentPhotoIndex = index;
    $('photoSourceModal').style.display = 'flex';
}

function closePhotoSourceModal() {
    $('photoSourceModal').style.display = 'none';
    currentPhotoIndex = null;
}

function selectPhotoSource(source) {
    if (!currentPhotoIndex) return;
    
    const fileInput = $('file' + currentPhotoIndex);
    if (!fileInput) return;

    if (source === 'camera') {
        fileInput.removeAttribute('multiple');
        fileInput.setAttribute('capture', 'environment'); // iOS/Android 強制開啟後鏡頭
    } else {
        fileInput.removeAttribute('capture');
    }
    
    closePhotoSourceModal();
    fileInput.click();
}
