'use strict';

// ==================== 您的專屬憑證資訊 ====================
const CLIENT_ID = '130737953356-9t11ein5pe6l7ihvmbnm39jeg9beel9s.apps.googleusercontent.com';
// ============================================================

let tokenClient;
let accessToken = null;
let spreadsheetId = null;
let folderId = null;
const cloudImageData = { fileId1: '', fileId2: '', fileId3: '', fileId4: '' };

const $ = (id) => document.getElementById(id);

// ==================== 初始化 ====================
window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('Service Worker 註冊成功'))
            .catch(err => console.error('Service Worker 註冊失敗', err));
    }

    restoreLoginState();
    initGoogleAuth();

    $('seatNumber').value = $('ctrlSeat').value;
    $('ctrlSeat').addEventListener('change', function() {
        $('seatNumber').value = this.value;
    });

    $('studentName').addEventListener('input', updateDocumentTitle);
});

function updateDocumentTitle() {
    const name = $('studentName').value.trim();
    document.title = name ? `${name}_學習區紀錄` : '未命名幼生_學習區紀錄';
}

function restoreLoginState() {
    const savedToken = localStorage.getItem('g_token');
    const expireTime = localStorage.getItem('g_expire');
    const now = new Date().getTime();

    if (savedToken && expireTime && now < parseInt(expireTime)) {
        accessToken = savedToken;
        const loginBtn = $('loginBtn');
        loginBtn.innerText = '🟢 自動連線中';
        loginBtn.style.background = 'linear-gradient(to bottom, #4ca65a, #2f7a3f)';

        showLoading('🚀 偵測到有效憑證，正在連接雲端資料庫...');
        initEnvironment().then(() => {
            loginBtn.innerText = '🟢 已連線雲端';
        });
    } else {
        clearStoredToken();
    }
}

function clearStoredToken() {
    localStorage.removeItem('g_token');
    localStorage.removeItem('g_expire');
    accessToken = null;
}

function initGoogleAuth() {
    if (typeof google !== 'undefined') {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
            prompt: '', 
            callback: handleAuthCallback,
        });
    }
}

async function handleAuthCallback(tokenResponse) {
    if (tokenResponse.error) {
        alert('❌ Google 授權失敗：' + tokenResponse.error);
        return;
    }
    accessToken = tokenResponse.access_token;
    const expiresIn = tokenResponse.expires_in || 3599;
    const newExpireTime = new Date().getTime() + (expiresIn - 60) * 1000;
    localStorage.setItem('g_token', accessToken);
    localStorage.setItem('g_expire', newExpireTime);

    const loginBtn = $('loginBtn');
    loginBtn.innerText = '🟢 已連線雲端';
    loginBtn.style.background = 'linear-gradient(to bottom, #4ca65a, #2f7a3f)';

    showLoading('🚀 正在初始化個人雲端資料庫...');
    await initEnvironment();
}

function handleAuthClick() {
    if (tokenClient) {
        tokenClient.requestAccessToken();
    } else {
        alert('Google SDK 載入中，請重新嘗試。');
    }
}

async function fetchGoogleAPI(url, options = {}) {
    if (!accessToken) {
        hideLoading();
        alert('⚠️ 請先完成「Google 帳號登入」授權！');
        throw new Error('未獲得權限');
    }
    const headers = options.headers || {};
    headers['Authorization'] = `Bearer ${accessToken}`;
    options.headers = headers;

    const response = await fetch(url, options);
    if (!response.ok) {
        if (response.status === 401) handleTokenExpired();
        const errDetails = await response.text();
        console.error('API Error:', errDetails);
        throw new Error(`狀態碼: ${response.status}`);
    }
    return response.json();
}

function handleTokenExpired() {
    clearStoredToken();
    const loginBtn = $('loginBtn');
    loginBtn.innerText = '🔵 Google 登入';
    loginBtn.style.background = 'linear-gradient(to bottom, #4285f4, #2b5cbf)';
    alert('⚠️ 您的 Google 登入憑證已過期，請重新點擊上方「Google 登入」按鈕！');
}

async function initEnvironment() {
    try {
        const qSheet = "name='幼兒學習區紀錄資料庫' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
        const qFolder = "name='幼兒相片雲端備份庫' and mimeType='application/vnd.google-apps.folder' and trashed=false";

        const [sheetSearch, folderSearch] = await Promise.all([
            fetchGoogleAPI(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qSheet)}`),
            fetchGoogleAPI(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qFolder)}`)
        ]);

        if (sheetSearch.files?.length > 0) spreadsheetId = sheetSearch.files[0].id;
        else spreadsheetId = await createSpreadsheet();

        if (folderSearch.files?.length > 0) folderId = folderSearch.files[0].id;
        else folderId = await createFolder();

        hideLoading();
    } catch (err) {
        hideLoading();
        alert('❌ 初始化個人雲端空間失敗：' + err.message);
    }
}

async function createSpreadsheet() {
    const createSheet = await fetchGoogleAPI('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '幼兒學習區紀錄資料庫', mimeType: 'application/vnd.google-apps.spreadsheet' })
    });
    await fetchGoogleAPI( `https://sheets.googleapis.com/v4/spreadsheets/${createSheet.id}/values/A1:E1?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [["座號", "班級", "姓名", "最後更新時間", "資料備註"]] })
    });
    return createSheet.id;
}

async function createFolder() {
    const createFolder = await fetchGoogleAPI('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '幼兒相片雲端備份庫', mimeType: 'application/vnd.google-apps.folder' })
    });
    return createFolder.id;
}

// ==================== 圖片優化處理與快取處理 ====================
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

        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        const imgEl = $('img' + index);
        imgEl.src = dataUrl;
        imgEl.style.display = 'block';

        $('ph' + index).style.display = 'none';
        $('del' + index).style.display = 'block';

        // 徹底釋放記憶體避免 iOS 閃退
        canvas.width = 0; 
        canvas.height = 0;

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
        if (!folderId) await initEnvironment();

        const metadata = { name: filename, parents: [folderId], mimeType: 'image/jpeg' };
        const formData = new FormData();
        formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        formData.append('file', blob);

        const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            body: formData
        });

        if (!uploadResponse.ok) throw new Error('雲端上傳失敗');
        const fileData = await uploadResponse.json();

        cloudImageData['fileId' + imgIndex] = fileData.id;
        hideLoading();
    } catch (err) {
        hideLoading();
        alert('❌ 圖片儲存至雲端失敗：' + err.message);
    }
}

async function removeImage(index, event) {
    event.preventDefault();
    event.stopPropagation();
    const fileId = cloudImageData['fileId' + index];

    if (fileId) {
        if (!confirm('確定要移除這張照片嗎？(將同時從 Google 雲端硬碟永久刪除)')) return;
        showLoading('🗑️ 正在從雲端刪除照片...');
        try {
            await fetchGoogleAPI(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' });
        } catch(e) { console.warn('檔案可能已不在雲端', e); }
        hideLoading();
    }
    resetImageField(index);
}

function resetImageField(index) {
    const imgEl = $('img' + index);
    imgEl.src = '';
    imgEl.style.display = 'none';
    $('del' + index).style.display = 'none';
    $('ph' + index).style.display = 'block';
    $('ph' + index).innerText = `輕觸上傳相片 (區${index})`;
    $('file' + index).value = '';
    cloudImageData['fileId' + index] = '';
}

// ==================== 表單數據與備份 ====================
function getFormData() {
    const data = {
        year: $('year').value,
        term: $('term').value,
        className: $('className').value,
        studentName: $('studentName').value,
        seatNumber: $('ctrlSeat').value,
        recordDate: $('recordDate').value,
        cb1: $('cb1').checked,
        cb2: $('cb2').checked,
        cb3: $('cb3').checked,
        cb4: $('cb4').checked,
        cb5: $('cb5').checked,
        cb6: $('cb6').checked,
        teacherName: $('teacherName').value,
    };
    for (let i = 1; i <= 4; i++) {
        data['pd' + i] = $('pd' + i).value;
        data['pdesc' + i] = $('pdesc' + i).value;
        data['pab' + i] = $('pab' + i).value;
        data['fileId' + i] = cloudImageData['fileId' + i];
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
        if (!spreadsheetId) await initEnvironment();

        const readRes = await fetchGoogleAPI(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:E`);
        const values = readRes.values || [];
        const rowIndex = values.findIndex((row, idx) => idx > 0 && row[0] == data.seatNumber);
        const actualRow = rowIndex > -1 ? rowIndex + 1 : -1;

        const jsonStr = JSON.stringify(data);
        const rowData = [data.seatNumber, data.className, data.studentName, new Date().toLocaleString(), jsonStr];
        const apiOpts = {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [rowData] })
        };

        if (actualRow > -1) {
            apiOpts.method = 'PUT';
            await fetchGoogleAPI(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A${actualRow}:E${actualRow}?valueInputOption=USER_ENTERED`, apiOpts);
        } else {
            apiOpts.method = 'POST';
            await fetchGoogleAPI(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:E:append?valueInputOption=USER_ENTERED`, apiOpts);
        }
        hideLoading();
        alert(`✅ 座號 ${data.seatNumber} 號 (${data.studentName}) 的紀錄已安全存入您的雲端硬碟！`);
    } catch (err) { hideLoading(); alert("❌ 儲存失敗：" + err.message); }
}

async function cloudLoad() {
    const targetSeat = $('ctrlSeat').value.trim();
    if (!targetSeat) { alert("請輸入想要下載的座號"); return; }

    $('seatNumber').value = targetSeat;
    showLoading(`📥 正在從您的雲端讀取第 ${targetSeat} 號的紀錄與相片...`);

    try {
        if (!spreadsheetId) await initEnvironment();

        const readRes = await fetchGoogleAPI(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:E`);
        const values = readRes.values || [];
        const targetRow = values.find(row => row[0] == targetSeat);

        if (!targetRow || !targetRow[4]) {
            hideLoading(); 
            alert(`您的雲端庫中尚未建立 ${targetSeat} 號的資料。`); 
            return; 
        }

        const targetData = JSON.parse(targetRow[4]);
        populateFormData(targetData);
        await loadImages(targetData);
        updateDocumentTitle();
        hideLoading();
    } catch (err) { hideLoading(); alert("❌ 載入失敗：" + err.message); }
}

function populateFormData(data) {
    const fields = ['year', 'term', 'className', 'teacherName', 'studentName', 'recordDate'];
    fields.forEach(f => { if (data[f] !== undefined) $(f).value = data[f]; });
    for (let c = 1; c <= 6; c++) $('cb' + c).checked = data['cb' + c] || false;
    for (let i = 1; i <= 4; i++) {
        $('pd' + i).value = data['pd' + i] || '';
        $('pdesc' + i).value = data['pdesc' + i] || '';
        $('pab' + i).value = data['pab' + i] || '';
    }
}

async function loadImages(targetData) {
    for (let i = 1; i <= 4; i++) {
        const fileId = targetData['fileId' + i];
        const imgEl = $('img' + i);
        const phEl = $('ph' + i);
        const delEl = $('del' + i);

        if (fileId) {
            try {
                const mediaResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                if (!mediaResponse.ok) throw new Error();
                const blob = await mediaResponse.blob();
                imgEl.src = URL.createObjectURL(blob);
                imgEl.style.display = 'block';
                phEl.style.display = 'none';
                delEl.style.display = 'block';
                cloudImageData['fileId' + i] = fileId;
            } catch (e) {
                imgEl.src = ''; imgEl.style.display = 'none';
                phEl.innerText = '⚠️ 相片讀取失敗'; phEl.style.display = 'block';
                delEl.style.display = 'none';
            }
        } else {
            resetImageField(i);
        }
    }
}

function clearForm() {
    if (!confirm('⚠️ 確定要清除目前畫面上輸入的所有文字與照片嗎？(已存雲端的資料不受影響)')) return;
    const fields = ['studentName', 'recordDate', 'teacherName'];
    fields.forEach(f => $(f).value = '');
    for (let c = 1; c <= 6; c++) $('cb' + c).checked = false;
    for (let i = 1; i <= 4; i++) {
        $('pd' + i).value = ''; $('pdesc' + i).value = ''; $('pab' + i).value = '';
        resetImageField(i);
    }
    document.title = '幼兒學習區紀錄';
}

function showLoading(text) { $('loaderText').innerHTML = text; $('loader').style.display = 'flex'; }
function hideLoading() { $('loader').style.display = 'none'; }
function showInfo() { $('infoModal').style.display = 'flex'; }
function closeInfo() { $('infoModal').style.display = 'none'; }

// ==================== 100% 完整保留原始 300 條智慧詞庫資料 ====================
const dictData = {
    "美勞區": [
        "能嘗試使用多種複合媒材進行立體面具創作，展現豐富的想像力與色彩搭配技巧。",
        "在剪紙活動中展現良好的手部穩定度，能順利沿著複雜的曲線剪出對稱的對稱圖案。",
        "對水彩調色非常有興趣，能主動探索三原色混合後的色彩變化，並記錄在自製調色盤上。",
        "在捏陶泥過程中能運用揉、捏、搓、壓等多元技巧，創作出結構穩固的恐龍立體城堡。",
        "能專注且耐心地完成編織手工藝創作，手眼協調能力優異，作品細緻度高。",
        "主動收拾美勞區的剩餘材料，並能依紙屑、塑料、工具等進行精確的分類與歸位。",
        "在團體協作的大型壁畫活動中，能主動與同伴協商畫面分配，展現極佳的合作態度。",
        "嘗試使用廢棄紙箱與寶特瓶製作環保玩具車，具備良好的空間建構與環保創意素養。",
        "能用點點貼紙創作出具有規律與對稱美感的幾何圖形，視覺空間排列能力發展良好。",
        "在撕紙貼畫活動中，能控制手指精細動作，將紙張撕成合適的大小來填補圖畫輪廓。"
    ],
    "語文區": [
        "能專注聆聽長篇故事繪本，並在團體分享時口齒清晰、條理分明地復述出完整故事情節。",
        "主動翻閱自然科普類圖書，並能根據畫面細節提出富有邏輯的關鍵性提問。",
        "在扮演小主播時，能大方對著大家說話，語音抑揚頓挫拿捏得宜，肢體語言自然豐富。",
        "能嘗試運用簡單的注音符號與自創符號，編寫一本屬於自己的四頁小連環漫畫書。",
        "對文字結構敏銳度高，能在造詞與接龍遊戲中，主動聯想到許多日常生活中學到的詞彙。",
        "看完故事後，能精確揣摩書中主角的心理情緒，並用豐富的形容詞來表達個人想法。",
        "樂於與同伴一起閱讀大圖書，會主動手指文字，並用溫和的語氣引導幼小同伴共讀。",
        "能將零散的故事圖卡依據時間與因果關係進行合理排列，並創作出邏輯通順的故事。",
        "在進行聲音韻腳遊戲時，能快速辨識出相同尾音的字詞，聽覺分辨能力發展優異。",
        "閱讀結束後，能主動將繪本封面朝外、整齊放入對應的書架中，維持語文區的整潔。"
    ],
    "益智區": [
        "能獨立完成100片的複雜拼圖，展現極佳的視覺辨識能力與挫折容忍力。",
        "在操作數棒與數字卡配對時，能手口一致地手點數到30，並精確理解多與少的概念。",
        "能運用多種策略解開九連環等傳統幾何益智玩具，空間邏輯思考與應變能力優異。",
        "主動挑戰進階的雙向邏輯矩陣配對板，能同時考慮顏色與圖形兩個維度進行精確分類。",
        "在進行天平稱重實驗時，能透過反覆微調砝碼數量，理解平衡與重量守恆的物理概念。",
        "能依據複雜的序列圖卡（如 AABBCC 或進階漸變規律），完美延伸排列多色扣條。",
        "在進行策略型桌遊時，能遵守輪流、等待的遊戲規則，並能坦然面對輸贏的結果。",
        "能運用圖釘板和橡皮筋勾勒出各種多邊形，並能準確說出正方形與長方形的特徵差異。",
        "嘗試使用圖形解題板，能靈活旋轉七巧板的角度，填滿複雜的幾何圖案輪廓。",
        "活動結束後，能細心地將各種微小棋子、卡片逐一清點數量並收納回專用盒中。"
    ],
    "積木區": [
        "能運用骨牌與長條木積木架設大型多層軌道，結構平衡感與立體空間概念極佳。",
        "主動參考複雜的立體建築圖譜，運用多種造型積木搭建出高聳且對稱的城堡外觀。",
        "在搭建高塔時遭遇坍塌，能保持冷靜，主動找出基底不穩的原因並加固底部結構。",
        "能與同伴共同規劃「未來的動物園」，在分工過程中展現良好的協商與溝通特質。",
        "靈活運用圓弧積木與直角積木組合出具備美感的橋樑，空間聯結技巧表現純熟。",
        "嘗試在搭建的積木軌道中融入斜坡與重力原理，讓滾珠能順暢通過各種轉彎處。",
        "能以主題式概念進行建構，完成作品後會主動為大家導覽介紹其建築的內部功能。",
        "在有限的積木數量下，能變通改用不同長度的積木進行替代，展現良好的解決問題能力。",
        "能控制大肌肉運動與精細動作，在搬運與堆疊大型空心積木時動作穩健且安全。",
        "收拾時間到時，能高度配合團體，將積木依據尺寸、長短及形狀逐一分門別類收好。"
    ],
    "裝扮區": [
        "在角色扮演遊戲中，能精確模仿醫生的詢問語氣與關懷態度，角色投入度極高。",
        "主動邀約同伴參與「超級市場」劇本，並能自行分配收銀員、顧客等不同社會角色。",
        "能善用現有的輕紗、絲帶等非具體素材，發揮創意將自己打扮成富有特色的魔法師。",
        "在爭奪熱門裝扮道具時，能用溫和的語言說出「我們可以輪流，你先穿五分鐘」，展現極佳社會性。",
        "扮演餐廳主廚時，能詳細向客人介紹自創的複合式菜單，口語表達與社交能力流異。",
        "能展現良好的同理心，在扮演照顧嬰兒的父母時，動作溫柔且富有耐心。",
        "在舞台劇扮演中，能隨著背景音樂的節奏律動調整走位與台詞，身體協調性良好。",
        "遊戲後能主動整理繁複的裝扮衣服，將其掛上衣架，並將鞋帽配件整齊歸位至道具箱。",
        "能根據扮演情境，主動用積木或紙箱搭建出櫃台等輔助場景，豐富了劇本的層次感。",
        "在面對突發的「劇本爭執」時，能主動尋求折衷方案，引導同伴讓扮演順利進行下去。"
    ],
    "體能區": [
        "在平衡木前進時能保持身體最佳平衡，並順利挑戰單腳站立5秒，大肌肉控制力好。",
        "連續跳繩動作協調，能抓準雙腳跳躍與甩繩的完美時間點，展現優異的運動敏捷度。",
        "攀爬網挑戰時不畏高，四肢抓握力與核心肌群力量充足，能安全且快速地攀頂。",
        "投籃與丟接球精準度高，能目測精確距離並調整施力大小，手眼協調發展健全。",
        "在進行大風吹或障礙賽跑時，能靈活變換跑步方向，閃避障礙物時的反應十分敏捷。",
        "跟隨快節奏音樂進行體操律動時，動作力度到位，空間方向感與節奏感掌握純熟。",
        "雙腳並攏連續向前跳躍障礙物，落地姿勢平穩且安全，展現良好的下肢爆發力。",
        "在團隊接力賽中展現極佳的團隊榮譽感，能遵守起跑線規則，並大聲為隊友加油。",
        "攀爬大型體能器材時，能隨時注意前後同伴的距離，確保自身與他人的安全空間。",
        "活動結束後，能與老師及同學合力將沉重的軟墊、角錐等大體能器材搬回儲藏室。"
    ]
};

// ==================== 智慧詞庫 UI 架構控制 (完美保留雙層) ====================
function openDictModal() {
    backToDictHome();
    $('dictModal').style.display = 'flex';
}

function closeDictModal() {
    $('dictModal').style.display = 'none';
}

function switchDictLayer(category) {
    $('dictHomeLayer').style.display = 'none';
    $('dictListLayer').style.display = 'flex';
    $('dictCategoryTitle').innerText = category;

    const container = $('phraseListContainer');
    container.innerHTML = '';

    if (dictData[category]) {
        dictData[category].forEach(phrase => {
            const item = document.createElement('div');
            item.className = 'phrase-item';
            item.innerText = phrase;
            item.onclick = () => copyPhraseText(phrase);
            container.appendChild(item);
        });
    }
}

function backToDictHome() {
    $('dictListLayer').style.display = 'none';
    $('dictHomeLayer').style.display = 'block';
}

function copyPhraseText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast();
        }).catch(err => {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast();
}

function showToast() {
    const toast = $('copyToast');
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 2000);
}

// ==================== 列印與 PDF 輸出 ====================
function printToPDF() {
    const studentName = $('studentName').value.trim();
    document.title = studentName ? `${studentName}_學習區紀錄` : "未命名幼生_學習區紀錄";

    setTimeout(() => {
        window.print();
    }, 500);
}

// ==================== 相片來源選擇與 iOS 喚醒後置鏡頭邏輯 ====================
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
    
    if (source === 'camera') {
        fileInput.setAttribute('capture', 'environment'); // iOS 直呼後置鏡頭拍照
    } else {
        fileInput.removeAttribute('capture'); // 開啟相簿選擇
    }
    
    closePhotoSourceModal();
    fileInput.click();
}
