'use strict';

const $ = (id) => document.getElementById(id);

// ==================== 本機資料庫 (IndexedDB) ====================
const DB_NAME = 'learn-record-db', STORE = 'kv';
let dbPromise = null;
function db() {
    if (!dbPromise) dbPromise = new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
    return dbPromise;
}
async function kvGet(k) {
    const d = await db();
    return new Promise((res, rej) => {
        const q = d.transaction(STORE).objectStore(STORE).get(k);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
    });
}
async function kvSet(k, v) {
    const d = await db();
    return new Promise((res, rej) => {
        const t = d.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put(v, k);
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
    });
}
async function kvDel(k) {
    const d = await db();
    return new Promise((res, rej) => {
        const t = d.transaction(STORE, 'readwrite');
        t.objectStore(STORE).delete(k);
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
    });
}

// ==================== 座號頁籤 ====================
let seats = [];            // 例如 ['1','2','3']
let seatNames = {};        // 座號 -> 幼生姓名（頁籤顯示用）
let currentSeat = null;
let saveTimer = null;
let switching = false;

function sortSeats(a, b) {
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b), 'zh-Hant');
}

function renderTabs() {
    const box = $('seatTabs');
    box.innerHTML = '';
    seats.forEach(s => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'seat-tab' + (s === currentSeat ? ' active' : '');
        const nm = (seatNames[s] || '').trim();
        b.textContent = nm ? `${s} ${nm}` : s;
        b.onclick = () => switchSeat(s);
        box.appendChild(b);
    });
    const act = box.querySelector('.active');
    if (act && act.scrollIntoView) act.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function setSeatFields(seat) {
    $('ctrlSeat').value = seat;
    $('seatNumber').value = seat;
}

async function switchSeat(seat) {
    if (switching || seat === currentSeat) return;
    switching = true;
    try {
        await saveNow();
        currentSeat = seat;
        await loadRecordToForm(seat);
        await kvSet('lastSeat', seat);
        renderTabs();
    } finally { switching = false; }
}

async function addSeat() {
    const next = String((seats.map(Number).filter(n => !isNaN(n)).reduce((m, n) => Math.max(m, n), 0)) + 1);
    let v = prompt('請輸入要新增的座號：', next);
    if (v === null) return;
    v = v.trim();
    if (!v || v.length > 6) { alert('座號請輸入 1～6 個字'); return; }
    if (seats.includes(v)) { alert(`座號 ${v} 已經存在`); return; }
    await saveNow();
    seats.push(v);
    seats.sort(sortSeats);
    await kvSet('seats', seats);
    switching = true;
    try {
        currentSeat = v;
        blankForm();
        setSeatFields(v);
        await saveNow();
        await kvSet('lastSeat', v);
        renderTabs();
    } finally { switching = false; }
}

async function deleteSeat() {
    if (seats.length <= 1) { alert('至少要保留一個座號頁籤'); return; }
    const nm = (seatNames[currentSeat] || '').trim();
    if (!confirm(`⚠️ 確定要刪除「${currentSeat} 號${nm ? ' ' + nm : ''}」的頁籤與所有紀錄、相片嗎？\n此動作無法復原（建議先按「備份」）。`)) return;
    clearTimeout(saveTimer);
    const idx = seats.indexOf(currentSeat);
    const gone = currentSeat;
    seats = seats.filter(s => s !== gone);
    delete seatNames[gone];
    await kvDel('rec:' + gone);
    await kvSet('seats', seats);
    currentSeat = seats[Math.min(idx, seats.length - 1)];
    await loadRecordToForm(currentSeat);
    await kvSet('lastSeat', currentSeat);
    renderTabs();
    markChanged();
}

// ==================== 自動存檔（每次輸入即存到本機） ====================
function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
}

async function saveNow() {
    clearTimeout(saveTimer);
    if (!currentSeat) return;
    try {
        const data = getFormData();
        data.seatNumber = currentSeat;
        await kvSet('rec:' + currentSeat, data);
        seatNames[currentSeat] = data.studentName || '';
        renderTabs();
        markChanged();
    } catch (err) {
        console.error('本機存檔失敗', err);
        alert('❌ 本機存檔失敗：' + (err && err.message ? err.message : err) + '\n可能是手機儲存空間不足。');
    }
}

async function loadRecordToForm(seat) {
    const data = await kvGet('rec:' + seat);
    blankForm();
    setSeatFields(seat);
    if (data) populateFormData(data);
    updateDocumentTitle();
}

// 清空畫面欄位（保留 學年度/學期/班級/導師，方便新增座號時沿用）
function blankForm() {
    ['studentName', 'recordDate'].forEach(f => $(f).value = '');
    for (let c = 1; c <= 6; c++) $('cb' + c).checked = false;
    for (let i = 1; i <= 4; i++) {
        $('pd' + i).value = '';
        $('pdesc' + i).value = '';
        $('pab' + i).value = '';
        resetImageField(i);
    }
    document.title = '幼兒學習區紀錄';
}

function updateDocumentTitle() {
    const name = $('studentName').value.trim();
    document.title = name ? `${name}_學習區紀錄` : '未命名幼生_學習區紀錄';
}



// ==================== 初始化 ====================
window.addEventListener('load', async () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.error('Service Worker 註冊失敗', err));
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    try {
        seats = (await kvGet('seats')) || [];
        if (!seats.length) { seats = ['1']; await kvSet('seats', seats); }
        seats.sort(sortSeats);
        for (const s of seats) {
            const r = await kvGet('rec:' + s);
            seatNames[s] = (r && r.studentName) || '';
        }
        const last = await kvGet('lastSeat');
        currentSeat = seats.includes(last) ? last : seats[0];
        await loadRecordToForm(currentSeat);
        renderTabs();
        dirHandle = (await kvGet('dirHandle')) || null;
    } catch (err) {
        console.error(err);
        alert('❌ 無法開啟本機資料庫：' + (err && err.message ? err.message : err));
    }
    updateBackupUI();

    // 輸入即自動存檔
    const form = $('recordForm');
    form.addEventListener('input', scheduleSave);
    form.addEventListener('change', scheduleSave);
    $('studentName').addEventListener('input', updateDocumentTitle);

    // 還原備份檔案選擇
    $('restoreInput').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) restoreBackup(f);
        e.target.value = '';
    });

    // 離開/切到背景時立刻存檔並嘗試自動備份
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { saveNow(); autoBackup(); }
    });
    window.addEventListener('pagehide', () => { saveNow(); });

    // 第一次點擊畫面：恢復資料夾授權（需要使用者手勢），或引導一次性設定
    let firstTap = true;
    document.addEventListener('pointerdown', async () => {
        if (!firstTap) return;
        firstTap = false;
        if (!FS_OK) return;
        if (dirHandle) {
            if (!(await dirPermission(false))) { await dirPermission(true); updateBackupUI(); autoBackup(); }
        } else if (!(await kvGet('setupAsked'))) {
            await kvSet('setupAsked', true);
            openBackupModal();
            setBackupMsg('👋 首次使用：請按「📁 設定「學習區」資料夾」。在選擇畫面進入 Download ➜「新增資料夾」取名「學習區」➜「使用此資料夾」。只需設定一次，之後備份與 PDF 都會自動存進去。');
        }
    }, { passive: true });

    autoBackup();
});

// ==================== 圖片 ====================
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

    showLoading('📸 正在壓縮圖片...');

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

        // 清理 canvas
        canvas.width = 0; 
        canvas.height = 0;

        hideLoading();
        scheduleSave();
    } catch (err) {
        hideLoading();
        alert('❌ 圖片處理失敗：' + err.message);
    }
}

async function removeImage(index, event) {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm('確定要移除這張照片嗎？')) return;
    resetImageField(index);
    scheduleSave();
}

function resetImageField(index) {
    const imgEl = $('img' + index);
    imgEl.src = '';
    imgEl.style.display = 'none';
    $('del' + index).style.display = 'none';
    $('ph' + index).style.display = 'block';
    $('ph' + index).innerText = `輕觸上傳相片 (區${index})`;
    $('file' + index).value = '';
}


// ==================== 表單數據 ====================
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
        const im = $('img' + i);
        data['img' + i] = (im.style.display === 'block' && im.src.startsWith('data:')) ? im.src : '';
    }
    return data;
}

function populateFormData(data) {
    const fields = ['year', 'term', 'className', 'teacherName', 'studentName', 'recordDate'];
    fields.forEach(f => { 
        if (data[f] !== undefined) $(f).value = data[f]; 
    });

    for (let c = 1; c <= 6; c++) {
        $('cb' + c).checked = data['cb' + c] || false;
    }

    for (let i = 1; i <= 4; i++) {
        $('pd' + i).value = data['pd' + i] || ''; 
        $('pdesc' + i).value = data['pdesc' + i] || ''; 
        $('pab' + i).value = data['pab' + i] || '';
    }
    populateImages(data);
}


function populateImages(data) {
    for (let i = 1; i <= 4; i++) {
        const src = data['img' + i];
        if (src) {
            const imgEl = $('img' + i);
            imgEl.src = src;
            imgEl.style.display = 'block';
            $('ph' + i).style.display = 'none';
            $('del' + i).style.display = 'block';
        } else {
            resetImageField(i);
        }
    }
}

// ==================== 清除畫面 ====================
function clearForm() {
    if (!confirm(`⚠️ 確定要清空「${currentSeat} 號」這一頁的所有文字與照片嗎？\n（清空後會立即儲存，無法復原）`)) return;
    blankForm();
    updateDocumentTitle();
    saveNow();
}

function showLoading(text) { 
    $('loaderText').innerHTML = text; 
    $('loader').style.display = 'flex'; 
}

function hideLoading() { 
    $('loader').style.display = 'none'; 
}

// ==================== 說明視窗 ====================
function showInfo() { $('infoModal').style.display = 'flex'; }
function closeInfo() { $('infoModal').style.display = 'none'; }

// ==================== 300 條重點能力詞庫資料 ====================
const dictData = {
    "美勞區": ["喜歡探索色彩，畫作充滿想像力。","能運用多種媒材，展現豐富創造力。","握筆姿勢進步，線條描繪越來越穩。","能專注剪紙，手眼協調能力提升了。","對黏土捏塑有興趣，手部小肌肉靈活。","喜歡動手做勞作，展現獨特藝術美感。","能大膽運用色彩，表達內心的想法。","撕貼技巧熟練，完成品十分精美。","塗鴉時充滿自信，能分享創作故事。","喜歡嘗試新畫材，發揮無限創意。","運用水彩畫畫，色彩層次十分豐富。","能耐心完成作品，專注力值得肯定。","剪刀使用越來越順手，能剪出形狀。","喜歡摺紙活動，空間概念逐漸成形。","能運用廢棄物，改造成有趣的玩具。","畫作構圖完整，能畫出具體的事物。","透過玩色遊戲，增進了視覺敏銳度。","樂於分享畫作，口語表達能力進步。","能仔細觀察事物，並表現在畫作上。","捏塑立體造型，空間感知能力提升。","手指畫充滿童趣，觸覺刺激發展好。","喜歡拓印遊戲，發現圖案的變化。","能獨立完成勞作，自信心大大增加。","著色不超線，手部控制能力很好。","運用點線面元素，豐富了畫面層次。","喜歡串珠珠，精細動作越來越棒了。","能用畫筆畫出家人，情感表達豐富。","享受玩泥巴的樂趣，觸覺發展良好。","剪貼形狀組合，激發了幾何想像力。","畫畫時充滿笑容，十分享受創作。","喜歡揉捏黏土，增進手掌的力量。","能仔細黏貼素材，做事態度很細心。","對色彩敏銳，能調配出美麗的顏色。","運用樹葉作畫，親近大自然的美。","能夠收拾畫具，養成良好的好習慣。","勞作充滿巧思，展現解決問題能力。","喜歡玩印章，對圖騰感到十分好奇。","畫圖能表達情緒，是很好的抒發。","能與同伴合作畫畫，發揮團隊精神。","剪紙對稱圖形，理解了對稱的概念。","喜歡做卡片，懂得表達感恩的心。","運用毛線創作，體驗不同材質的美。","畫作充滿活力，展現出開朗的個性。","能細心妝點作品，美感經驗大提升。","運用海綿蓋印，訓練手腕靈活度。","喜歡玩沙畫，專注力與耐心俱佳。","能夠大面積塗色，手背肌肉更有力。","透過捏麵人，認識傳統藝術之美。","勞作設計獨特，具有個人風格特色。","畫作內容豐富，展現敏銳觀察力。"],
    "語文區": ["喜歡翻閱繪本，培養了良好閱讀習慣。","能專注聽故事，聽覺理解能力很棒。","樂於分享故事，口語表達越來越流利。","認得許多常見字，文字敏感度提升。","能看圖說故事，發揮了無窮想像力。","喜歡聽兒歌，跟著節奏快樂地哼唱。","會主動問問題，展現強烈求知慾望。","能記住故事內容，記憶力十分出色。","喜歡玩字卡，認識了好多新詞彙。","說話咬字清晰，能完整表達想法。","樂意與同伴交談，人際互動能力佳。","能模仿故事角色，展現戲劇天分。","喜歡聽錄音帶，培養獨立學習能力。","會用圖畫記錄故事，讀寫萌發進步。","能說出完整句子，語法結構很正確。","對文字充滿好奇，主動詢問字怎麼唸。","能安靜看書，專注力可以持續很久。","喜歡玩猜謎遊戲，邏輯思考大躍進。","會念簡單唐詩，感受語文的韻律美。","能聽懂老師指令，並確實做出動作。","樂於參與討論，勇於發表自己見解。","喜歡角色扮演，語言使用更情境化。","能用豐富詞彙，描述發生的事情。","會愛惜書本，懂得輕輕翻閱圖畫書。","能分辨不同聲音，聽覺辨識力很好。","喜歡聽神話故事，想像空間更廣闊。","能回答故事問題，理解能力大提升。","說話音量適中，懂得在室內輕聲細語。","喜歡念順口溜，舌頭肌肉更靈活了。","能夠覆述聽過的話，專注傾聽很棒。","喜歡看科普圖畫書，增廣見聞。","會用積木排字，將語文融入遊戲中。","喜歡聽大野狼故事，能分辨善惡。","樂於在大家面前說話，展現大將之風。","能將字卡配對，視覺辨識能力提升。","喜歡指讀文字，建立文字與聲音連結。","會用手指偶說故事，手腦並用很棒。","能夠說出自己的名字，並認得寫法。","喜歡聽床邊故事，情緒感到很穩定。","說話有禮貌，常說請謝謝對不起。","能形容物品特徵，詞彙量大幅增加。","喜歡玩文字接龍，反應十分敏捷。","能耐心聽別人說完話，懂得尊重人。","喜歡聽動物叫聲，學習模仿發音。","能夠理解相反詞，語文邏輯很清晰。","喜歡看立體書，引發強烈閱讀興趣。","會用不同語氣說話，表達情緒起伏。","能夠分辨相似的發音，聽力很敏銳。","喜歡聽長篇故事，持續注意力變長。","能將生活經驗，融入到故事表達中。"],
    "積木區": ["喜歡搭建高塔，展現絕佳平衡感。","能疊出對稱城堡，空間概念成形。","樂於與同伴合作，一起完成大建築。","懂得分類收納積木，物歸原位很棒。","建築作品充滿創意，想像力大爆發。","嘗試不同堆疊法，解決問題能力佳。","喜歡鋪排平面圖形，認識了幾何美。","能耐心重建倒塌積木，挫折忍受度高。","運用積木當作軌道，邏輯思考清晰。","搭建出立體動物，手眼協調大進步。","喜歡玩骨牌遊戲，專注力十分集中。","能運用大積木，鍛鍊了粗大肌肉。","建築架構很穩固，理解了重心原理。","喜歡搭建迷宮，規劃空間能力很強。","會愛惜積木玩具，不會用力亂丟。","樂於分享積木，懂得與同儕輪流玩。","能說出建築名稱，語文結合遊戲。","嘗試搭建長橋，挑戰懸空的物理平衡。","喜歡玩樂高積木，手指精細度提升。","建築細節豐富，展現敏銳的觀察力。","能依據設計圖搭建，理解抽象符號。","喜歡把積木排成一列，學習序列概念。","搭建作品色彩繽紛，展現藝術美感。","會用積木當電話，發揮假扮遊戲創意。","能夠計算積木數量，融入數學學習。","喜歡玩軟積木，享受安全堆疊樂趣。","建築規模越來越大，企圖心很強烈。","懂得禮讓空間，與同伴和諧相處。","喜歡搭建停車場，將生活經驗重現。","堆疊出高樓大廈，充滿成就感。","能夠自己獨立搭建，享受獨處時光。","運用積木敲擊節奏，感受音樂律動。","喜歡搭建機器人，對科技充滿好奇。","能分辨積木形狀，形狀認知發展好。","搭建過程會思考，計畫能力大躍進。","喜歡玩磁力積木，探索磁鐵的奧秘。","建築作品有故事，口語表達更豐富。","能挑戰高難度堆疊，勇於突破自我。","喜歡把積木分類顏色，分類能力佳。","搭建出對稱的天平，理解重量概念。","能用積木測量長度，建立測量基礎。","喜歡玩拱門積木，認識建築力學。","懂得欣賞他人作品，學會給予讚美。","搭建出美麗花園，展現對自然的愛。","喜歡玩卡榫積木，指尖力量大增強。","能用積木拼出字母，結合語文學習。","建築風格獨特，展現個人專屬特色。","喜歡搭建高鐵列車，速度感十足。","能仔細對齊積木邊緣，做事很細心。","搭建出溫暖的家，情感投射很細膩。"],
    "益智區": ["喜歡玩拼圖，視覺空間能力大幅提升。","能專注完成任務，培養了極佳耐心。","擅長圖形配對遊戲，觀察力很敏銳。","鏡分色分類，邏輯思考越來越清晰。","喜歡玩走迷宮，解決問題能力增強。","能按順序排列大小，建立序列概念。","記憶力遊戲表現好，能記住圖案位置。","挑戰高片數拼圖，展現不放棄的精神。","喜歡玩七巧板，幾何形狀組合力強。","數量對應正確，數學基礎打得很穩。","能找出圖中不同處，視覺辨識極佳。","樂於挑戰桌遊，學會遵守遊戲規則。","喜歡穿線遊戲，手眼協調精細度高。","能獨立思考解謎，享受腦力激盪。","會用算珠數數，數字概念逐漸成形。","喜歡玩形狀盒，空間對應能力很棒。","能發現排列規規，邏輯推理大躍進。","樂於與同儕切磋，培養良性競爭心。","懂得輸贏的態度，情緒管理進步了。","喜歡玩齒輪玩具，探索物理連動原理。","能精準扣上鈕扣，小肌肉發展成熟。","喜歡玩天平秤重，理解了輕重對比。","空間迷宮難不倒他，方向感非常好。","能將圖卡分類歸納，組織能力增強。","喜歡玩連連看，數序觀念十分清楚。","能耐心拆解立體謎題，專注力十足。","喜歡玩記憶翻牌，大腦反應很迅速。","能分辨左右方向，空間認知發展好。","透過桌遊學會等待，耐心大有長進。","喜歡測量物件長短，建立長度概念。","能運用策略玩遊戲，思考十分周密。","拼圖速度越來越快，熟練度大提升。","喜歡玩數獨基礎版，邏輯運算超棒。","會用夾子夾毛球，鍛鍊了手指握力。","能理解部分與整體，認知發展成熟。","喜歡玩時鐘玩具，時間概念萌芽了。","樂意教導同伴玩，展現小老師風範。","能準確套圈圈，距離估算能力很好。","喜歡玩影子配對，形狀辨識度很高。","透過釣魚遊戲，訓練了手部穩定度。","能完成對稱圖形，具備幾何對稱感。","喜歡玩五子棋，策略規劃能力極佳。","懂得整理益智教具，養成收納好習慣。","能夠專心串珠，顏色排序完全正確。","喜歡玩骨牌連鎖，理解了因果關係。","能分辨厚薄差異，觸覺與視覺結合。","喜歡玩空間積木，立體建構力很強。","能夠找出隱藏圖案，圖地覺察力佳。","喜歡玩數字接龍，對數字十分敏感。","益智挑戰過關，展現自信燦爛笑容。"],
    "生活自理區": ["能夠自己穿脫外套，生活自理大進步。","喜歡練習扣鈕扣，手指精細動作靈活。","會自己拉上拉鍊，獨立完成不求人。","懂得自己穿鞋襪，左右腳分辨正確。","能夠安靜摺衣服，步驟記得非常清楚。","喜歡幫忙擦桌子，展現熱心助人精神。","會自己倒水喝，手部穩定度大大提升。","懂得使用夾子夾食物，手眼協調佳。","洗手步驟很確實，養成良好衛生習慣。","吃飯能用湯匙舀湯，不會弄髒桌面。","喜歡練習綁鞋帶，展現極佳的耐心。","懂得自己整理書包，負責態度很棒。","能夠擰乾小毛巾，手腕力量變大了。","會自己梳頭髮，注重個人儀容整潔。","懂得分類垃圾，環保意識從小扎根。","喜歡幫盆栽澆水，培養了愛護生命心。","能夠獨立如廁，生活習慣非常良好。","會自己剝橘子皮，手指小肌肉有力。","懂得使用抹布清潔，做事非常細心。","喜歡練習切水果玩具，學習安全常識。","能把餐具收拾整齊，做事有條不紊。","懂得咳嗽要遮口鼻，注重健康禮儀。","會自己掛好毛巾，養成物品歸位習慣。","喜歡練習鎖螺絲，手部旋轉能力強。","能夠安靜午休，自我情緒調節很好。","會自己拉袖子洗手，生活技能熟練。","懂得使用掃把畚箕，維護環境整潔。","能夠自己打開點心盒，獨立解決問題。","喜歡練習倒豆子，專注力讓人驚豔。","懂得將水壺擺放整齊，注重團隊紀律。","會自己摺棉被，生活作息非常有規律。","能夠分辨冷熱水，具備基本安全常識。","喜歡練習打結，手指靈巧度大幅提升。","懂得愛惜食物不浪費，品格教育極佳。","能夠獨立完成洗碗，是老師的好幫手。","會自己脫帽子放好，動作十分俐落。","懂得排隊輪流洗手，具備良好社會性。","喜歡練習使用筷子，手部發展很成熟。","能夠察覺衣服弄髒，主動要求更換。","懂得自己擦鼻涕，保持臉部清潔乾淨。","喜歡幫娃娃穿衣服，同理心發展良好。","能夠把椅子靠攏，養成良好教室常規。","會自己拉開窗簾，感受陽光的溫暖。","懂得愛護個人物品，不輕易弄丟東西。","喜歡練習用滴管，控制力道十分精準。","能夠自己塗抹乳液，學習照顧自己。","會將用過衛生紙丟掉，衛生習慣很好。","懂得自己拿拖鞋穿，動作協調不跌倒。","喜歡練習拉抽屜，學會控制拉的力道。","能夠獨立完成例行事務，充滿自信心。"],
    "組合建構區": ["喜歡組裝模型，立體空間概念極佳。","能照說明書拼裝，邏輯順序非常清楚。","擅長使用齒輪積木，理解物理連動原理。","組合過程很專注，培養了解決問題能力。","喜歡玩雪花片，創意造型變化萬千。","能夠拆解重組，展現了強烈的實驗精神。","運用卡榫積木，鍛鍊手指精細力量。","組裝出汽車模型，手眼協調能力大增。","樂於與同伴合作組裝，發揮團隊默契。","喜歡玩磁力片，探索磁性相吸與相斥。","能夠創造獨特飛行器，想像力十分豐富。","懂得分類零件，養成收納的好習慣。","組裝結構十分穩固，具備工程師潛力。","喜歡玩水管積木，空間延伸概念很好。","能耐心尋找正確零件，觀察力很敏銳。","遇到困難不放棄，抗壓性與毅力極佳。","喜歡組裝機器人，對科技有濃厚興趣。","能夠說出組裝步驟，口語表達很有條理。","運用螺絲起子玩具，手部旋轉技巧好。","組裝出立體城堡，幾何美感十分出色。","喜歡挑戰高難度套件，勇於突破自我。","能夠自由發揮創意，不受限於說明書。","組合出長長火車，序列概念建立完整。","喜歡玩樂高組裝，小肌肉發展非常成熟。","懂得欣賞別人作品，社會互動表現佳。","組裝速度越來越快，動作十分熟練。","喜歡將不同材質結合，創新思維很棒。","能夠組裝對稱模型，空間對稱感極佳。","發現卡住會自己調整，修正能力很強。","喜歡玩關節積木，理解物體活動關節。","組合出摩天輪，對旋轉力學充滿好奇。","能夠精準卡入細小零件，專注力驚人。","喜歡挑戰平衡結構，物理概念萌芽了。","懂得將作品命名，語文與遊戲完美結合。","組裝出動物園，展現對生活環境的觀察。","喜歡玩吸盤玩具，探索真空吸附原理。","能夠估算需要的零件數量，數感很好。","遇到倒塌能勇敢重來，挫折忍受力高。","喜歡將模型展示分享，充滿了成就感。","組合出高塔，了解底部寬大才穩固的道理。","能夠拆解自己作品，學習物歸原位。","喜歡玩棒狀建構玩具，線條空間感佳。","組裝過程充滿笑容，十分享受動手做。","懂得請老師幫忙，遇到困難會主動求援。","喜歡玩軌道組裝，邏輯規劃能力很棒。","能夠組裝出吊車，對機械構造有概念。","發現零件不見會主動尋找，十分負責。","喜歡組裝立體迷宮，三維空間感強烈。","能夠將想像化為實體，實踐能力極佳。","組裝作品充滿細節，觀察入微值得肯定。"]
};

// ==================== 詞庫彈窗 ====================
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



// ==================== 備份 / 還原 / 自動備份 ====================
const FS_OK = 'showDirectoryPicker' in window;
let dirHandle = null;
let backupDirty = false;
let autoTimer = null;
let askedFolder = false;
let lastAutoInfo = '';

function pad(n) { return String(n).padStart(2, '0'); }
function stamp(withTime) {
    const d = new Date();
    const s = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    return withTime ? `${s}_${pad(d.getHours())}${pad(d.getMinutes())}` : s;
}
function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').trim(); }

function markChanged() {
    backupDirty = true;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => autoBackup(), 30000);   // 停止編輯 30 秒後自動備份
}

async function dirPermission(request) {
    if (!dirHandle) return false;
    const o = { mode: 'readwrite' };
    try {
        if (await dirHandle.queryPermission(o) === 'granted') return true;
        if (request && await dirHandle.requestPermission(o) === 'granted') return true;
    } catch (e) { /* ignore */ }
    return false;
}

// 所有寫入排隊執行（避免同一個檔案被同時寫入而互相破壞）
let writeChain = Promise.resolve();
function writeFileTo(name, blob) {
    const run = () => writeFileOnce(name, blob);
    const p = writeChain.then(run, run);
    writeChain = p.catch(() => {});
    return p;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function writeFileOnce(name, blob) {
    const buf = await blob.arrayBuffer();
    let stage = '';
    const st = (label, fn) => { stage = label; return fn(); };
    const verify = async () => {
        const f = await (await dirHandle.getFileHandle(name)).getFile();
        if (f.size !== buf.byteLength) throw Object.assign(new Error('size'), { name: 'SizeMismatch' });
    };
    const strategies = [
        async () => {   // A：標準寫法
            const fh = await st('建立', () => dirHandle.getFileHandle(name, { create: true }));
            const w = await st('開啟', () => fh.createWritable());
            await st('寫入', () => w.write(blob));
            await st('關閉', () => w.close());
        },
        async () => {   // B：稍等後重新取得檔案，改用位置寫入
            await sleep(400);
            const fh = await st('建立', () => dirHandle.getFileHandle(name, { create: true }));
            const w = await st('開啟', () => fh.createWritable({ keepExistingData: false }));
            await st('寫入', () => w.write({ type: 'write', position: 0, data: buf }));
            await st('關閉', () => w.close());
        },
        async () => {   // C：清掉殘留檔後重建，先讀取一次更新狀態
            for (const n of [name, name + '.crswap']) { try { await dirHandle.removeEntry(n); } catch (e) { /* ignore */ } }
            await sleep(600);
            const fh = await st('建立', () => dirHandle.getFileHandle(name, { create: true }));
            await st('讀取', () => fh.getFile());
            const w = await st('開啟', () => fh.createWritable({ keepExistingData: true }));
            await st('截斷', () => w.truncate(0));
            await st('寫入', () => w.write(buf));
            await st('關閉', () => w.close());
        },
    ];
    const diag = [];
    for (let i = 0; i < strategies.length; i++) {
        try {
            await strategies[i]();
            await st('驗證', verify);
            return;
        } catch (e) {
            diag.push(`${'ABC'[i]}-${stage}:${(e && e.name) || e}`);
            if (e && e.name === 'NotAllowedError') break;
        }
    }
    for (const n of [name, name + '.crswap']) {   // 清掉 0 KB 殘留
        try { await dirHandle.removeEntry(n); } catch (e) { /* ignore */ }
    }
    throw new Error(`寫入失敗 [${diag.join(' ｜ ')}]。請把這行文字截圖給我；也可先改選「文件」裡的資料夾測試。`);
}

async function buildBackup() {
    await saveNow();
    const records = {};
    for (const s of seats) records[s] = await kvGet('rec:' + s);
    return { app: 'learn-record', version: 1, exportedAt: new Date().toISOString(), seats, records };
}

function backupBlob(obj) {
    return new Blob([JSON.stringify(obj)], { type: 'application/json' });
}

let autoRunning = false;
async function autoBackup() {
    if (!dirHandle || !backupDirty || autoRunning) return;
    autoRunning = true;
    try { await autoBackupInner(); } finally { autoRunning = false; }
}
async function autoBackupInner() {
    if (!(await dirPermission(false))) { updateBackupUI(); return; }
    try {
        const obj = await buildBackup();
        await writeFileTo(`學習區自動備份_${stamp(false)}.json`, backupBlob(obj));
        // 只保留最近 7 份自動備份
        const names = [];
        for await (const [n] of dirHandle.entries()) if (n.startsWith('學習區自動備份_')) names.push(n);
        names.sort();
        while (names.length > 7) await dirHandle.removeEntry(names.shift());
        backupDirty = false;
        lastAutoInfo = `最近自動備份：${new Date().toLocaleString()}`;
    } catch (e) {
        console.warn('自動備份失敗', e);
        lastAutoInfo = '⚠️ 自動備份失敗：' + ((e && e.message) || e);
    }
    updateBackupUI();
}

// 在使用者點擊時呼叫（需要手勢才能重新授權資料夾）
async function ensureDirAccess() {
    if (dirHandle) return dirPermission(true);
    return false;
}

async function chooseFolder() {
    if (!FS_OK) { setBackupMsg('此瀏覽器不支援選擇資料夾，備份會改用「分享 / 下載」。', 'error'); return; }
    try {
        let h;
        try { h = await window.showDirectoryPicker({ id: 'learn-record', mode: 'readwrite', startIn: 'downloads' }); }
        catch (e) { if (e && e.name === 'AbortError') throw e; h = await window.showDirectoryPicker({ mode: 'readwrite' }); }
        dirHandle = h;
        await kvSet('dirHandle', h);
        backupDirty = true;
        setBackupMsg(`✅ 已設定資料夾「${h.name}」：備份與 PDF 都會存到這裡`, 'ok');
        await autoBackup();
    } catch (e) {
        if (e && e.name !== 'AbortError') setBackupMsg('❌ 這個資料夾系統不允許使用（例如「下載」本身）。請在選擇畫面進入 Download ➜ 新增資料夾「學習區」➜ 選它；若仍不行，改在「文件」裡建立「學習區」。', 'error');
    }
    updateBackupUI();
}

async function restoreAutoAccess() {
    if (await dirPermission(true)) { setBackupMsg('✅ 已恢復自動備份', 'ok'); backupDirty = true; autoBackup(); }
    else setBackupMsg('❌ 未取得資料夾權限', 'error');
    updateBackupUI();
}

function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function manualBackup() {
    setBackupMsg('');
    const useDir = await ensureDirAccess();
    if (!useDir && FS_OK) {
        setBackupMsg(dirHandle ? '❌ 資料夾尚未授權，請按下方「🔓 恢復自動備份」' : '請先按上方「📁 設定「學習區」資料夾」（只需設定一次）', 'error');
        updateBackupUI();
        return;
    }
    const obj = await buildBackup();
    const name = `學習區備份_${stamp(true)}.json`;
    const blob = backupBlob(obj);
    try {
        if (useDir) {
            await writeFileTo(name, blob);
            setBackupMsg(`✅ 已備份到「${dirHandle.name}」：${name}`, 'ok');
            backupDirty = false;
            return;
        }
        const f = new File([blob], name, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) {
            await navigator.share({ files: [f], title: name });
            setBackupMsg('✅ 已開啟分享面板，請選擇要存放的位置', 'ok');
        } else {
            downloadBlob(blob, name);
            setBackupMsg('✅ 已下載到手機「下載」資料夾', 'ok');
        }
    } catch (e) {
        if (e && e.name !== 'AbortError') setBackupMsg('❌ 備份失敗：' + (e.message || e), 'error');
    }
}

async function restoreBackup(file) {
    try {
        const obj = JSON.parse(await file.text());
        if (!obj || obj.app !== 'learn-record' || !obj.records || !Array.isArray(obj.seats)) throw new Error('這不是本系統的備份檔');
        if (!confirm(`即將還原 ${obj.seats.length} 個座號的資料，會取代目前所有紀錄。\n（還原前會先自動留一份現況快照）\n確定要還原嗎？`)) return;
        await kvSet('prevSnapshot', await buildBackup());
        for (const s of seats) await kvDel('rec:' + s);
        seats = obj.seats.map(String).sort(sortSeats);
        seatNames = {};
        for (const s of seats) {
            const r = obj.records[s];
            if (r) { await kvSet('rec:' + s, r); seatNames[s] = r.studentName || ''; }
        }
        await kvSet('seats', seats);
        currentSeat = seats[0];
        await kvSet('lastSeat', currentSeat);
        await loadRecordToForm(currentSeat);
        renderTabs();
        setBackupMsg(`✅ 已還原 ${seats.length} 個座號`, 'ok');
    } catch (e) {
        setBackupMsg('❌ 還原失敗：' + (e.message || e), 'error');
    }
}

function setBackupMsg(text, type) {
    const el = $('backupMsg');
    el.textContent = text || '';
    el.className = 'pdf-msg' + (type ? ' ' + type : '');
}

async function updateBackupUI() {
    let s;
    if (!FS_OK) s = '此瀏覽器無法選擇資料夾：備份會用「分享 / 下載」。';
    else if (!dirHandle) s = '尚未設定備份資料夾（設定後才會自動備份）。';
    else if (await dirPermission(false)) s = `自動備份：開啟（資料夾「${dirHandle.name}」）。${lastAutoInfo}`;
    else s = `⚠️ 資料夾「${dirHandle.name}」需要重新授權，自動備份暫停。`;
    $('backupStatus').textContent = s;
    $('restoreAccessBtn').style.display = (dirHandle && !(await dirPermission(false))) ? 'block' : 'none';
    $('backupWarn').style.display = (dirHandle && !(await dirPermission(false))) ? 'inline' : 'none';
}

function openBackupModal() {
    setBackupMsg('');
    updateBackupUI();
    $('backupModal').style.display = 'flex';
}
function closeBackupModal() { $('backupModal').style.display = 'none'; }

// ==================== 輸出 PDF（選座號：個別 / 合併） ====================
let pdfBusy = false;

async function openPdfMenu() {
    await saveNow();
    const box = $('pdfSeatList');
    box.innerHTML = '';
    seats.forEach(s => {
        const lb = document.createElement('label');
        lb.className = 'seat-pick-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.value = s; cb.checked = (s === currentSeat);
        const sp = document.createElement('span');
        const nm = (seatNames[s] || '').trim();
        sp.textContent = nm ? `${s} 號 ${nm}` : `${s} 號`;
        lb.appendChild(cb); lb.appendChild(sp);
        box.appendChild(lb);
    });
    setPdfMsg('');
    $('pdfMenuModal').style.display = 'flex';
}

function closePdfMenu() { if (!pdfBusy) $('pdfMenuModal').style.display = 'none'; }

function pdfSelectAll(on) {
    document.querySelectorAll('#pdfSeatList input').forEach(c => c.checked = on);
}

function setPdfMsg(text, type) {
    const el = $('pdfMsg');
    el.textContent = text || '';
    el.className = 'pdf-msg' + (type ? ' ' + type : '');
}

// 複製目前畫面上的表單（連同輸入值），供列印使用
function cloneFormSnapshot() {
    const src = $('recordForm');
    const c = src.cloneNode(true);
    const sf = src.querySelectorAll('input,textarea,select');
    const cf = c.querySelectorAll('input,textarea,select');
    sf.forEach((s, i) => {
        const d = cf[i];
        if (s.type === 'checkbox' || s.type === 'radio') {
            d.checked = s.checked;
            if (s.checked) d.setAttribute('checked', ''); else d.removeAttribute('checked');
        } else if (s.tagName === 'TEXTAREA') {
            d.value = s.value; d.textContent = s.value;
        } else if (s.tagName === 'SELECT') {
            Array.from(d.options).forEach(o => { o.selected = (o.value === s.value); if (o.selected) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
        } else {
            d.setAttribute('value', s.value); d.value = s.value;
        }
    });
    c.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
    c.removeAttribute('id');
    return c;
}

// 取出「列印版」CSS：@media print 規則攤平成一般規則，捨棄 @media screen 規則
function buildPrintCss() {
    const conv = (r) => {
        if (r.type === CSSRule.MEDIA_RULE) {
            const m = r.media.mediaText || '';
            if (/print/.test(m)) return Array.from(r.cssRules).map(conv).join('\n');
            return '';
        }
        if (r.type === CSSRule.PAGE_RULE) return '';
        return r.cssText;
    };
    let out = '';
    for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const r of Array.from(rules)) out += conv(r) + '\n';
    }
    return out;
}

const PAGE_W = 794, PAGE_H = 1123;   // A4 @96dpi (210mm x 297mm)

// 用瀏覽器本身把列印版面畫成 JPEG（與列印結果相同的排版）
async function renderPageToJpeg(node, css, scale) {
    const xhtml = new XMLSerializer().serializeToString(node);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}"><foreignObject x="0" y="0" width="${PAGE_W}" height="${PAGE_H}"><body xmlns="http://www.w3.org/1999/xhtml" style="width:${PAGE_W}px;height:${PAGE_H}px;background:#fff;overflow:hidden;"><style><![CDATA[${css}]]></style>${xhtml}</body></foreignObject></svg>`;
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);   // blob: 網址會讓 canvas 被標記為污染
    try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('版面轉圖失敗')); img.src = url; });
        if (img.decode) { try { await img.decode(); } catch (e) { /* ignore */ } }
        await new Promise(r => setTimeout(r, 120));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(PAGE_W * scale);
        canvas.height = Math.round(PAGE_H * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('無法輸出圖片')), 'image/jpeg', 0.92));
        const out = { bytes: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height };
        canvas.width = 0; canvas.height = 0;
        return out;
    } finally { /* data URL 不需釋放 */ }
}

// 最簡 PDF 組裝：每頁一張滿版 A4 JPEG
function buildPdf(pages) {
    const enc = new TextEncoder();
    const chunks = [];
    let offset = 0;
    const offs = [];
    const push = (d) => { const u = typeof d === 'string' ? enc.encode(d) : d; chunks.push(u); offset += u.length; };
    const n = pages.length;
    push('%PDF-1.4\n');
    offs[1] = offset; push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    const kids = pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ');
    offs[2] = offset; push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`);
    pages.forEach((p, i) => {
        const po = 3 + 3 * i, co = po + 1, io = po + 2;
        offs[po] = offset;
        push(`${po} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${io} 0 R >> >> /Contents ${co} 0 R >>\nendobj\n`);
        const content = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
        offs[co] = offset;
        push(`${co} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
        offs[io] = offset;
        push(`${io} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);
        push(p.bytes);
        push('\nendstream\nendobj\n');
    });
    const total = 3 + 3 * n;
    const xrefPos = offset;
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
}

// 直接產生 PDF 並寫入「學習區」資料夾（版面與列印版相同；文字為圖片，無法選取）
async function renderPdfToFolder(order, fileName) {
    const css = buildPrintCss();
    const pages = [];
    for (let i = 0; i < order.length; i++) {
        setPdfMsg(`⏳ 產生中 (${i + 1}/${order.length})...`);
        await loadRecordToForm(order[i]);
        const node = cloneFormSnapshot();
        pages.push(await renderPageToJpeg(node, css, 2.5));
    }
    await writeFileTo(fileName + '.pdf', buildPdf(pages));
}

async function exportPdf(mode) {
    if (pdfBusy) return;
    const picked = Array.from(document.querySelectorAll('#pdfSeatList input:checked')).map(c => c.value);
    if (!picked.length) { setPdfMsg('請先勾選座號', 'error'); return; }
    if (mode === 'single' && picked.length !== 1) {
        setPdfMsg('「個別轉出」一次請只勾選 1 個座號；要多個合成一份請按「合併輸出」。', 'error');
        return;
    }
    if (mode === 'merge' && picked.length < 2) {
        setPdfMsg('「合併輸出」請至少勾選 2 個座號。', 'error');
        return;
    }
    const wantPrint = $('pdfUsePrint').checked;
    let toFolder = false;
    if (!wantPrint) {
        if (!dirHandle && FS_OK) {
            setPdfMsg('請先按下方「📁 設定「學習區」資料夾」（只需設定一次）', 'error');
            return;
        }
        toFolder = !!dirHandle && await dirPermission(true);
        if (dirHandle && !toFolder) { setPdfMsg('❌ 資料夾尚未授權，請再按一次，或重新設定資料夾', 'error'); return; }
    }

    pdfBusy = true;
    const original = currentSeat;
    try {
        await saveNow();
        const order = seats.filter(s => picked.includes(s));
        const cls = $('className').value || '';
        const first = seatNames[order[0]] || '';
        const name = mode === 'single'
            ? safeName(`${cls}_${order[0]}號_${first || '未命名'}_學習區紀錄`)
            : safeName(`${cls}_學習區紀錄_合併_${order.length}份_${stamp(false)}`);

        if (toFolder) {
            try {
                await renderPdfToFolder(order, name);
                await loadRecordToForm(original);
                $('pdfMenuModal').style.display = 'none';
                alert(`✅ 已存入「${dirHandle.name}」：${name}.pdf`);
            } catch (e) {
                console.error(e);
                await loadRecordToForm(original);
                setPdfMsg('❌ 直接存入失敗：' + (e.message || e) + '。可勾選下方「改用系統列印預覽」再試。', 'error');
            }
            return;
        }

        // 系統列印預覽（版面最精準，但存放位置要在儲存視窗自己選）
        const batch = $('printBatch');
        batch.innerHTML = '';
        for (const s of order) {
            await loadRecordToForm(s);
            batch.appendChild(cloneFormSnapshot());
        }
        await loadRecordToForm(original);
        $('pdfMenuModal').style.display = 'none';
        document.body.classList.add('batch-print');
        document.title = name;
        setTimeout(() => window.print(), 400);
    } catch (e) {
        console.error(e);
        setPdfMsg('❌ 產生失敗：' + (e.message || e), 'error');
    } finally {
        pdfBusy = false;
    }
}

window.addEventListener('afterprint', () => {
    document.body.classList.remove('batch-print');
    $('printBatch').innerHTML = '';
    updateDocumentTitle();
});

// ==================== 相片來源選擇邏輯 ====================
let currentPhotoIndex = null;

// 打開相片來源視窗
function openPhotoSourceModal(index) {
    currentPhotoIndex = index;
    $('photoSourceModal').style.display = 'flex';
}

// 關閉相片來源視窗
function closePhotoSourceModal() {
    $('photoSourceModal').style.display = 'none';
    currentPhotoIndex = null;
}

// 選擇來源並觸發上傳
function selectPhotoSource(source) {
    if (!currentPhotoIndex) return;
    
    const fileInput = $('file' + currentPhotoIndex);
    
    // 如果選擇相機，加上 capture 屬性強制開啟後鏡頭；否則移除該屬性開啟相簿
    if (source === 'camera') {
        fileInput.setAttribute('capture', 'environment');
    } else {
        fileInput.removeAttribute('capture');
    }
    
    // 關閉視窗並觸發隱藏的檔案上傳輸入框
    closePhotoSourceModal();
    fileInput.click();
}

