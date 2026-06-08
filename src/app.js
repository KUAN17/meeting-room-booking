'use strict';
const cfg = window.APP_CONFIG;

/* ── 工具 ───────────────────────────────────────────────────── */
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

function pad(n) { return String(n).padStart(2, '0'); }
function timeToMin(t) { const [h, m] = t.split(':'); return +h * 60 + +m; }
function minToTime(m) { return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }

function todayMidnight() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function fmtDateISO(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fmtDateDisplay(d) { return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}`; }

function generateSlots() {
  const slots = [];
  for (let m = cfg.START_HOUR * 60; m < cfg.END_HOUR * 60; m += 30) slots.push(minToTime(m));
  return slots;
}
const SLOTS = generateSlots();  // ['08:00','08:30',...,'17:30']
// 結束時間選項包含 18:00
const END_SLOTS = [...SLOTS.slice(1), minToTime(cfg.END_HOUR * 60)];  // ['08:30',...,'18:00']

function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function showLoading() { $('#loading-overlay').classList.remove('hidden'); }
function hideLoading() { $('#loading-overlay').classList.add('hidden'); }

/* ── 通用 Modal ─────────────────────────────────────────────── */
function showModal({ icon='', title='', body='', closeLabel='確認', cancelLabel='', onClose=null, onCancel=null }) {
  $('#modal-icon').textContent = icon;
  $('#modal-title').textContent = title;
  $('#modal-body').textContent = body;
  $('#modal-close').textContent = closeLabel;
  const cb = $('#modal-cancel');
  if (cancelLabel) {
    cb.textContent = cancelLabel;
    cb.classList.remove('hidden');
    cb.onclick = () => { hideGenericModal(); if (onCancel) onCancel(); };
  } else {
    cb.classList.add('hidden');
  }
  $('#modal-close').onclick = () => { hideGenericModal(); if (onClose) onClose(); };
  $('#modal-overlay').classList.remove('hidden');
}
function hideGenericModal() { $('#modal-overlay').classList.add('hidden'); }

/* ── API（全部使用 GET，避免 CORS preflight）─────────────────── */
async function apiGet(action, params = {}) {
  if (!cfg.GAS_URL) return mockApi(action, params);
  const url = new URL(cfg.GAS_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  url.searchParams.set('_t', Date.now());  // 防止瀏覽器快取
  const res = await fetch(url.toString(), { redirect: 'follow' });
  if (!res.ok) throw new Error(`伺服器錯誤 (${res.status})`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error('GAS 回應內容：', text);
    throw new Error('GAS 回應格式錯誤，請確認已重新部署最新版 Code.gs');
  }
}

/* ── 模擬後端 ────────────────────────────────────────────────── */
const mockDB = { bookings: JSON.parse(localStorage.getItem('mock_bk') || '[]') };
function saveMock() { localStorage.setItem('mock_bk', JSON.stringify(mockDB.bookings)); }

async function mockApi(action, p) {
  await new Promise(r => setTimeout(r, 150));
  if (action === 'getBookings') {
    return { ok: true, bookings: mockDB.bookings.filter(b =>
      b.status !== 'cancelled' &&
      (!p.date   || b.date   === p.date) &&
      (!p.roomId || b.roomId === p.roomId)
    )};
  }
  if (action === 'getMyBookings') {
    return { ok: true, bookings: mockDB.bookings.filter(b => b.empId === p.empId) };
  }
  if (action === 'createBooking') {
    const conflict = mockDB.bookings.some(b =>
      b.status !== 'cancelled' && b.date === p.date && b.roomId === p.roomId &&
      p.startTime < b.endTime && p.endTime > b.startTime
    );
    if (conflict) return { ok: false, error: '所選時段與現有預約衝突' };
    const id = 'BK' + Date.now();
    mockDB.bookings.push({ id, status: 'active', ...p });
    saveMock();
    return { ok: true, bookingId: id };
  }
  if (action === 'cancelBooking') {
    const idx = mockDB.bookings.findIndex(b => b.id === p.id && b.empId === p.empId);
    if (idx === -1) return { ok: false, error: '找不到預約或員工編號不符' };
    mockDB.bookings[idx].status = 'cancelled';
    saveMock();
    return { ok: true };
  }
  if (action === 'updateBooking') {
    const idx = mockDB.bookings.findIndex(b => b.id === p.id && b.empId === p.empId);
    if (idx === -1) return { ok: false, error: '找不到預約或員工編號不符' };
    const conflict = mockDB.bookings.some(b =>
      b.id !== p.id && b.status !== 'cancelled' &&
      b.date === p.date && b.roomId === p.roomId &&
      p.startTime < b.endTime && p.endTime > b.startTime
    );
    if (conflict) return { ok: false, error: '所選時段與現有預約衝突' };
    Object.assign(mockDB.bookings[idx], {
      date: p.date, startTime: p.startTime, endTime: p.endTime,
      name: p.name, dept: p.dept, note: p.note,
    });
    saveMock();
    return { ok: true };
  }
  return { ok: false, error: 'unknown' };
}

/* ── 記憶預約人資訊 ──────────────────────────────────────────── */
const MEMORY_KEY = 'bk_user';
function loadMemory() {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}'); } catch { return {}; }
}
function saveMemory(name, empId, dept) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify({ name, empId, dept }));
}

/* ── 狀態 ───────────────────────────────────────────────────── */
const state = {
  weekMonday:   getMondayOf(new Date()),
  weekBookings: {},  // { 'YYYY-MM-DD': [...] }
  bm: { date: null, startTime: null, endTime: null },
};

/* ── 導覽 ───────────────────────────────────────────────────── */
function navigate(view) {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
}

/* ── 週曆：載入 ──────────────────────────────────────────────── */
async function loadWeek(monday) {
  state.weekMonday = monday;
  updateWeekLabel();
  $('#week-grid').innerHTML = '<div class="loading-box">載入中…</div>';
  showLoading();
  const dates = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday); d.setDate(d.getDate() + i); return d;
  });
  const results = await Promise.all(
    dates.map(d => apiGet('getBookings', { date: fmtDateISO(d), roomId: cfg.ROOM.id })
      .then(r => r.bookings || []).catch(() => []))
  );
  dates.forEach((d, i) => { state.weekBookings[fmtDateISO(d)] = results[i]; });
  hideLoading();
  renderWeekGrid(dates);
}

function updateWeekLabel() {
  const fri = new Date(state.weekMonday);
  fri.setDate(fri.getDate() + 4);
  const m = state.weekMonday;
  $('#w-label').textContent =
    `${m.getFullYear()}/${pad(m.getMonth()+1)}/${pad(m.getDate())}（週一）` +
    ` ～ ${pad(fri.getMonth()+1)}/${pad(fri.getDate())}（週五）`;
}

/* ── 週曆：渲染 ──────────────────────────────────────────────── */
const weekBookingMap = {};  // id → booking，供點擊格子時取用

function renderWeekGrid(dates) {
  const now      = new Date();
  const todayISO = fmtDateISO(todayMidnight());
  const nowMin   = now.getHours() * 60 + now.getMinutes();
  const DAY_NAMES = ['週一','週二','週三','週四','週五'];

  const consumedByDay = dates.map(() => new Set());
  const bookingStart  = dates.map(() => ({}));

  // 清空並重建 booking map
  Object.keys(weekBookingMap).forEach(k => delete weekBookingMap[k]);

  dates.forEach((date, di) => {
    const bks = state.weekBookings[fmtDateISO(date)] || [];
    bks.forEach(b => { weekBookingMap[b.id] = b; });  // 存入 map
    SLOTS.forEach(slot => {
      if (consumedByDay[di].has(slot)) return;
      const slotM = timeToMin(slot);
      const bk = bks.find(b => timeToMin(b.startTime) <= slotM && timeToMin(b.endTime) > slotM);
      if (!bk) return;
      bookingStart[di][slot] = bk;
      const endM = timeToMin(bk.endTime);
      SLOTS.forEach(s => { if (timeToMin(s) > slotM && timeToMin(s) < endM) consumedByDay[di].add(s); });
    });
  });

  const headerCells = dates.map((d, i) => {
    const iso     = fmtDateISO(d);
    const isToday = iso === todayISO;
    return `<th class="${isToday ? 'today-col' : ''}">
      <span class="day-name">${DAY_NAMES[i]}</span>
      <span class="day-date">${pad(d.getMonth()+1)}/${pad(d.getDate())}</span>
    </th>`;
  }).join('');

  const bodyRows = SLOTS.map((slot) => {
    const slotM  = timeToMin(slot);
    const isHour = slotM % 60 === 0;
    const timeCell = `<td class="time-cell${isHour ? ' hour-line' : ''}">${isHour ? slot : ''}</td>`;

    const dayCells = dates.map((date, di) => {
      const iso = fmtDateISO(date);
      if (consumedByDay[di].has(slot)) return '';
      const bk = bookingStart[di][slot];
      if (bk) {
        const endM    = timeToMin(bk.endTime);
        const rowspan = Math.round((endM - slotM) / 30);
        const isPast  = iso < todayISO || (iso === todayISO && slotM < nowMin);
        return `<td class="slot-booked${isPast ? ' past' : ''}${isHour ? ' hour-line' : ''}"
                    rowspan="${rowspan}" data-bk-id="${bk.id}">
          <div class="booked-name">${bk.name}</div>
          <div class="booked-dept">${bk.dept || ''}</div>
          <div class="booked-time">${bk.startTime}–${bk.endTime}</div>
        </td>`;
      }
      const isToday = iso === todayISO;
      const isPast  = iso < todayISO || (iso === todayISO && slotM < nowMin);
      return `<td class="slot-empty${isPast ? ' past' : ''}${isHour ? ' hour-line' : ''}${isToday ? ' today-col' : ''}"
                  data-date="${iso}" data-time="${slot}"></td>`;
    }).join('');

    return `<tr>${timeCell}${dayCells}</tr>`;
  }).join('');

  $('#week-grid').innerHTML = `
    <table class="week-table">
      <colgroup><col class="col-time">${dates.map(() => '<col>').join('')}</colgroup>
      <thead><tr><th></th>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;

  // 空格 → 新增預約
  $$('.slot-empty:not(.past)', $('#week-grid')).forEach(td => {
    td.addEventListener('click', () => openBookingModal(td.dataset.date, td.dataset.time));
  });

  // 已預約格子 → 編輯
  $$('.slot-booked:not(.past)', $('#week-grid')).forEach(td => {
    td.addEventListener('click', () => {
      const bk = weekBookingMap[td.dataset.bkId];
      if (bk) openEditModal(bk);
    });
  });
}

/* ── 預約 Modal ─────────────────────────────────────────────── */
function openBookingModal(date, startTime) {
  state.bm.date      = date;
  state.bm.startTime = startTime;
  state.bm.endTime   = minToTime(timeToMin(startTime) + 60);  // 預設 +1 小時

  // 日期標題
  const d = new Date(date + 'T00:00:00');
  const dayNames = ['日','一','二','三','四','五','六'];
  $('#bm-date-label').textContent = `${fmtDateDisplay(d)}（週${dayNames[d.getDay()]}）`;

  // 帶入記憶資訊
  const mem = loadMemory();
  if (mem.name)  $('#f-name').value  = mem.name;
  if (mem.empId) $('#f-empid').value = mem.empId;
  if (mem.dept)  $('#f-dept').value  = mem.dept;

  $('#f-note').value = '';
  $('#bm-msg').textContent = '';

  buildTimeSelects();
  $('#bm-overlay').classList.remove('hidden');
}

function closeBmModal() { $('#bm-overlay').classList.add('hidden'); }

/* 找最近衝突的開始時間（分鐘），用來限制結束時間上限 */
function getConflictLimit(startMin) {
  const bks = state.weekBookings[state.bm.date] || [];
  let limit = cfg.END_HOUR * 60;
  bks.forEach(b => {
    const bStart = timeToMin(b.startTime);
    if (bStart > startMin) limit = Math.min(limit, bStart);
  });
  return limit;
}

function buildTimeSelects() {
  const startSel = $('#bm-start-sel');
  const endSel   = $('#bm-end-sel');

  // ── 開始時間選單 ──
  startSel.innerHTML = SLOTS.map(s =>
    `<option value="${s}" ${s === state.bm.startTime ? 'selected' : ''}>${s}</option>`
  ).join('');

  // ── 結束時間選單（依開始時間動態更新）──
  function refreshEndSel() {
    const startMin = timeToMin(startSel.value);
    const limitMin = getConflictLimit(startMin);

    endSel.innerHTML = END_SLOTS
      .filter(s => timeToMin(s) > startMin && timeToMin(s) <= limitMin)
      .map(s => `<option value="${s}" ${s === state.bm.endTime ? 'selected' : ''}>${s}</option>`)
      .join('');

    // 若目前 endTime 超出限制，自動調整
    if (!endSel.value || timeToMin(endSel.value) > limitMin) {
      // 選 startMin+60 或最大可用
      const preferred = minToTime(startMin + 60);
      const opts = [...endSel.options].map(o => o.value);
      endSel.value = opts.includes(preferred) ? preferred : opts[opts.length - 1] || '';
    }
    state.bm.endTime = endSel.value;

    // 衝突提示
    const warn = $('#dur-warn');
    if (limitMin < cfg.END_HOUR * 60) {
      warn.textContent = `${minToTime(limitMin)} 起已有預約，結束時間最晚至 ${minToTime(limitMin)}`;
      warn.classList.remove('hidden');
    } else {
      warn.classList.add('hidden');
    }
  }

  refreshEndSel();

  startSel.onchange = () => {
    state.bm.startTime = startSel.value;
    refreshEndSel();
  };
  endSel.onchange = () => {
    state.bm.endTime = endSel.value;
  };
}

/* ── 送出預約 ───────────────────────────────────────────────── */
function initBmForm() {
  $('#bm-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name  = $('#f-name').value.trim();
    const empId = $('#f-empid').value.trim();
    const dept  = $('#f-dept').value.trim();
    const note  = $('#f-note').value.trim();

    if (!name || !empId) { setMsg('請填寫姓名與員工編號', 'error'); return; }

    const startTime = $('#bm-start-sel').value;
    const endTime   = $('#bm-end-sel').value;
    if (!startTime || !endTime || timeToMin(endTime) <= timeToMin(startTime)) {
      setMsg('請確認時間設定正確', 'error'); return;
    }

    showLoading();
    try {
      const res = await apiGet('createBooking', {
        roomId:   cfg.ROOM.id,
        roomName: cfg.ROOM.name,
        date:     state.bm.date,
        startTime, endTime,
        name, empId, dept, note,
      });
      hideLoading();
      if (res.ok) {
        saveMemory(name, empId, dept);
        closeBmModal();
        showModal({
          icon: '✅', title: '預約成功！',
          body: `${cfg.ROOM.name} ${state.bm.date} ${startTime}–${endTime}`,
          onClose: () => loadWeek(state.weekMonday),
        });
      } else {
        setMsg(res.error || '預約失敗，請稍後再試', 'error');
      }
    } catch (err) {
      hideLoading(); setMsg(err.message, 'error');
    }
  });
}
function setMsg(txt, type = '') {
  const el = $('#bm-msg');
  el.textContent = txt;
  el.className = 'form-msg' + (type ? ' ' + type : '');
}

/* ── 我的預約 ───────────────────────────────────────────────── */
let myBookingsList = [];  // 存最新查詢結果供編輯用

function initMyBookings() {
  $('#query-btn').addEventListener('click', doQuery);
  $('#query-empid').addEventListener('keydown', e => { if (e.key === 'Enter') doQuery(); });
}
async function doQuery() {
  const empId = $('#query-empid').value.trim();
  if (!empId) return;
  showLoading();
  try {
    const res = await apiGet('getMyBookings', { empId });
    hideLoading();
    myBookingsList = res.bookings || [];
    renderMyList(myBookingsList);
  } catch (err) {
    hideLoading();
    $('#my-list').innerHTML = `<p style="color:var(--gray-400);font-size:.9rem">查詢失敗：${err.message}</p>`;
  }
}

function renderMyList(bks) {
  const el = $('#my-list');
  if (bks.length === 0) {
    el.innerHTML = `<div class="empty-state">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
      </svg><p>查無預約紀錄</p></div>`;
    return;
  }
  const todayISO = fmtDateISO(todayMidnight());
  el.innerHTML = bks.map((b, idx) => {
    const isPast  = b.date < todayISO;
    const status  = b.status === 'cancelled' ? 'cancelled' : isPast ? 'past' : 'active';
    const label   = { cancelled: '已取消', past: '已結束', active: '有效' }[status];
    return `<div class="booking-item">
      <div>
        <div class="booking-item-title">${b.date} ${b.startTime}–${b.endTime}</div>
        <div class="booking-item-meta">
          <span>👤 ${b.name}${b.dept ? '・' + b.dept : ''}</span>
          <span>🆔 ${b.empId}</span>
          ${b.note ? `<span>📝 ${b.note}</span>` : ''}
        </div>
      </div>
      <div class="booking-item-actions">
        <span class="badge badge-${status}">${label}</span>
        ${status === 'active' ? `
          <button class="btn btn-outline btn-sm" data-action="edit"   data-idx="${idx}">編輯</button>
          <button class="btn btn-outline btn-sm" data-action="cancel" data-idx="${idx}">取消</button>
        ` : ''}
      </div>
    </div>`;
  }).join('');

  $$('[data-action="edit"]', el).forEach(btn => {
    btn.addEventListener('click', () => {
      openEditModal(myBookingsList[+btn.dataset.idx]);
    });
  });
  $$('[data-action="cancel"]', el).forEach(btn => {
    btn.addEventListener('click', () => {
      const bk = myBookingsList[+btn.dataset.idx];
      showModal({
        icon: '⚠️', title: '確定取消預約？', body: '取消後無法復原。',
        cancelLabel: '返回', onCancel: () => {},
        closeLabel: '確定取消',
        onClose: async () => {
          showLoading();
          try {
            const res = await apiGet('cancelBooking', { id: bk.id, empId: bk.empId });
            hideLoading();
            if (res.ok) { doQuery(); loadWeek(state.weekMonday); }
            else showModal({ icon: '❌', title: '取消失敗', body: res.error });
          } catch (err) { hideLoading(); showModal({ icon: '❌', title: '錯誤', body: err.message }); }
        },
      });
    });
  });
}

/* ── 編輯 Modal ─────────────────────────────────────────────── */
const emState = {
  id: null, empId: null, roomId: null,
  date: null, startTime: null, endTime: null,
  bookingsCache: {},
};

function openEditModal(bk) {
  emState.id        = bk.id;
  emState.empId     = bk.empId;
  emState.roomId    = bk.roomId || cfg.ROOM.id;
  emState.date      = bk.date;
  emState.startTime = bk.startTime;
  emState.endTime   = bk.endTime;
  emState.bookingsCache = {};

  $('#em-name').value  = bk.name;
  $('#em-empid').value = bk.empId;
  $('#em-dept').value  = bk.dept || '';
  $('#em-note').value  = bk.note || '';
  $('#em-msg').textContent = '';

  buildEditDateSel();
  $('#em-overlay').classList.remove('hidden');
}

function closeEditModal() { $('#em-overlay').classList.add('hidden'); }

function buildEditDateSel() {
  const t = todayMidnight();
  const DAY_NAMES = ['日','一','二','三','四','五','六'];
  const opts = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(t);
    d.setDate(t.getDate() + i);
    const iso = fmtDateISO(d);
    opts.push(`<option value="${iso}" ${iso === emState.date ? 'selected' : ''}>` +
      `${fmtDateDisplay(d)}（週${DAY_NAMES[d.getDay()]}）</option>`);
  }
  $('#em-date-sel').innerHTML = opts.join('');
  loadEditBookingsAndBuildTime(emState.date);
  $('#em-date-sel').onchange = () => {
    emState.date = $('#em-date-sel').value;
    loadEditBookingsAndBuildTime(emState.date);
  };
}

async function loadEditBookingsAndBuildTime(date) {
  if (!emState.bookingsCache[date]) {
    showLoading();
    try {
      const res = await apiGet('getBookings', { date, roomId: emState.roomId });
      // 排除自己，才能正確判斷衝突
      emState.bookingsCache[date] = (res.bookings || []).filter(b => b.id !== emState.id);
    } catch { emState.bookingsCache[date] = []; }
    finally { hideLoading(); }
  }
  buildEditTimeSelects(emState.bookingsCache[date]);
}

function buildEditTimeSelects(otherBks) {
  const startSel = $('#em-start-sel');
  const endSel   = $('#em-end-sel');

  function getLimit(startMin) {
    let limit = cfg.END_HOUR * 60;
    otherBks.forEach(b => {
      const s = timeToMin(b.startTime);
      if (s > startMin) limit = Math.min(limit, s);
    });
    return limit;
  }

  startSel.innerHTML = SLOTS.map(s =>
    `<option value="${s}" ${s === emState.startTime ? 'selected' : ''}>${s}</option>`
  ).join('');

  function refreshEndSel() {
    const startMin = timeToMin(startSel.value);
    const limitMin = getLimit(startMin);
    endSel.innerHTML = END_SLOTS
      .filter(s => timeToMin(s) > startMin && timeToMin(s) <= limitMin)
      .map(s => `<option value="${s}" ${s === emState.endTime ? 'selected' : ''}>${s}</option>`)
      .join('');
    if (!endSel.value) {
      const preferred = minToTime(startMin + 60);
      const opts = [...endSel.options].map(o => o.value);
      endSel.value = opts.includes(preferred) ? preferred : opts[opts.length - 1] || '';
    }
    emState.endTime = endSel.value;
    const warn = $('#em-dur-warn');
    if (limitMin < cfg.END_HOUR * 60) {
      warn.textContent = `${minToTime(limitMin)} 起已有預約，結束時間最晚至 ${minToTime(limitMin)}`;
      warn.classList.remove('hidden');
    } else { warn.classList.add('hidden'); }
  }

  refreshEndSel();
  startSel.onchange = () => { emState.startTime = startSel.value; refreshEndSel(); };
  endSel.onchange   = () => { emState.endTime = endSel.value; };
}

function initEditForm() {
  $('#em-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name      = $('#em-name').value.trim();
    const dept      = $('#em-dept').value.trim();
    const note      = $('#em-note').value.trim();
    const date      = $('#em-date-sel').value;
    const startTime = $('#em-start-sel').value;
    const endTime   = $('#em-end-sel').value;

    if (!name) { setEditMsg('請填寫姓名', 'error'); return; }
    if (timeToMin(endTime) <= timeToMin(startTime)) { setEditMsg('結束時間須晚於開始時間', 'error'); return; }

    showLoading();
    try {
      const res = await apiGet('updateBooking', {
        id: emState.id, empId: emState.empId, roomId: emState.roomId,
        date, startTime, endTime, name, dept, note,
      });
      hideLoading();
      if (res.ok) {
        saveMemory(name, emState.empId, dept);
        closeEditModal();
        showModal({
          icon: '✅', title: '修改成功！',
          body: `已更新為 ${date} ${startTime}–${endTime}`,
          onClose: () => { doQuery(); loadWeek(state.weekMonday); },
        });
      } else {
        setEditMsg(res.error || '修改失敗', 'error');
      }
    } catch (err) { hideLoading(); setEditMsg(err.message, 'error'); }
  });
}
function setEditMsg(txt, type = '') {
  const el = $('#em-msg');
  el.textContent = txt;
  el.className = 'form-msg' + (type ? ' ' + type : '');
}

/* ── 初始化 ─────────────────────────────────────────────────── */
function init() {
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
  $('#w-prev').addEventListener('click', () => {
    const m = new Date(state.weekMonday); m.setDate(m.getDate() - 7); loadWeek(m);
  });
  $('#w-next').addEventListener('click', () => {
    const m = new Date(state.weekMonday); m.setDate(m.getDate() + 7); loadWeek(m);
  });
  $('#w-today').addEventListener('click', () => loadWeek(getMondayOf(new Date())));
  $('#bm-close-x').addEventListener('click', closeBmModal);
  $('#bm-cancel-btn').addEventListener('click', closeBmModal);
  $('#bm-overlay').addEventListener('click', e => { if (e.target === $('#bm-overlay')) closeBmModal(); });
  $('#em-close-x').addEventListener('click', closeEditModal);
  $('#em-cancel-btn').addEventListener('click', closeEditModal);
  $('#em-overlay').addEventListener('click', e => { if (e.target === $('#em-overlay')) closeEditModal(); });
  $('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) hideGenericModal(); });
  initBmForm();
  initEditForm();
  initMyBookings();
  loadWeek(getMondayOf(new Date()));
}

document.addEventListener('DOMContentLoaded', init);
