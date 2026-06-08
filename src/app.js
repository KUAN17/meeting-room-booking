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
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('伺服器錯誤');
  return res.json();
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
function renderWeekGrid(dates) {
  const now      = new Date();
  const todayISO = fmtDateISO(todayMidnight());
  const nowMin   = now.getHours() * 60 + now.getMinutes();
  const DAY_NAMES = ['週一','週二','週三','週四','週五'];

  const consumedByDay = dates.map(() => new Set());
  const bookingStart  = dates.map(() => ({}));

  dates.forEach((date, di) => {
    const bks = state.weekBookings[fmtDateISO(date)] || [];
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
        return `<td class="slot-booked${isPast ? ' past' : ''}${isHour ? ' hour-line' : ''}" rowspan="${rowspan}">
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

  $$('.slot-empty:not(.past)', $('#week-grid')).forEach(td => {
    td.addEventListener('click', () => openBookingModal(td.dataset.date, td.dataset.time));
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
    renderMyList(res.bookings || []);
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
  el.innerHTML = bks.map(b => {
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
        ${status === 'active'
          ? `<button class="btn btn-outline btn-sm" data-id="${b.id}" data-empid="${b.empId}">取消</button>`
          : ''}
      </div>
    </div>`;
  }).join('');

  $$('[data-id]', el).forEach(btn => {
    btn.addEventListener('click', () => {
      showModal({
        icon: '⚠️', title: '確定取消預約？', body: '取消後無法復原。',
        cancelLabel: '返回', onCancel: () => {},
        closeLabel: '確定取消',
        onClose: async () => {
          showLoading();
          try {
            const res = await apiGet('cancelBooking', { id: btn.dataset.id, empId: btn.dataset.empid });
            hideLoading();
            if (res.ok) doQuery();
            else showModal({ icon: '❌', title: '取消失敗', body: res.error });
          } catch (err) { hideLoading(); showModal({ icon: '❌', title: '錯誤', body: err.message }); }
        },
      });
    });
  });
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
  $('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) hideGenericModal(); });
  initBmForm();
  initMyBookings();
  loadWeek(getMondayOf(new Date()));
}

document.addEventListener('DOMContentLoaded', init);
