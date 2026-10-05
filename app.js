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
    const input = event.target;
    const file = input.files[0];
    if (!file) return;

    showLoading('📸 正在讀取圖片...');

    try {
        const dataSrc = await readImageFile(file);
        const img = await loadImage(dataSrc);
        input.value = '';          // 允許之後再選同一張
        hideLoading();

        // 先讓使用者裁剪（取消則不變更原本的照片）
        const area = await openCropper(img, dataSrc);
        if (!area) return;

        showLoading('📸 正在壓縮圖片...');
        const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
        const sx = area === 'full' ? 0 : area.sx, sy = area === 'full' ? 0 : area.sy;
        const sw = area === 'full' ? nw : area.sw, sh = area === 'full' ? nh : area.sh;

        const canvas = document.createElement('canvas');
        const MAX_SIZE = 600;
        let width = sw, height = sh;

        if (width > height && width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
        } else if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
        }

        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

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

// ==================== 相片裁剪 ====================
const CROP_MIN = 30;     // 裁剪框最小邊長（顯示像素）
let cropState = null;

function openCropper(img, dataSrc) {
    return new Promise((resolve) => {
        const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
        const maxW = Math.min(window.innerWidth * 0.94 - 60, 600);
        const maxH = window.innerHeight * 0.58;
        const scale = Math.min(maxW / nw, maxH / nh);
        const dispW = Math.max(60, Math.round(nw * scale));
        const dispH = Math.max(60, Math.round(nh * scale));

        const stage = $('cropStage');
        stage.style.width = dispW + 'px';
        stage.style.height = dispH + 'px';
        $('cropImg').src = dataSrc;

        cropState = { resolve, nw, nh, dispW, dispH, rect: { x: 0, y: 0, w: dispW, h: dispH }, drag: null };
        drawCropRect();
        $('cropModal').style.display = 'flex';
    });
}

function drawCropRect() {
    const r = cropState.rect, el = $('cropRect');
    el.style.left = r.x + 'px'; el.style.top = r.y + 'px';
    el.style.width = r.w + 'px'; el.style.height = r.h + 'px';
}

// ratio = 0 代表全圖；否則套用「置中、最大」的該比例框
function cropPreset(ratio) {
    if (!cropState) return;
    const { dispW, dispH } = cropState;
    let w = dispW, h = dispH;
    if (ratio > 0) {
        if (dispW / dispH > ratio) { w = dispH * ratio; } else { h = dispW / ratio; }
    }
    cropState.rect = { x: (dispW - w) / 2, y: (dispH - h) / 2, w, h };
    drawCropRect();
}

function cropFinish(action) {
    if (!cropState) return;
    const st = cropState;
    cropState = null;
    $('cropModal').style.display = 'none';
    $('cropImg').src = '';
    if (action === 'cancel') { st.resolve(null); return; }
    if (action === 'full') { st.resolve('full'); return; }
    const k = st.nw / st.dispW, kh = st.nh / st.dispH;
    let sx = Math.round(st.rect.x * k), sy = Math.round(st.rect.y * kh);
    let sw = Math.round(st.rect.w * k), sh = Math.round(st.rect.h * kh);
    sx = Math.min(Math.max(0, sx), st.nw - 1); sy = Math.min(Math.max(0, sy), st.nh - 1);
    sw = Math.max(1, Math.min(sw, st.nw - sx)); sh = Math.max(1, Math.min(sh, st.nh - sy));
    st.resolve({ sx, sy, sw, sh });
}

(function initCropper() {
    const el = $('cropRect');
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
        if (!cropState) return;
        const h = e.target.dataset && e.target.dataset.h ? e.target.dataset.h : 'move';
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        cropState.drag = { h, px: e.clientX, py: e.clientY, r: { ...cropState.rect } };
    });
    el.addEventListener('pointermove', (e) => {
        if (!cropState || !cropState.drag) return;
        const d = cropState.drag, { dispW, dispH } = cropState;
        const dx = e.clientX - d.px, dy = e.clientY - d.py;
        let { x, y, w, h } = d.r;
        const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
        if (d.h === 'move') {
            x = clamp(d.r.x + dx, 0, dispW - w);
            y = clamp(d.r.y + dy, 0, dispH - h);
        } else {
            if (d.h.includes('w')) { x = clamp(d.r.x + dx, 0, d.r.x + d.r.w - CROP_MIN); w = d.r.x + d.r.w - x; }
            if (d.h.includes('e')) { w = clamp(d.r.w + dx, CROP_MIN, dispW - d.r.x); }
            if (d.h.includes('n')) { y = clamp(d.r.y + dy, 0, d.r.y + d.r.h - CROP_MIN); h = d.r.y + d.r.h - y; }
            if (d.h.includes('s')) { h = clamp(d.r.h + dy, CROP_MIN, dispH - d.r.y); }
        }
        cropState.rect = { x, y, w, h };
        drawCropRect();
    });
    const end = () => { if (cropState) cropState.drag = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
})();

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

// ==================== 600 條重點能力詞庫資料 ====================
const dictData = {
    "美勞區": ["喜歡探索色彩，畫作充滿想像力。","能運用多種媒材，展現豐富創造力。","握筆姿勢進步，線條描繪越來越穩。","能專注剪紙，手眼協調能力提升了。","對黏土捏塑有興趣，手部小肌肉靈活。","喜歡動手做勞作，展現獨特藝術美感。","能大膽運用色彩，表達內心的想法。","撕貼技巧熟練，完成品十分精美。","塗鴉時充滿自信，能分享創作故事。","喜歡嘗試新畫材，發揮無限創意。","運用水彩畫畫，色彩層次十分豐富。","能耐心完成作品，專注力值得肯定。","剪刀使用越來越順手，能剪出形狀。","喜歡摺紙活動，空間概念逐漸成形。","能運用廢棄物，改造成有趣的玩具。","畫作構圖完整，能畫出具體的事物。","透過玩色遊戲，增進了視覺敏銳度。","樂於分享畫作，口語表達能力進步。","能仔細觀察事物，並表現在畫作上。","捏塑立體造型，空間感知能力提升。","手指畫充滿童趣，觸覺刺激發展好。","喜歡拓印遊戲，發現圖案的變化。","能獨立完成勞作，自信心大大增加。","著色不超線，手部控制能力很好。","運用點線面元素，豐富了畫面層次。","喜歡串珠珠，精細動作越來越棒了。","能用畫筆畫出家人，情感表達豐富。","享受玩泥巴的樂趣，觸覺發展良好。","剪貼形狀組合，激發了幾何想像力。","畫畫時充滿笑容，十分享受創作。","喜歡揉捏黏土，增進手掌的力量。","能仔細黏貼素材，做事態度很細心。","對色彩敏銳，能調配出美麗的顏色。","運用樹葉作畫，親近大自然的美。","能夠收拾畫具，養成良好的好習慣。","勞作充滿巧思，展現解決問題能力。","喜歡玩印章，對圖騰感到十分好奇。","畫圖能表達情緒，是很好的抒發。","能與同伴合作畫畫，發揮團隊精神。","剪紙對稱圖形，理解了對稱的概念。","喜歡做卡片，懂得表達感恩的心。","運用毛線創作，體驗不同材質的美。","畫作充滿活力，展現出開朗的個性。","能細心妝點作品，美感經驗大提升。","運用海綿蓋印，訓練手腕靈活度。","喜歡玩沙畫，專注力與耐心俱佳。","能夠大面積塗色，手背肌肉更有力。","透過捏麵人，認識傳統藝術之美。","勞作設計獨特，具有個人風格特色。","畫作內容豐富，展現敏銳觀察力。","喜歡用蠟筆塗色，握筆力道越來越穩定。","能運用剪刀剪出曲線，手部控制進步。","對拼貼創作有興趣，懂得選擇素材。","喜歡玩吹畫遊戲，感受顏料流動變化。","能畫出自己的房子，空間概念逐漸清楚。","運用瓦楞紙創作，展現立體造型能力。","喜歡用粉筆在地上作畫，肢體動作放得開。","能說出作品的創作想法，語言表達清晰。","願意嘗試混色實驗，發現色彩的奧秘。","摺紙時步驟清楚，專注完成每一個折痕。","喜歡用棉花棒點畫，指尖控制穩定。","能運用不同線條，畫出雨滴與陽光。","喜歡製作面具，並能開心扮演角色。","創作時不怕弄髒，樂於感受各種材質。","能將紙張撕成小片，拼出完整圖案。","喜歡刮畫活動，驚喜於顏色浮現。","能依主題創作，聯想力與想像力兼具。","畫作中有人物與背景，構圖概念成熟。","樂於布置教室作品，展現主人翁精神。","喜歡用黏土做食物，生活經驗融入創作。","能均勻塗抹膠水，黏貼動作越來越細緻。","懂得欣賞同伴作品，並給予溫暖回饋。","嘗試用海綿拓印，發現圖案重複的美。","能運用色紙剪貼，完成對稱的蝴蝶。","喜歡畫天空與星星，充滿浪漫的想像。","創作態度認真，作品完成度越來越高。","能控制水量調色，水彩運用更加純熟。","喜歡用吸管吹顏料，肺活量與創意並進。","製作卡片時用心，懂得向他人表達關心。","樂於嘗試不同工具，探索力十分旺盛。","能把黏土搓成長條，再盤出各種造型。","喜歡畫自己的心情，情緒表達很真誠。","畫面色彩大膽明亮，展現開朗的個性。","能用雙手撕紙貼畫，雙手協調性良好。","喜歡裝飾紙盤，發揮豐富的美感巧思。","完成作品後能主動整理桌面，習慣良好。","能觀察落葉的紋路，並用畫筆呈現。","喜歡摺出紙飛機，並測試飛行的遠近。","運用圓形與方形，組合出有趣的圖案。","在創作中專心投入，不受旁人影響。","能用手指沾顏料作畫，樂在其中。","願意與同伴共同創作，學習分工合作。","喜歡畫動物園的動物，觀察入微。","能耐心完成細小的黏貼，專注力佳。","會替作品加上標題，語文與美勞結合。","喜歡玩紙黏土，捏出作品充滿童趣。","能依序完成勞作步驟，條理清楚。","運用多種顏色漸層，畫面柔和有層次。","喜歡剪貼雜誌圖片，編成自己的故事。","創作時自信大方，樂於向大家介紹作品。"],
    "語文區": ["喜歡翻閱繪本，培養了良好閱讀習慣。","能專注聽故事，聽覺理解能力很棒。","樂於分享故事，口語表達越來越流利。","認得許多常見字，文字敏感度提升。","能看圖說故事，發揮了無窮想像力。","喜歡聽兒歌，跟著節奏快樂地哼唱。","會主動問問題，展現強烈求知慾望。","能記住故事內容，記憶力十分出色。","喜歡玩字卡，認識了好多新詞彙。","說話咬字清晰，能完整表達想法。","樂意與同伴交談，人際互動能力佳。","能模仿故事角色，展現戲劇天分。","喜歡聽錄音帶，培養獨立學習能力。","會用圖畫記錄故事，讀寫萌發進步。","能說出完整句子，語法結構很正確。","對文字充滿好奇，主動詢問字怎麼唸。","能安靜看書，專注力可以持續很久。","喜歡玩猜謎遊戲，邏輯思考大躍進。","會念簡單唐詩，感受語文的韻律美。","能聽懂老師指令，並確實做出動作。","樂於參與討論，勇於發表自己見解。","喜歡角色扮演，語言使用更情境化。","能用豐富詞彙，描述發生的事情。","會愛惜書本，懂得輕輕翻閱圖畫書。","能分辨不同聲音，聽覺辨識力很好。","喜歡聽神話故事，想像空間更廣闊。","能回答故事問題，理解能力大提升。","說話音量適中，懂得在室內輕聲細語。","喜歡念順口溜，舌頭肌肉更靈活了。","能夠覆述聽過的話，專注傾聽很棒。","喜歡看科普圖畫書，增廣見聞。","會用積木排字，將語文融入遊戲中。","喜歡聽大野狼故事，能分辨善惡。","樂於在大家面前說話，展現大將之風。","能將字卡配對，視覺辨識能力提升。","喜歡指讀文字，建立文字與聲音連結。","會用手指偶說故事，手腦並用很棒。","能夠說出自己的名字，並認得寫法。","喜歡聽床邊故事，情緒感到很穩定。","說話有禮貌，常說請謝謝對不起。","能形容物品特徵，詞彙量大幅增加。","喜歡玩文字接龍，反應十分敏捷。","能耐心聽別人說完話，懂得尊重人。","喜歡聽動物叫聲，學習模仿發音。","能夠理解相反詞，語文邏輯很清晰。","喜歡看立體書，引發強烈閱讀興趣。","會用不同語氣說話，表達情緒起伏。","能夠分辨相似的發音，聽力很敏銳。","喜歡聽長篇故事，持續注意力變長。","能將生活經驗，融入到故事表達中。","喜歡聽繪本導讀，專注眼神閃閃發亮。","能說出故事的開頭與結尾，理解完整。","樂於朗讀熟悉的句子，聲音清亮自信。","會主動拿書分享給同伴，閱讀樂趣擴散。","能辨認自己的名字，並指出在哪裡。","喜歡仿說句子，詞彙量日益豐富。","聽到有趣的情節，會開心回應與討論。","能預測故事接下來的發展，思考力佳。","喜歡玩語音遊戲，對聲音的差異敏感。","能完整說出生活經驗，敘事能力進步。","會用手指跟著字句移動，建立閱讀方向。","喜歡翻看圖鑑，並說出圖中的細節。","能表達自己的需求，溝通清楚有禮貌。","在團體中專心傾聽，能等待輪流發言。","喜歡聽押韻的故事，語感越來越好。","能用不同表情說故事，生動有趣。","願意嘗試仿寫簡單符號，書寫意識萌芽。","能回想故事裡的人物，並說出特色。","喜歡和老師一起共讀，互動十分熱絡。","會把書放回書架，愛書又有秩序。","能說出圖卡的名稱，辨識能力良好。","喜歡編創小故事，想像力源源不絕。","聽到指令能複誦一遍，記憶力不錯。","能分享假日趣事，表達內容有條理。","喜歡玩偶說話遊戲，口語表現更大方。","能辨識常見標誌，生活識字逐漸增加。","遇到不懂的詞會發問，學習態度積極。","喜歡聽詩歌朗誦，感受語言節奏之美。","能用「因為」說明原因，邏輯慢慢成形。","專注看完一本書，持續力明顯進步。","會主動向同伴介紹繪本，分享熱情十足。","能分辨大聲與小聲，依場合調整音量。","喜歡畫完後說明內容，圖文表達結合。","能聽出故事裡的情緒，同理心提升。","願意在團體前發言，膽量逐步增長。","喜歡玩字形配對，視覺記憶表現佳。","能說出物品的用途，理解力不斷增加。","會模仿動物叫聲說故事，充滿趣味。","對新詞彙感到好奇，常主動詢問意思。","能依序說出一天的活動，時間觀念增強。","喜歡在閱讀角窩著看書，情緒放鬆穩定。","能理解故事的寓意，並說出自己的看法。","樂於和同伴分享書中笑點，互動愉快。","說話時能看著對方，展現良好禮儀。","喜歡玩傳話遊戲，聽力專注力提升。","能運用形容詞描述，語句更加生動。","對注音符號有興趣，主動嘗試辨認。","能完整唱出喜愛的兒歌，記憶力很棒。","喜歡製作小書，將想法畫成圖文故事。","閱讀時能提出問題，思考主動又深入。"],
    "積木區": ["喜歡搭建高塔，展現絕佳平衡感。","能疊出對稱城堡，空間概念成形。","樂於與同伴合作，一起完成大建築。","懂得分類收納積木，物歸原位很棒。","建築作品充滿創意，想像力大爆發。","嘗試不同堆疊法，解決問題能力佳。","喜歡鋪排平面圖形，認識了幾何美。","能耐心重建倒塌積木，挫折忍受度高。","運用積木當作軌道，邏輯思考清晰。","搭建出立體動物，手眼協調大進步。","喜歡玩骨牌遊戲，專注力十分集中。","能運用大積木，鍛鍊了粗大肌肉。","建築架構很穩固，理解了重心原理。","喜歡搭建迷宮，規劃空間能力很強。","會愛惜積木玩具，不會用力亂丟。","樂於分享積木，懂得與同儕輪流玩。","能說出建築名稱，語文結合遊戲。","嘗試搭建長橋，挑戰懸空的物理平衡。","喜歡玩樂高積木，手指精細度提升。","建築細節豐富，展現敏銳的觀察力。","能依據設計圖搭建，理解抽象符號。","喜歡把積木排成一列，學習序列概念。","搭建作品色彩繽紛，展現藝術美感。","會用積木當電話，發揮假扮遊戲創意。","能夠計算積木數量，融入數學學習。","喜歡玩軟積木，享受安全堆疊樂趣。","建築規模越來越大，企圖心很強烈。","懂得禮讓空間，與同伴和諧相處。","喜歡搭建停車場，將生活經驗重現。","堆疊出高樓大廈，充滿成就感。","能夠自己獨立搭建，享受獨處時光。","運用積木敲擊節奏，感受音樂律動。","喜歡搭建機器人，對科技充滿好奇。","能分辨積木形狀，形狀認知發展好。","搭建過程會思考，計畫能力大躍進。","喜歡玩磁力積木，探索磁鐵的奧秘。","建築作品有故事，口語表達更豐富。","能挑戰高難度堆疊，勇於突破自我。","喜歡把積木分類顏色，分類能力佳。","搭建出對稱的天平，理解重量概念。","能用積木測量長度，建立測量基礎。","喜歡玩拱門積木，認識建築力學。","懂得欣賞他人作品，學會給予讚美。","搭建出美麗花園，展現對自然的愛。","喜歡玩卡榫積木，指尖力量大增強。","能用積木拼出字母，結合語文學習。","建築風格獨特，展現個人專屬特色。","喜歡搭建高鐵列車，速度感十足。","能仔細對齊積木邊緣，做事很細心。","搭建出溫暖的家，情感投射很細膩。","喜歡搭建房子，並能說出各房間用途。","能運用長短積木，搭出整齊的圍牆。","搭建時懂得先規劃，再動手完成。","願意接受同伴建議，一起修改作品。","能把積木堆得穩固，理解底部支撐。","喜歡搭建馬路，並讓小車順利行駛。","能將相同形狀歸類，整理過程有秩序。","嘗試搭出斜坡，探索滾動與速度。","搭建完成後主動解說，口語流暢自信。","倒塌時能冷靜處理，重新再來一次。","喜歡用積木玩扮演遊戲，社交能力佳。","能使用半圓積木，搭出美麗的拱形。","懂得輪流使用積木，與同伴相處和諧。","搭建的動物園，區域劃分十分清楚。","能運用對稱排列，讓作品平衡美觀。","喜歡挑戰越搭越高，專注力十分持久。","能搭出多層建築，空間概念更立體。","會運用積木拼出數字，結合數學學習。","喜歡搭建隧道，探索穿越的空間感。","能仔細觀察圖片，仿搭出相似的建築。","搭建時手部穩定，不輕易碰倒作品。","樂於邀請同伴參觀，展現分享的喜悅。","能將大小積木搭配，構成完整造型。","喜歡搭建遊樂場，想像力豐富有創意。","能自行收拾積木，並依標示放回原位。","懂得保護他人作品，不隨意推倒破壞。","嘗試用積木搭出船，探索浮力概念。","搭建時會討論分工，團隊合作良好。","喜歡玩大型空心積木，肢體動作協調。","能找出缺少的積木，觀察比對仔細。","搭建作品有主題，構想完整不零散。","喜歡比較積木高度，測量概念逐漸建立。","能完成連續圖形排列，規律感很敏銳。","面對挑戰不退縮，勇於嘗試新的搭法。","搭出火車站與鐵軌，生活經驗豐富。","喜歡運用積木說故事，情節生動有趣。","能辨認方形與三角形，並靈活運用。","手眼協調精準，積木接合對得很齊。","會欣賞同伴巧思，主動說出稱讚的話。","喜歡把積木搭成橋梁，思考承重問題。","搭建過程安靜專注，情緒十分穩定。","能將舊作品改造，展現創新的思維。","懂得搬運大積木，注意安全與合作。","喜歡搭建城市，規劃街道與建築位置。","能依序完成搭建步驟，條理清晰。","搭出的圍欄整齊，空間界線概念明確。","喜歡用積木製造聲響，探索材質差異。","能自己發現問題，並嘗試調整結構。","搭建時樂於傾聽，能接納不同意見。","完成大型作品後，充滿成就感與笑容。"],
    "益智區": ["喜歡玩拼圖，視覺空間能力大幅提升。","能專注完成任務，培養了極佳耐心。","擅長圖形配對遊戲，觀察力很敏銳。","鏡分色分類，邏輯思考越來越清晰。","喜歡玩走迷宮，解決問題能力增強。","能按順序排列大小，建立序列概念。","記憶力遊戲表現好，能記住圖案位置。","挑戰高片數拼圖，展現不放棄的精神。","喜歡玩七巧板，幾何形狀組合力強。","數量對應正確，數學基礎打得很穩。","能找出圖中不同處，視覺辨識極佳。","樂於挑戰桌遊，學會遵守遊戲規則。","喜歡穿線遊戲，手眼協調精細度高。","能獨立思考解謎，享受腦力激盪。","會用算珠數數，數字概念逐漸成形。","喜歡玩形狀盒，空間對應能力很棒。","能發現排列規規，邏輯推理大躍進。","樂於與同儕切磋，培養良性競爭心。","懂得輸贏的態度，情緒管理進步了。","喜歡玩齒輪玩具，探索物理連動原理。","能精準扣上鈕扣，小肌肉發展成熟。","喜歡玩天平秤重，理解了輕重對比。","空間迷宮難不倒他，方向感非常好。","能將圖卡分類歸納，組織能力增強。","喜歡玩連連看，數序觀念十分清楚。","能耐心拆解立體謎題，專注力十足。","喜歡玩記憶翻牌，大腦反應很迅速。","能分辨左右方向，空間認知發展好。","透過桌遊學會等待，耐心大有長進。","喜歡測量物件長短，建立長度概念。","能運用策略玩遊戲，思考十分周密。","拼圖速度越來越快，熟練度大提升。","喜歡玩數獨基礎版，邏輯運算超棒。","會用夾子夾毛球，鍛鍊了手指握力。","能理解部分與整體，認知發展成熟。","喜歡玩時鐘玩具，時間概念萌芽了。","樂意教導同伴玩，展現小老師風範。","能準確套圈圈，距離估算能力很好。","喜歡玩影子配對，形狀辨識度很高。","透過釣魚遊戲，訓練了手部穩定度。","能完成對稱圖形，具備幾何對稱感。","喜歡玩五子棋，策略規劃能力極佳。","懂得整理益智教具，養成收納好習慣。","能夠專心串珠，顏色排序完全正確。","喜歡玩骨牌連鎖，理解了因果關係。","能分辨厚薄差異，觸覺與視覺結合。","喜歡玩空間積木，立體建構力很強。","能夠找出隱藏圖案，圖地覺察力佳。","喜歡玩數字接龍，對數字十分敏感。","益智挑戰過關，展現自信燦爛笑容。","喜歡玩分類遊戲，能依顏色形狀歸類。","能一對一對應數量，數概念紮實。","操作拼圖時懂得先找邊角，策略清楚。","面對困難題目，仍願意多嘗試幾次。","能辨認圖案的規律，並接著排下去。","喜歡玩骰子遊戲，認識點數與數量。","能比較多與少，建立數量比較概念。","專注完成串珠圖樣，顏色順序正確。","喜歡玩磁鐵遊戲，發現吸附的現象。","能依指令操作教具，理解與執行力佳。","遊戲後會主動收拾，物品歸位整齊。","喜歡玩鏡子遊戲，探索對稱與映像。","能找出缺漏的圖片，觀察細心專注。","玩桌遊時能等待輪流，自制力增強。","能辨別軟硬粗滑，觸覺經驗豐富。","喜歡玩積木拼圖，圖形組合反應靈敏。","能數到二十，並指認對應數字。","願意與同伴討論解法，思考更靈活。","擅長找出相同的圖卡，視覺記憶良好。","喜歡轉動旋轉教具，手指靈活協調。","能辨別長短高矮，比較概念清楚。","嘗試不同方法解題，展現彈性思考力。","操作量杯倒水，初步認識容量概念。","喜歡玩顏色配對，色彩辨識十分準確。","能完成二十片拼圖，專注力持續良好。","會依圖示完成操作，理解圖像指示。","喜歡用放大鏡觀察，探索力十分旺盛。","能說出分類的理由，語言與邏輯並進。","遇到失敗能再接再厲，抗挫力提升。","喜歡玩卡片配對，記憶與專注兼顧。","能正確數出物品總數，計數準確。","喜歡玩骨牌排列，耐心與穩定俱佳。","能把圖形依序疊放，順序概念清楚。","玩遊戲時遵守規則，並提醒同伴。","能找出圖形的異同，比較分析力強。","喜歡操作量尺，嘗試測量桌面長度。","能獨立完成教具操作，自信十足。","會依指示完成迷宮，路線規劃清楚。","喜歡玩影子遊戲，探索光與形狀。","能說出一天的順序，時序概念成形。","擅長拼接小圖片，手眼協調良好。","能判斷物品是否相同，辨識精準。","遊戲中樂於分享方法，帶動同伴學習。","喜歡將物品按大小排列，漸層概念佳。","能運用點數工具，加減概念初萌芽。","操作夾取遊戲時，手部力道拿捏得宜。","面對新教具好奇探索，學習動機強。","能記住遊戲步驟，並獨立重複操作。","喜歡玩找規則遊戲，推理能力增強。","完成任務後會笑著分享，成就感滿滿。"],
    "生活自理區": ["能夠自己穿脫外套，生活自理大進步。","喜歡練習扣鈕扣，手指精細動作靈活。","會自己拉上拉鍊，獨立完成不求人。","懂得自己穿鞋襪，左右腳分辨正確。","能夠安靜摺衣服，步驟記得非常清楚。","喜歡幫忙擦桌子，展現熱心助人精神。","會自己倒水喝，手部穩定度大大提升。","懂得使用夾子夾食物，手眼協調佳。","洗手步驟很確實，養成良好衛生習慣。","吃飯能用湯匙舀湯，不會弄髒桌面。","喜歡練習綁鞋帶，展現極佳的耐心。","懂得自己整理書包，負責態度很棒。","能夠擰乾小毛巾，手腕力量變大了。","會自己梳頭髮，注重個人儀容整潔。","懂得分類垃圾，環保意識從小扎根。","喜歡幫盆栽澆水，培養了愛護生命心。","能夠獨立如廁，生活習慣非常良好。","會自己剝橘子皮，手指小肌肉有力。","懂得使用抹布清潔，做事非常細心。","喜歡練習切水果玩具，學習安全常識。","能把餐具收拾整齊，做事有條不紊。","懂得咳嗽要遮口鼻，注重健康禮儀。","會自己掛好毛巾，養成物品歸位習慣。","喜歡練習鎖螺絲，手部旋轉能力強。","能夠安靜午休，自我情緒調節很好。","會自己拉袖子洗手，生活技能熟練。","懂得使用掃把畚箕，維護環境整潔。","能夠自己打開點心盒，獨立解決問題。","喜歡練習倒豆子，專注力讓人驚豔。","懂得將水壺擺放整齊，注重團隊紀律。","會自己摺棉被，生活作息非常有規律。","能夠分辨冷熱水，具備基本安全常識。","喜歡練習打結，手指靈巧度大幅提升。","懂得愛惜食物不浪費，品格教育極佳。","能夠獨立完成洗碗，是老師的好幫手。","會自己脫帽子放好，動作十分俐落。","懂得排隊輪流洗手，具備良好社會性。","喜歡練習使用筷子，手部發展很成熟。","能夠察覺衣服弄髒，主動要求更換。","懂得自己擦鼻涕，保持臉部清潔乾淨。","喜歡幫娃娃穿衣服，同理心發展良好。","能夠把椅子靠攏，養成良好教室常規。","會自己拉開窗簾，感受陽光的溫暖。","懂得愛護個人物品，不輕易弄丟東西。","喜歡練習用滴管，控制力道十分精準。","能夠自己塗抹乳液，學習照顧自己。","會將用過衛生紙丟掉，衛生習慣很好。","懂得自己拿拖鞋穿，動作協調不跌倒。","喜歡練習拉抽屜，學會控制拉的力道。","能夠獨立完成例行事務，充滿自信心。","吃飯時能細嚼慢嚥，用餐習慣良好。","會主動漱口刷牙，口腔衛生觀念佳。","能自己穿好褲子，並整理衣角。","懂得飯前洗手，並用肥皂洗乾淨。","能自行取用餐點，分量拿取剛剛好。","吃完飯會收拾餐盤，負責又有禮貌。","能使用叉子叉取食物，手部靈活。","懂得口渴要喝水，會照顧自己身體。","會自己擦嘴巴，保持用餐後整潔。","能把外套掛好，物品擺放整齊。","午睡前能自行準備，作息規律穩定。","起床後會自己摺小被子，動作確實。","懂得整理玩具櫃，收納觀念良好。","能自己拿杯子倒水，不灑出來。","洗手後會擦乾雙手，習慣完整。","懂得上完廁所沖水，並洗手清潔。","能分辨自己的物品，不亂拿他人東西。","吃飯時專心用餐，不挑食不剩菜。","願意嘗試新食物，飲食習慣更均衡。","會主動協助分發餐具，樂於幫忙。","能自己擦拭桌面，清潔動作仔細。","能獨立穿上襪子，腳跟位置正確。","懂得保持座位乾淨，愛護環境整潔。","會用手帕擦汗，衛生習慣良好。","能自己整理書包，把物品放好。","懂得天冷穿外套，主動照顧自己。","排隊等候時安靜守序，常規很好。","能自己扣好衣服，動作越來越快。","離開座位會把椅子靠好，細心有禮。","會自己拉好褲子，儀容整齊乾淨。","懂得使用水杯飲水，不亂跑亂玩。","能完成簡單的值日工作，責任感佳。","能把垃圾丟入正確桶子，環保觀念佳。","吃水果時會自己剝皮，動作細膩。","洗手時會搓揉各個指縫，步驟確實。","能自己撕開點心包裝，手指有力。","懂得整理床墊與枕頭，習慣良好。","能自己穿脫雨衣，應變能力提升。","面對生活小狀況，會試著自己解決。","懂得借用物品先詢問，有禮貌又尊重。","用完剪刀等工具，會放回固定位置。","能自己擰開水壺蓋，手部力量增加。","能維持桌面整齊，做事有條不紊。","懂得生病要告訴老師，主動表達不適。","能自己提著小背包，行走穩定安全。","午餐後會自行刷牙，養成好習慣。","願意協助同伴整理，展現友愛精神。","能自己穿脫便鞋，並放入鞋櫃。","懂得節約用水，洗手後會關好水龍頭。","生活作息規律，自理能力日益進步。"],
    "組合建構區": ["喜歡組裝模型，立體空間概念極佳。","能照說明書拼裝，邏輯順序非常清楚。","擅長使用齒輪積木，理解物理連動原理。","組合過程很專注，培養了解決問題能力。","喜歡玩雪花片，創意造型變化萬千。","能夠拆解重組，展現了強烈的實驗精神。","運用卡榫積木，鍛鍊手指精細力量。","組裝出汽車模型，手眼協調能力大增。","樂於與同伴合作組裝，發揮團隊默契。","喜歡玩磁力片，探索磁性相吸與相斥。","能夠創造獨特飛行器，想像力十分豐富。","懂得分類零件，養成收納的好習慣。","組裝結構十分穩固，具備工程師潛力。","喜歡玩水管積木，空間延伸概念很好。","能耐心尋找正確零件，觀察力很敏銳。","遇到困難不放棄，抗壓性與毅力極佳。","喜歡組裝機器人，對科技有濃厚興趣。","能夠說出組裝步驟，口語表達很有條理。","運用螺絲起子玩具，手部旋轉技巧好。","組裝出立體城堡，幾何美感十分出色。","喜歡挑戰高難度套件，勇於突破自我。","能夠自由發揮創意，不受限於說明書。","組合出長長火車，序列概念建立完整。","喜歡玩樂高組裝，小肌肉發展非常成熟。","懂得欣賞別人作品，社會互動表現佳。","組裝速度越來越快，動作十分熟練。","喜歡將不同材質結合，創新思維很棒。","能夠組裝對稱模型，空間對稱感極佳。","發現卡住會自己調整，修正能力很強。","喜歡玩關節積木，理解物體活動關節。","組合出摩天輪，對旋轉力學充滿好奇。","能夠精準卡入細小零件，專注力驚人。","喜歡挑戰平衡結構，物理概念萌芽了。","懂得將作品命名，語文與遊戲完美結合。","組裝出動物園，展現對生活環境的觀察。","喜歡玩吸盤玩具，探索真空吸附原理。","能夠估算需要的零件數量，數感很好。","遇到倒塌能勇敢重來，挫折忍受力高。","喜歡將模型展示分享，充滿了成就感。","組合出高塔，了解底部寬大才穩固的道理。","能夠拆解自己作品，學習物歸原位。","喜歡玩棒狀建構玩具，線條空間感佳。","組裝過程充滿笑容，十分享受動手做。","懂得請老師幫忙，遇到困難會主動求援。","喜歡玩軌道組裝，邏輯規劃能力很棒。","能夠組裝出吊車，對機械構造有概念。","發現零件不見會主動尋找，十分負責。","喜歡組裝立體迷宮，三維空間感強烈。","能夠將想像化為實體，實踐能力極佳。","組裝作品充滿細節，觀察入微值得肯定。","喜歡組裝小車子，並測試輪子轉動。","能辨認不同零件，依需求挑選使用。","組合時懂得先規劃，再逐步完成。","對連接管很有興趣，嘗試延伸造型。","能把積木片對準扣緊，手指力道穩定。","喜歡組裝動物造型，創意表現可愛。","遇到零件鬆脫，會自己重新扣牢。","能和同伴討論組合方式，溝通順暢。","願意嘗試複雜的結構，挑戰精神可嘉。","能依圖示完成組裝，理解圖像步驟。","喜歡組合飛機模型，並玩飛行遊戲。","組裝時耐心十足，不輕易放棄。","能把大小零件搭配，結構平衡美觀。","會替作品加上配件，細節豐富。","喜歡組成長長的鏈條，序列概念清楚。","能發現組裝錯誤，並自行修正。","喜歡組合房屋，並設計門窗位置。","能運用輪軸零件，探索滾動的原理。","玩雪花片時會變化形狀，造型多元。","完成作品後樂於說明，表達自信。","能分辨凹凸卡榫，對應位置正確。","喜歡組裝大型作品，合作意願高。","組裝過程專注穩定，不容易分心。","能自己探索新玩法，創造力強。","懂得收納零件分類盒，物品不遺失。","喜歡組合恐龍造型，想像力十足。","能運用不同顏色，組成有規律的圖案。","嘗試利用槓桿原理，拉起小物件。","會欣賞同伴作品，並詢問組裝方法。","能將零件旋轉組合，空間轉換能力佳。","喜歡搭建橋樑模型，注重結構穩固。","組裝後能試玩測試，具有驗證精神。","能獨立完成十個零件的組合，專注良好。","喜歡設計屬於自己的玩具，獨創性高。","遇到難題會請同伴協助，懂得合作。","能細心比對零件大小，觀察力提升。","喜歡組合電梯模型，探索上下移動。","能以積木組成文字或數字，結合學習。","組裝時動作輕巧，愛惜教具材料。","喜歡建構小小村莊，生活經驗豐富。","能完成對稱的組合，圖形概念清楚。","面對失敗會再次嘗試，態度正向積極。","能運用長條零件，組成穩固的框架。","喜歡玩滑軌組裝，探索斜坡與速度。","能分享組裝心得，語言表達流暢。","組合作品穩固耐玩，手部技巧成熟。","喜歡仿造生活物品，觀察入微細心。","能拆解後依原樣復原，記憶力良好。","組裝時會計畫零件用量，數感進步。","完成挑戰後笑容滿面，成就感十足。"]
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
let backupDirty = false;
let autoTimer = null;
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

async function buildBackup() {
    await saveNow();
    const records = {};
    for (const s of seats) records[s] = await kvGet('rec:' + s);
    return { app: 'learn-record', version: 1, exportedAt: new Date().toISOString(), seats, records };
}

function backupBlob(obj) {
    return new Blob([JSON.stringify(obj)], { type: 'application/json' });
}

// ---- 自動備份：App 內只留 2 份，輪流覆寫（不需任何授權）----
let autoRunning = false;
async function autoBackup() {
    if (!backupDirty || autoRunning) return;
    autoRunning = true;
    try {
        const obj = await buildBackup();
        const slots = [await kvGet('autoBak0'), await kvGet('autoBak1')];
        // 覆寫較舊（或空）的那一份
        const t = (x) => (x && x.exportedAt) ? Date.parse(x.exportedAt) : 0;
        const idx = t(slots[0]) <= t(slots[1]) ? 0 : 1;
        await kvSet('autoBak' + idx, obj);
        backupDirty = false;
        lastAutoInfo = `最近自動備份：${new Date().toLocaleString()}`;
    } catch (e) {
        console.warn('自動備份失敗', e);
        lastAutoInfo = '⚠️ 自動備份失敗：' + ((e && e.message) || e);
    }
    updateBackupUI();
    autoRunning = false;
}

function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---- 手動備份：直接下載到手機「下載」資料夾（不需授權）----
async function manualBackup() {
    setBackupMsg('');
    try {
        const obj = await buildBackup();
        const name = `學習區備份_${stamp(true)}.json`;
        downloadBlob(backupBlob(obj), name);
        await kvSet('lastManualBackup', new Date().toISOString());
        setBackupMsg(`✅ 已下載到「下載」資料夾：${name}`, 'ok');
    } catch (e) {
        setBackupMsg('❌ 備份失敗：' + (e.message || e), 'error');
    }
    updateBackupUI();
}

async function applyBackupObject(obj) {
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
}

function validBackup(obj) {
    return obj && obj.app === 'learn-record' && obj.records && Array.isArray(obj.seats);
}

async function restoreBackup(file) {
    try {
        const obj = JSON.parse(await file.text());
        if (!validBackup(obj)) throw new Error('這不是本系統的備份檔');
        if (!confirm(`即將還原 ${obj.seats.length} 個座號的資料，會取代目前所有紀錄。\n（還原前會先自動留一份現況快照）\n確定要還原嗎？`)) return;
        await applyBackupObject(obj);
        setBackupMsg(`✅ 已還原 ${seats.length} 個座號`, 'ok');
    } catch (e) {
        setBackupMsg('❌ 還原失敗：' + (e.message || e), 'error');
    }
}

// ---- 從 App 內的自動備份還原 ----
async function restoreFromAuto(idx) {
    try {
        const obj = await kvGet('autoBak' + idx);
        if (!validBackup(obj)) throw new Error('這份自動備份是空的');
        const when = new Date(obj.exportedAt).toLocaleString();
        if (!confirm(`即將還原「${when}」的自動備份（${obj.seats.length} 個座號），會取代目前所有紀錄。\n（還原前會先自動留一份現況快照）\n確定要還原嗎？`)) return;
        await applyBackupObject(obj);
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
    let last = '';
    try {
        const m = await kvGet('lastManualBackup');
        last = m ? `最近下載備份：${new Date(m).toLocaleString()}` : '尚未下載過備份檔';
    } catch (e) { /* ignore */ }
    $('backupStatus').textContent = `自動備份：開啟（App 內保留最近 2 份，輪流覆寫）。${lastAutoInfo} ${last}`.trim();
    // 自動備份還原按鈕
    const box = $('autoSlotBox');
    if (!box) return;
    box.innerHTML = '';
    for (const i of [0, 1]) {
        let o = null;
        try { o = await kvGet('autoBak' + i); } catch (e) { /* ignore */ }
        if (!validBackup(o)) continue;
        const b = document.createElement('button');
        b.className = 'pdf-add-btn';
        b.style.marginTop = '10px';
        b.textContent = `🕘 還原自動備份：${new Date(o.exportedAt).toLocaleString()}`;
        b.onclick = () => restoreFromAuto(i);
        box.appendChild(b);
    }
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

// 直接產生 PDF 並下載到手機「下載」資料夾（版面與列印版相同；文字為圖片，無法選取）
async function renderPdfToFolder(order, fileName) {
    const css = buildPrintCss();
    const pages = [];
    for (let i = 0; i < order.length; i++) {
        setPdfMsg(`⏳ 產生中 (${i + 1}/${order.length})...`);
        await loadRecordToForm(order[i]);
        const node = cloneFormSnapshot();
        pages.push(await renderPageToJpeg(node, css, 2.5));
    }
    downloadBlob(buildPdf(pages), fileName + '.pdf');
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
    const toFolder = !wantPrint;   // 直接下載到「下載」資料夾，不需授權

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
                alert(`✅ 已下載到「下載」資料夾：${name}.pdf`);
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

