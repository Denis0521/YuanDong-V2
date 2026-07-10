'use strict';

// ==================== 您的專屬憑證資訊 ====================
const CLIENT_ID = '130737953356-9t11ein5pe6l7ihvmbnm39jeg9beel9s.apps.googleusercontent.com';
// ============================================================

// 狀態集中管理 (優化全域變數)
const AppState = {
    tokenClient: null,
    accessToken: null,
    spreadsheetId: null,
    folderId: null,
    cloudImageData: { fileId1: '', fileId2: '', fileId3: '', fileId4: '' }
};

// DOM 快取工具 (提升效能)
const $ = (id) => document.getElementById(id);

// 初始化事件
window.addEventListener('load', () => {
    initServiceWorker();
    checkAndRestoreToken();
    waitForGoogleSDK();
    bindEvents();
});

function initServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('Service Worker 註冊成功'))
            .catch(err => console.error('Service Worker 註冊失敗', err));
    }
}

function checkAndRestoreToken() {
    const savedToken = localStorage.getItem('g_token');
    const expireTime = localStorage.getItem('g_expire');
    const now = new Date().getTime();

    // 提早 5 分鐘 (300000ms) 判定過期，避免 API 呼叫到一半失效
    if (savedToken && expireTime && now < (parseInt(expireTime) - 300000)) {
        AppState.accessToken = savedToken;
        updateLoginBtnState('🟢 自動連線中', '#34a853');
        
        showLoading('🚀 偵測到有效憑證，正在連接雲端資料庫...');
        initEnvironment().then(() => {
            updateLoginBtnState('🟢 已連線雲端', '#34a853');
        });
    } else {
        clearAuthData();
    }
}

// 【優化】確保 Google SDK 確實載入完成
function waitForGoogleSDK() {
    if (typeof google !== 'undefined' && google.accounts) {
        initGoogleClient();
    } else {
        setTimeout(waitForGoogleSDK, 500); // 每 0.5 秒檢查一次
    }
}

function initGoogleClient() {
    AppState.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
        prompt: '', 
        callback: async (tokenResponse) => {
            if (tokenResponse.error) {
                alert('❌ Google 授權失敗：' + tokenResponse.error);
                return;
            }
            AppState.accessToken = tokenResponse.access_token;
            
            const expiresIn = tokenResponse.expires_in || 3599;
            const newExpireTime = new Date().getTime() + (expiresIn * 1000);
            localStorage.setItem('g_token', AppState.accessToken);
            localStorage.setItem('g_expire', newExpireTime);
            
            updateLoginBtnState('🟢 已連線雲端', '#34a853');
            
            showLoading('🚀 正在初始化個人雲端資料庫...');
            await initEnvironment();
        },
    });
}

function bindEvents() {
    const ctrlSeat = $('ctrlSeat');
    const seatNumber = $('seatNumber');
    const studentName = $('studentName');

    seatNumber.value = ctrlSeat.value;
    ctrlSeat.addEventListener('change', function() {
        seatNumber.value = this.value;
    });

    studentName.addEventListener('input', function() {
        const name = this.value.trim();
        document.title = name ? `${name}_學習區紀錄` : '未命名幼生_學習區紀錄';
    });
}

function handleAuthClick() {
    if (AppState.tokenClient) {
        AppState.tokenClient.requestAccessToken();
    } else {
        alert('⏳ Google 服務仍在載入中，請稍候再試。');
    }
}

function updateLoginBtnState(text, bgColor) {
    const loginBtn = $('loginBtn');
    loginBtn.innerText = text;
    loginBtn.style.backgroundColor = bgColor;
}

function clearAuthData() {
    localStorage.removeItem('g_token');
    localStorage.removeItem('g_expire');
    AppState.accessToken = null;
    updateLoginBtnState('🔵 Google 登入', 'rgba(66, 133, 244, 0.25)');
}

// 【優化】加入 Timeout 與自動重試機制，徹底解決卡頓與連線失敗問題
async function fetchGoogleAPI(url, options = {}, retries = 2) {
    if (!AppState.accessToken) {
        hideLoading();
        alert('⚠️ 請先完成「Google 帳號登入」授權！');
        throw new Error('未獲得權限');
    }
    
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${AppState.accessToken}`;
    
    // 設定 10 秒超時
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    options.signal = controller.signal;

    try {
        const response = await fetch(url, options);
        clearTimeout(timeoutId);

        if (!response.ok) {
            if (response.status === 401) {
                clearAuthData();
                alert('⚠️ 您的 Google 登入憑證已過期，請重新登入！');
                throw new Error('Token Expired');
            }
            throw new Error(`狀態碼: ${response.status}`);
        }
        return response.json();
    } catch (err) {
        clearTimeout(timeoutId);
        // 如果不是憑證過期，且還有重試次數，則等待 1 秒後重試
        if (retries > 0 && err.message !== 'Token Expired') {
            console.warn(`API 連線不穩，正在進行第 ${3 - retries} 次重試...`, err.name);
            await new Promise(r => setTimeout(r, 1000));
            return fetchGoogleAPI(url, options, retries - 1);
        }
        console.error('API Error details:', err);
        throw err;
    }
}

async function initEnvironment() {
    try {
        // 【優化】加入 fields 參數，大幅減少傳輸資料量，加快載入速度
        const qSheet = "name='幼兒學習區紀錄資料庫' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
        const qFolder = "name='幼兒相片雲端備份庫' and mimeType='application/vnd.google-apps.folder' and trashed=false";
        
        const [sheetSearch, folderSearch] = await Promise.all([
            fetchGoogleAPI(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qSheet)}&spaces=drive&fields=files(id,name)`),
            fetchGoogleAPI(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qFolder)}&spaces=drive&fields=files(id,name)`)
        ]);
        
        if (sheetSearch.files && sheetSearch.files.length > 0) {
            AppState.spreadsheetId = sheetSearch.files[0].id;
        } else {
            const createSheet = await fetchGoogleAPI('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '幼兒學習區紀錄資料庫', mimeType: 'application/vnd.google-apps.spreadsheet' })
            });
            AppState.spreadsheetId = createSheet.id;
            await fetchGoogleAPI(`https://sheets.googleapis.com/v4/spreadsheets/${AppState.spreadsheetId}/values/A1:E1?valueInputOption=USER_ENTERED`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ values: [["座號", "班級", "姓名", "最後更新時間", "資料備註"]] })
            });
        }

        if (folderSearch.files && folderSearch.files.length > 0) {
            AppState.folderId = folderSearch.files[0].id;
        } else {
            const createFolder = await fetchGoogleAPI('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '幼兒相片雲端備份庫', mimeType: 'application/vnd.google-apps.folder' })
            });
            AppState.folderId = createFolder.id;
        }
        hideLoading();
    } catch (err) {
        hideLoading();
        alert('❌ 初始化個人雲端空間失敗，請重試：' + err.message);
    }
}

const readImageFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
});

const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
});

async function processImage(event, index) {
    const file = event.target.files[0];
    if (!file) return;
    
    const seatNum = $('ctrlSeat').value || '未知';
    const stuName = $('studentName').value || '未命名';
    const className = $('className').value || '無班級';
    const fileName = `${className}_${seatNum}號_${stuName}_區${index}.jpg`;

    showLoading('📸 正在壓縮圖片並上傳至雲端...');
    
    try {
        const dataSrc = await readImageFile(file);
        const img = await loadImage(dataSrc);
        
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 600; 
        let { width, height } = img;
        
        if (width > height && width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
        } else if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // 降低一點畫質以加快傳輸，不影響 A4 列印
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        const imgEl = $('img' + index);
        imgEl.src = dataUrl;
        imgEl.style.display = 'block';
        
        $('ph' + index).style.display = 'none';
        $('del' + index).style.display = 'block';
        
        canvas.width = 0; canvas.height = 0;

        const response = await fetch(dataUrl);
        const blob = await response.blob();
        
        await uploadImageToDrive(blob, fileName, index);
    } catch (err) {
        hideLoading();
        alert('❌ 圖片處理失敗：' + err.message);
    }
}

async function uploadImageToDrive(blob, filename, imgIndex) {
    try {
        if (!AppState.folderId) await initEnvironment();
        
        const metadata = { name: filename, parents: [AppState.folderId], mimeType: 'image/jpeg' };
        const formData = new FormData();
        formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        formData.append('file', blob);
        
        // 上傳檔案屬於大型請求，直接使用 fetch，避免與一般 API 共用 Timeout 機制
        const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AppState.accessToken}` },
            body: formData
        });
        
        if (!uploadResponse.ok) throw new Error('雲端上傳失敗');
        const fileData = await uploadResponse.json();
        
        AppState.cloudImageData['fileId' + imgIndex] = fileData.id;
        hideLoading();
    } catch (err) {
        hideLoading();
        alert('❌ 圖片儲存至雲端失敗：' + err.message);
    }
}

async function removeImage(index, event) {
    event.preventDefault();
    event.stopPropagation();
    const fileId = AppState.cloudImageData['fileId' + index];
    
    if (fileId) {
        if (!confirm('確定要移除這張照片嗎？(將同時從 Google 雲端硬碟永久刪除)')) return;
        showLoading('🗑️ 正在從雲端刪除照片...');
        try {
            await fetchGoogleAPI(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' });
        } catch(e) { console.warn('檔案可能已不在雲端', e); }
        hideLoading();
    }
    
    const imgEl = $('img' + index);
    imgEl.src = '';
    imgEl.style.display = 'none';
    $('del' + index).style.display = 'none';
    $('ph' + index).style.display = 'block';
    $('ph' + index).innerText = `輕觸上傳相片 (區${index})`;
    $('file' + index).value = '';
    AppState.cloudImageData['fileId' + index] = '';
}

function getFormData() {
    const data = {
        year: $('year').value, term: $('term').value,
        className: $('className').value, studentName: $('studentName').value,
        seatNumber: $('ctrlSeat').value, recordDate: $('recordDate').value,
        cb1: $('cb1').checked, cb2: $('cb2').checked,
        cb3: $('cb3').checked, cb4: $('cb4').checked,
        cb5: $('cb5').checked, cb6: $('cb6').checked,
        teacherName: $('teacherName').value,
    };
    for(let i = 1; i <= 4; i++) {
        data['pd' + i] = $('pd' + i).value;
        data['pdesc' + i] = $('pdesc' + i).value;
        data['pab' + i] = $('pab' + i).value;
        data['fileId' + i] = AppState.cloudImageData['fileId' + i];
    }
    return data;
}

async function cloudSave() {
    const data = getFormData();
    if (!data.seatNumber || !data.studentName) { 
        alert("⚠️ 儲存前請務必填寫「座號」與「幼生姓名」！"); 
        return; 
    }
    
    showLoading("🚀 正在儲存資料至個人雲端試算表...");
    try {
        if (!AppState.spreadsheetId) await initEnvironment();
        const readRes = await fetchGoogleAPI(`https://sheets.googleapis.com/v4/spreadsheets/${AppState.spreadsheetId}/values/A:E`);
        const values = readRes.values || [];
        
        const rowIndex = values.findIndex((row, idx) => idx > 0 && row[0] == data.seatNumber);
        const actualRow = rowIndex > -1 ? rowIndex + 1 : -1;
        
        const jsonStr = JSON.stringify(data);
        const rowData = [ data.seatNumber, data.className, data.studentName, new Date().toLocaleString(), jsonStr ];
        
        const apiOpts = {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [rowData] })
        };
        
        if (actualRow > -1) {
            apiOpts.method = 'PUT';
            await fetchGoogleAPI(`https://sheets.googleapis.com/v4/spreadsheets/${AppState.spreadsheetId}/values/A${actualRow}:E${actualRow}?valueInputOption=USER_ENTERED`, apiOpts);
        } else {
            apiOpts.method = 'POST';
            await fetchGoogleAPI(`https://sheets.googleapis.com/v4/spreadsheets/${AppState.spreadsheetId}/values/A:E:append?valueInputOption=USER_ENTERED`, apiOpts);
        }
        hideLoading();
        alert(`✅ 座號 ${data.seatNumber} 號 (${data.studentName}) 的紀錄已安全存入您的雲端硬碟！`);
    } catch (err) { 
        hideLoading(); 
        alert("❌ 儲存失敗：" + err.message); 
    }
}

async function cloudLoad() {
    const targetSeat = $('ctrlSeat').value.trim();
    if (!targetSeat) { alert("請輸入想要下載的座號"); return; }
    
    $('seatNumber').value = targetSeat;
    showLoading(`📥 正在從您的雲端讀取第 ${targetSeat} 號的紀錄與相片...`);
    
    try {
        if (!AppState.spreadsheetId) await initEnvironment();
        const readRes = await fetchGoogleAPI(`https://sheets.googleapis.com/v4/spreadsheets/${AppState.spreadsheetId}/values/A:E`);
        const values = readRes.values || [];
        
        const targetRow = values.find(row => row[0] == targetSeat);
        if (!targetRow || !targetRow[4]) {
            hideLoading(); 
            alert(`您的雲端庫中尚未建立 ${targetSeat} 號的資料。`); 
            return; 
        }
        
        const targetData = JSON.parse(targetRow[4]);
        
        const fields = ['year', 'term', 'className', 'teacherName', 'studentName', 'recordDate'];
        fields.forEach(f => { if(targetData[f] !== undefined) $(f).value = targetData[f]; });
        for(let c=1; c<=6; c++) $('cb'+c).checked = targetData['cb'+c] || false;
        
        // 使用 Promise.all 併發處理圖片下載，大幅提升載入多張照片的速度
        const photoPromises = [];
        
        for(let i=1; i<=4; i++) {
            $('pd'+i).value = targetData['pd'+i] || ''; 
            $('pdesc'+i).value = targetData['pdesc'+i] || ''; 
            $('pab'+i).value = targetData['pab'+i] || '';
            
            const fileId = targetData['fileId' + i];
            const imgEl = $('img' + i); 
            const phEl = $('ph' + i); 
            const delEl = $('del' + i);
            
            if (fileId) {
                const loadPhoto = async () => {
                    try {
                        const mediaResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { 
                            headers: { 'Authorization': `Bearer ${AppState.accessToken}` } 
                        });
                        if (!mediaResponse.ok) throw new Error();
                        const blob = await mediaResponse.blob();
                        imgEl.src = URL.createObjectURL(blob); 
                        imgEl.style.display = 'block'; 
                        phEl.style.display = 'none'; 
                        delEl.style.display = 'block';
                        AppState.cloudImageData['fileId' + i] = fileId;
                    } catch (e) {
                        imgEl.src = ''; imgEl.style.display = 'none'; 
                        phEl.innerText = '⚠️ 相片讀取失敗'; phEl.style.display = 'block'; 
                        delEl.style.display = 'none';
                        AppState.cloudImageData['fileId' + i] = '';
                    }
                };
                photoPromises.push(loadPhoto());
            } else {
                imgEl.src = ''; imgEl.style.display = 'none'; 
                phEl.innerText = `輕觸上傳相片 (區${i})`; phEl.style.display = 'block'; 
                delEl.style.display = 'none'; 
                AppState.cloudImageData['fileId' + i] = '';
            }
        }
        
        // 等待所有照片加載完成
        if (photoPromises.length > 0) {
            await Promise.all(photoPromises);
        }
        
        const name = $('studentName').value.trim();
        document.title = name ? `${name}_學習區紀錄` : '未命名幼生_學習區紀錄';
        
        hideLoading();
    } catch (err) { 
        hideLoading(); 
        alert("❌ 載入失敗：" + err.message); 
    }
}

function clearForm() {
    if(confirm('⚠️ 確定要清除目前畫面上輸入的所有文字與照片嗎？(已存雲端的資料不受影響)')) {
        const fields = ['studentName', 'recordDate', 'teacherName'];
        fields.forEach(f => $(f).value = '');
        for(let c=1; c<=6; c++) $('cb'+c).checked = false;
        
        for(let i=1; i<=4; i++) {
            $('pd'+i).value = ''; $('pdesc'+i).value = ''; $('pab'+i).value = '';
            $('img'+i).src = ''; $('img'+i).style.display = 'none';
            $('ph'+i).innerText = `輕觸上傳相片 (區${i})`; $('ph'+i).style.display = 'block';
            $('del'+i).style.display = 'none'; $('file'+i).value = '';
            AppState.cloudImageData['fileId'+i] = '';
        }
        document.title = '幼兒學習區紀錄';
    }
}

function showLoading(text) { $('loaderText').innerHTML = text; $('loader').style.display = 'flex'; }
function hideLoading() { $('loader').style.display = 'none'; }

// ==================== 彈窗與 UI 控制 ====================
function showInfo() { $('infoModal').style.display = 'flex'; }
function closeInfo() { $('infoModal').style.display = 'none'; }

// 300 條重點能力詞庫資料 (保留原有資料)
const dictData = {
    "美勞區": ["喜歡探索色彩，畫作充滿想像力。","能運用多種媒材，展現豐富創造力。","握筆姿勢進步，線條描繪越來越穩。","能專注剪紙，手眼協調能力提升了。","對黏土捏塑有興趣，手部小肌肉靈活。","喜歡動手做勞作，展現獨特藝術美感。","能大膽運用色彩，表達內心的想法。","撕貼技巧熟練，完成品十分精美。","塗鴉時充滿自信，能分享創作故事。","喜歡嘗試新畫材，發揮無限創意。","運用水彩畫畫，色彩層次十分豐富。","能耐心完成作品，專注力值得肯定。","剪刀使用越來越順手，能剪出形狀。","喜歡摺紙活動，空間概念逐漸成形。","能運用廢棄物，改造成有趣的玩具。","畫作構圖完整，能畫出具體的事物。","透過玩色遊戲，增進了視覺敏銳度。","樂於分享畫作，口語表達能力進步。","能仔細觀察事物，並表現在畫作上。","捏塑立體造型，空間感知能力提升。","手指畫充滿童趣，觸覺刺激發展好。","喜歡拓印遊戲，發現圖案的變化。","能獨立完成勞作，自信心大大增加。","著色不超線，手部控制能力很好。","運用點線面元素，豐富了畫面層次。","喜歡串珠珠，精細動作越來越棒了。","能用畫筆畫出家人，情感表達豐富。","享受玩泥巴的樂趣，觸覺發展良好。","剪貼形狀組合，激發了幾何想像力。","畫畫時充滿笑容，十分享受創作。","喜歡揉捏黏土，增進手掌的力量。","能仔細黏貼素材，做事態度很細心。","對色彩敏銳，能調配出美麗的顏色。","運用樹葉作畫，親近大自然的美。","能夠收拾畫具，養成良好的好習慣。","勞作充滿巧思，展現解決問題能力。","喜歡玩印章，對圖騰感到十分好奇。","畫圖能表達情緒，是很好的抒發。","能與同伴合作畫畫，發揮團隊精神。","剪紙對稱圖形，理解了對稱的概念。","喜歡做卡片，懂得表達感恩的心。","運用毛線創作，體驗不同材質的美。","畫作充滿活力，展現出開朗的個性。","能細心妝點作品，美感經驗大提升.","運用海綿蓋印，訓練手腕靈活度。","喜歡玩沙畫，專注力與耐心俱佳。","能夠大面積塗色，手背肌肉更有力。","透過捏麵人，認識傳統藝術之美。","勞作設計獨特，具有個人風格特色。","畫作內容豐富，展現敏銳觀察力。"],
    "語文區": ["喜歡翻閱繪本，培養了良好閱讀習慣。","能專注聽故事，聽覺理解能力很棒。","樂於分享故事，口語表達越來越流利。","認得許多常見字，文字敏感度提升.","能看圖說故事，發揮了無窮想像力。","喜歡聽兒歌，跟著節奏快樂地哼唱。","會主動問問題，展現強烈求知慾望。","能記住故事內容，記憶力十分出色。","喜歡玩字卡，認識了好多新詞彙。","說話咬字清晰，能完整表達想法。","樂意與同伴交談，人際互動能力佳。","能模仿故事角色，展現戲劇天分。","喜歡聽錄音帶，培養獨立學習能力。","會用圖畫記錄故事，讀寫萌發進步。","能說出完整句子，語法結構很正確。","對文字充滿好奇，主動詢問字怎麼唸。","能安靜看書，專注力可以持續很久。","喜歡玩猜謎遊戲，邏輯思考大躍進。","會念簡單唐詩，感受語文的韻律美。","能聽懂老師指令，並確實做出動作。","樂於參與討論，勇於發表自己見解。","喜歡角色扮演，語言使用更情境化。","能用豐富詞彙，描述發生的事情。","會愛惜書本，懂得輕輕翻閱圖畫書。","能分辨不同聲音，聽覺辨識力很好。","喜歡聽神話故事，想像空間更廣闊。","能回答故事問題，理解能力大提升。","說話音量適中，懂得在室內輕聲細語。","喜歡念順口溜，舌頭肌肉更靈活了。","能夠覆述聽過的話，專注傾聽很棒。","喜歡看科普圖畫書，增廣見聞。","會用積木排字，將語文融入遊戲中。","喜歡聽大野狼故事，能分辨善惡。","樂於在大家面前說話，展現大將之風。","能將字卡配對，視覺辨識能力提升。","喜歡指讀文字，建立文字與聲音連結。","會用手指偶說故事，手腦並用很棒。","能夠說出自己的名字，並認得寫法。","喜歡聽床邊故事，情緒感到很穩定。","說話有禮貌，常說請謝謝對不起。","能形容物品特徵，詞彙量大幅增加。","喜歡玩文字接龍，反應十分敏捷。","能耐心聽別人說完話，懂得尊重人。","喜歡聽動物叫聲，學習模仿發音。","能夠理解相反詞，語文邏輯很清晰。","喜歡看立體書，引發強烈閱讀興趣。","會用不同語氣說話，表達情緒起伏。","能夠分辨相似的發音，聽力很敏銳。","喜歡聽長篇故事，持續注意力變長。","能將生活經驗，融入到故事表達中。"],
    "積木區": ["喜歡搭建高塔，展現絕佳平衡感。","能疊出對稱城堡，空間概念成形。","樂於與同伴合作，一起完成大建築。","懂得分類收納積木，物歸原位很棒。","建築作品充滿創意，想像力大爆發。","嘗試不同堆疊法，解決問題能力佳.","喜歡鋪排平面圖形，認識了幾何美。","能耐心重建倒塌積木，挫折忍受度高。","運用積木當作軌道，邏輯思考清晰。","搭建出立體動物，手眼協調大進步。","喜歡玩骨牌遊戲，專注力十分集中。","能運用大積木，鍛鍊了粗大肌肉。","建築架構很穩固，理解了重心原理。","喜歡搭建迷宮，規劃空間能力很強。","會愛惜積木玩具，不會用力亂丟。","樂於分享積木，懂得與同儕輪流玩。","能說出建築名稱，語文結合遊戲。","嘗試搭建長橋，挑戰懸空的物理平衡。","喜歡玩樂高積木，手指精細度提升。","建築細節豐富，展現敏銳的觀察力。","能依據設計圖搭建，理解抽象符號。","喜歡把積木排成一列，學習序列概念。","搭建作品色彩繽紛，展現藝術美感。","會用積木當電話，發揮假扮遊戲創意。","能夠計算積木數量，融入數學學習。","喜歡玩軟積木，享受安全堆疊樂趣。","建築規模越來越大，企圖心很強烈。","懂得禮讓空間，與同伴和諧相處。","喜歡搭建停車場，將生活經驗重現。","堆疊出高樓大廈，充滿成就感。","能夠自己獨立搭建，享受獨處時光。","運用積木敲擊節奏，感受音樂律動。","喜歡搭建機器人，對科技充滿好奇。","能分辨積木形狀，形狀認知發展好。","搭建過程會思考，計畫能力大躍進。","喜歡玩磁力積木，探索磁鐵的奧秘。","建築作品有故事，口語表達更豐富。","能挑戰高難度堆疊，勇於突破自我。","喜歡把積木分類顏色，分類能力佳。","搭建出對稱的天平，理解重量概念。","能用積木測量長度，建立測量基礎。","喜歡玩拱門積木，認識建築力學。","懂得欣賞他人作品，學會給予讚美。","搭建出美麗花園，展現對自然的愛。","喜歡玩卡榫積木，指尖力量大增強。","能用積木拼出字母，結合語文學習。","建築風格獨特，展現個人專屬特色。","喜歡搭建高鐵列車，速度感十足。","能仔細對齊積木邊緣，做事很細心。","搭建出溫暖的家，情感投射很細膩。"],
    "益智區": ["喜歡玩拼圖，視覺空間能力大幅提升。","能專注完成任務，培養了極佳耐心。","擅長圖形配對遊戲，觀察力很敏銳。","鏡分色分類，邏輯思考越來越清晰。","喜歡玩走迷宮，解決問題能力增強。","能按順序排列大小，建立序列概念。","記憶力遊戲表現好，能記住圖案位置。","挑戰高片數拼圖，展現不放棄的精神。","喜歡玩七巧板，幾何形狀組合力強。","數量對應正確，數學基礎打得很穩。","能找出圖中不同處，視覺辨識極佳。","樂於挑戰桌遊，學會遵守遊戲規則。","喜歡穿線遊戲，手眼協調精細度高。","能獨立思考解謎，享受腦力激盪。","會用算珠數數，數字概念逐漸成形。","喜歡玩形狀盒，空間對應能力很棒。","能發現排列規規，邏輯推理大躍進。","樂於與同儕切磋，培養良性競爭心。","懂得輸贏的態度，情緒管理進步了。","喜歡玩齒輪玩具，探索物理連動原理.","能精準扣上鈕扣，小肌肉發展成熟。","喜歡玩天平秤重，理解了輕重對比。","空間迷宮難不倒他，方向感非常好。","能將圖卡分類歸納，組織能力增強。","喜歡玩連連看，數序觀念十分清楚。","能耐心拆解立體謎題，專注力十足。","喜歡玩記憶翻牌，大腦反應很迅速。","能分辨左右方向，空間認知發展好。","透過桌遊學會等待，耐心大有長進。","喜歡測量物件長短，建立長度概念。","能運用策略玩遊戲，思考十分周密。","拼圖速度越來越快，熟練度大提升。","喜歡玩數獨基礎版，邏輯運算超棒。","會用夾子夾毛球，鍛鍊了手指握力。","能理解部分與整體，認知發展成熟。","喜歡玩時鐘玩具，時間概念萌芽了。","樂意教導同伴玩，展現小老師風範。","能準確套圈圈，距離估算能力很好。","喜歡玩影子配對，形狀辨識度很高。","透過釣魚遊戲，訓練了手部穩定度。","能完成對稱圖形，具備幾何對稱感。","喜歡玩五子棋，策略規劃能力極佳。","懂得整理益智教具，養成收納好習慣。","能夠專心串珠，顏色排序完全正確。","喜歡玩骨牌連鎖，理解了因果關係。","能分辨厚薄差異，觸覺與視覺結合。","喜歡玩空間積木，立體建構力很強。","能夠找出隱藏圖案，圖地覺察力佳。","喜歡玩數字接龍，對數字十分敏感。","益智挑戰過關，展現自信燦爛笑容。"],
    "生活自理區": ["能夠自己穿脫外套，生活自理大進步。","喜歡練習扣鈕扣，手指精細動作靈活。","會自己拉上拉鍊，獨立完成不求人。","懂得自己穿鞋襪，左右腳分辨正確.","能夠安靜摺衣服，步驟記得非常清楚。","喜歡幫忙擦桌子，展現熱心助人精神。","會自己倒水喝，手部穩定度大大提升。","懂得使用夾子夾食物，手眼協調佳。","洗手步驟很確實，養成良好衛生習慣。","吃飯能用湯匙舀湯，不會弄髒桌面。","喜歡練習綁鞋帶，展現極佳的耐心。","懂得自己整理書包，負責態度很棒。","能夠擰乾小毛巾，手腕力量變大了。","會自己梳頭髮，注重個人儀容整潔。","懂得分類垃圾，環保意識從小扎根。","喜歡幫盆栽澆水，培養了愛護生命心。","能夠獨立如廁，生活習慣非常良好。","會自己剝橘子皮，手指小肌肉有力。","懂得使用抹布清潔，做事非常細心。","喜歡練習切水果玩具，學習安全常識。","能把餐具收拾整齊，做事有條不紊。","懂得咳嗽要遮口鼻，注重健康禮儀。","會自己掛好毛巾，養成物品歸位習慣。","喜歡練習鎖螺絲，手部旋轉能力強。","能夠安靜午休，自我情緒調節很好。","會自己拉袖子洗手，生活技能熟練。","懂得使用掃把畚箕，維護環境整潔。","能夠自己打開點心盒，獨立解決問題。","喜歡練習倒豆子，專注力讓人驚豔。","懂得將水壺擺放整齊，注重團隊紀律。","會自己摺棉被，生活作息非常有規律。","能夠分辨冷熱水，具備基本安全常識。","喜歡練習打結，手指靈巧度大幅提升。","懂得愛惜食物不浪費，品格教育極佳。","能夠獨立完成洗碗，是老師的好幫手。","會自己脫帽子放好，動作十分俐落。","懂得排隊輪流洗手，具備良好社會性。","喜歡練習使用筷子，手部發展很成熟。","能夠察覺衣服弄髒，主動要求更換。","懂得自己擦鼻涕，保持臉部清潔乾淨。","喜歡幫娃娃穿衣服，同理心發展良好。","能夠把椅子靠攏，養成良好教室常規。","會自己拉開窗簾，感受陽光的溫暖。","懂得愛護個人物品，不輕易弄丟東西。","喜歡練習用滴管，控制力道十分精準。","能夠自己塗抹乳液，學習照顧自己。","會將用過衛生紙丟掉，衛生習慣很好。","懂得自己拿拖鞋穿，動作協調不跌倒.","喜歡練習拉抽屜，學會控制拉的力道。","能夠獨立完成例行事務，充滿自信心。"],
    "組合建構區": ["喜歡組裝模型，立體空間概念極佳。","能照說明書拼裝，邏輯順序非常清楚。","擅長使用齒輪積木，理解物理連動原理。","組合過程很專注，培養了解決問題能力。","喜歡玩雪花片，創意造型變化萬千。","能夠拆解重組，展現了強烈的實驗精神。","運用卡榫積木，鍛鍊手指精細力量。","組裝出汽車模型，手眼協調能力大增。","樂於與同伴合作組裝，發揮團隊默契。","喜歡玩磁力片，探索磁性相吸與相斥。","能夠創造獨特飛行器，想像力十分豐富。","懂得分類零件，養成收納的好習慣。","組裝結構十分穩固，具備工程師潛力。","喜歡玩水管積木，空間延伸概念很好。","能耐心尋找正確零件，觀察力很敏銳。","遇到困難不放棄，抗壓性與毅力極佳。","喜歡組裝機器人，對科技有濃厚興趣。","能夠說出組裝步驟，口語表達很有條理。","運用螺絲起子玩具，手部旋轉技巧好.","組裝出立體城堡，幾何美感十分出色。","喜歡挑戰高難度套件，勇於突破自我。","能夠自由發揮創意，不受限於說明書。","組合出長長火車，序列概念建立完整。","喜歡玩樂高組裝，小肌肉發展非常成熟。","懂得欣賞別人作品，社會互動表現佳。","組裝速度越來越快，動作十分熟練。","喜歡將不同材質結合，創新思維很棒。","能夠組裝對稱模型，空間對稱感極佳。","發現卡住會自己調整，修正能力很強。","喜歡玩關節積木，理解物體活動關節。","組合出摩天輪，對旋轉力學充滿好奇。","能夠精準卡入細小零件，專注力驚人。","喜歡挑戰平衡結構，物理概念萌芽了。","懂得將作品命名，語文與遊戲完美結合。","組裝出動物園，展現對生活環境的觀察。","喜歡玩吸盤玩具，探索真空吸附原理.","能夠估算需要的零件數量，數感很好。","遇到倒塌能勇敢重來，挫折忍受力高。","喜歡將模型展示分享，充滿了成就感。","組合出高塔，了解底部寬大才穩固的道理。","能夠拆解自己作品，學習物歸原位。","喜歡玩棒狀建構玩具，線條空間感佳。","組裝過程充滿笑容，十分享受動手做。","懂得請老師幫忙，遇到困難會主動求援。","喜歡玩軌道組裝，邏輯規劃能力很棒。","能夠組裝出吊車，對機械構造有概念。","發現零件不見會主動尋找，十分負責。","喜歡組裝立體迷宮，三維空間感強烈。","能夠將想像化為實體，實踐能力極佳。","組裝作品充滿細節，觀察入微值得肯定。"]
};

function openDictModal() {
    $('dictModal').style.display = 'flex';
    $('dictView1').style.display = 'block';
    $('dictView2').style.display = 'none';
}

function closeDictModal() { $('dictModal').style.display = 'none'; }
function backToDictHome() { 
    $('dictView2').style.display = 'none'; 
    $('dictView1').style.display = 'block'; 
}

function showCategoryDict(categoryName) {
    $('dictView1').style.display = 'none'; 
    $('dictView2').style.display = 'block';
    $('dictCategoryTitle').innerText = categoryName;
    
    const container = $('phraseListContainer');
    container.innerHTML = ''; 
    
    const fragment = document.createDocumentFragment();
    dictData[categoryName].forEach(phrase => {
        const item = document.createElement('div');
        item.className = 'phrase-item'; 
        item.innerText = phrase;
        item.onclick = () => copyPhraseToClipboard(phrase);
        fragment.appendChild(item);
    });
    container.appendChild(fragment);
}

function copyPhraseToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showToast);
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
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 2000);
}

function printToPDF() {
    const studentName = $('studentName').value.trim();
    document.title = studentName ? `${studentName}_學習區紀錄` : "未命名幼生_學習區紀錄";
    setTimeout(() => { window.print(); }, 500);
}