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
function fmtDateDisplay(d) {
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
}

// 產生 30 分鐘為單位的時段列表
function generateSlots() {
  const slots = [];
  for (let m = cfg.START_HOUR * 60; m < cfg.END_HOUR * 60; m += 30) {
    slots.push(minToTime(m));
  }
  return slots;
}
const SLOTS = generateSlots(); // ['08:00','08:30',...,'17:30']

// 取得當週的週一日期（Date 物件）
function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=日
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function showLoading() { $('#loading-overlay').classList.remove('hidden'); }
function hideLoading() { $('#loading-overlay').classList.add('hidden'); }

/* ── 通用 Modal ─────────────────────────────────────────────── */
function showModal({ icon = '', title = '', body = '', closeLabel = '確認', cancelLabel = '', onClose = null, onCancel = null }) {
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

/* ── API ────────────────────────────────────────────────────── */
async function apiGet(action, params = {}) {
  if (!cfg.GAS_URL) return mockApi(action, params);
  const url = new URL(cfg.GAS_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('伺服器錯誤');
  return res.json();
}
async function apiPost(action, body = {}) {
  if (!cfg.GAS_URL) return mockApi(action, body);
  const res = await fetch(cfg.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
    mode: 'cors',
  });
  if (!res.ok) throw new Error('伺服器錯誤');
  return res.json();
}

/* ── 模擬後端 ────────────────────────────────────────────────── */
const mockDB = { bookings: JSON.parse(localStorage.getItem('mock_bk') || '[]') };
function saveMock() { localStorage.setItem('mock_bk', JSON.stringify(mockDB.bookings)); }

async function mockApi(action, p) {
  await new Promise(r => setTimeout(r, 150));
  if (action === 'getBookings') {
    const list = mockDB.bookings.filter(b =>
      b.status !== 'cancelled' &&
      (!p.date   || b.date   === p.date) &&
      (!p.roomId || b.roomId === p.roomId)
    );
    return { ok: true, bookings: list };
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

/* ── 狀態 ───────────────────────────────────────────────────── */
const state = {
  weekMonday: getMondayOf(new Date()),  // 當前顯示週的週一
  weekBookings: {},  // { 'YYYY-MM-DD': [...bookings] }
  bm: {             // booking modal 狀態
    date: null,
    startTime: null,
    duration: cfg.DEFAULT_DURATION,
  },
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

  // 週一到週五
  const dates = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });

  // 並行取得每日預約
  const results = await Promise.all(
    dates.map(d => apiGet('getBookings', { date: fmtDateISO(d), roomId: cfg.ROOM.id })
      .then(r => r.bookings || [])
      .catch(() => [])
    )
  );
  dates.forEach((d, i) => { state.weekBookings[fmtDateISO(d)] = results[i]; });
  hideLoading();
  renderWeekGrid(dates);
}

function updateWeekLabel() {
  const fri = new Date(state.weekMonday);
  fri.setDate(fri.getDate() + 4);
  const days = ['日','一','二','三','四','五','六'];
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

  // 建構每日的「slot → booking」映射，並記錄哪些 slot 已被 rowspan 消耗
  // consumed[dayIdx] = Set of slot strings that are covered by a previous rowspan
  const consumedByDay = dates.map(() => new Set());
  // bookingAtSlot[dayIdx][slotIdx] = booking obj or null (only for start slot)
  const bookingStart = dates.map(() => ({}));  // { slotStr: bookingObj }

  dates.forEach((date, di) => {
    const iso = fmtDateISO(date);
    const bks = state.weekBookings[iso] || [];
    SLOTS.forEach(slot => {
      if (consumedByDay[di].has(slot)) return;
      const slotM = timeToMin(slot);
      const bk = bks.find(b =>
        timeToMin(b.startTime) <= slotM && timeToMin(b.endTime) > slotM
      );
      if (!bk) return;
      // 此 booking 在本 slot 開始渲染（可能 startTime < slot 若時間不對齊）
      bookingStart[di][slot] = bk;
      // 消耗後續被此 booking 覆蓋的 slot
      const endM = timeToMin(bk.endTime);
      SLOTS.forEach(s => {
        const sm = timeToMin(s);
        if (sm > slotM && sm < endM) consumedByDay[di].add(s);
      });
    });
  });

  // 建立表格
  const headerCells = dates.map((d, i) => {
    const iso = fmtDateISO(d);
    const isToday = iso === todayISO;
    return `<th class="${isToday ? 'today-col' : ''}">
      <span class="day-name">${DAY_NAMES[i]}</span>
      <span class="day-date">${pad(d.getMonth()+1)}/${pad(d.getDate())}</span>
    </th>`;
  }).join('');

  const bodyRows = SLOTS.map((slot, si) => {
    const slotM    = timeToMin(slot);
    const isHour   = slotM % 60 === 0;
    const timeCell = `<td class="time-cell${isHour ? ' hour-line' : ''}">${isHour ? slot : ''}</td>`;

    const dayCells = dates.map((date, di) => {
      const iso = fmtDateISO(date);

      // 已被 rowspan 消耗
      if (consumedByDay[di].has(slot)) return '';

      const bk = bookingStart[di][slot];
      if (bk) {
        // 計算 rowspan：從本 slot 到 booking 結束
        const endM   = timeToMin(bk.endTime);
        const rowspan = Math.round((endM - slotM) / 30);
        const isPast  = iso < todayISO || (iso === todayISO && slotM < nowMin);
        return `<td class="slot-booked${isPast ? ' past' : ''}${isHour ? ' hour-line' : ''}" rowspan="${rowspan}">
          <div class="booked-name">${bk.name}</div>
          <div class="booked-dept">${bk.dept || ''}</div>
          <div class="booked-time">${bk.startTime}–${bk.endTime}</div>
        </td>`;
      }

      // 空格
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

  // 點選空格 → 開啟預約 modal
  $$('.slot-empty:not(.past)', $('#week-grid')).forEach(td => {
    td.addEventListener('click', () => openBookingModal(td.dataset.date, td.dataset.time));
  });
}

/* ── 預約 Modal ─────────────────────────────────────────────── */
function openBookingModal(date, startTime) {
  state.bm.date      = date;
  state.bm.startTime = startTime;
  state.bm.duration  = cfg.DEFAULT_DURATION;

  const d = new Date(date + 'T00:00:00');
  const dayNames = ['日','一','二','三','四','五','六'];
  $('#bm-date-label').textContent = `${fmtDateDisplay(d)}（週${dayNames[d.getDay()]}）`;
  $('#bm-time-label').textContent = `開始 ${startTime}`;

  renderDurBtns();
  $('#bm-form').reset();
  $('#bm-msg').textContent = '';
  $('#bm-overlay').classList.remove('hidden');
}

function closeBmModal() { $('#bm-overlay').classList.add('hidden'); }

function renderDurBtns() {
  const startM   = timeToMin(state.bm.startTime);
  const maxEndM  = cfg.END_HOUR * 60;
  const iso      = state.bm.date;
  const bks      = (state.weekBookings[iso] || []);
  // 找最近一個衝突的起始時間
  let limitM = maxEndM;
  bks.forEach(b => {
    const bStartM = timeToMin(b.startTime);
    if (bStartM > startM) limitM = Math.min(limitM, bStartM);
  });

  const warn = $('#dur-warn');
  let warnShown = false;

  $('#dur-btns').innerHTML = cfg.DURATIONS.map(dur => {
    const endM   = startM + dur * 60;
    const endStr = minToTime(endM);
    const tooLong  = endM > maxEndM;
    const conflict = endM > limitM;
    const disabled = tooLong || conflict;
    const label    = dur < 1 ? '30分' : `${dur}小時`;
    return `<button class="dur-btn${dur === state.bm.duration && !disabled ? ' active' : ''}"
                    data-dur="${dur}" ${disabled ? 'disabled' : ''}>
              ${label}
            </button>`;
  }).join('');

  $$('.dur-btn:not([disabled])', $('#dur-btns')).forEach(btn => {
    btn.addEventListener('click', () => {
      state.bm.duration = parseFloat(btn.dataset.dur);
      $$('.dur-btn').forEach(b => b.classList.toggle('active', b === btn));
      updateBmEndTime();
    });
    if (parseFloat(btn.dataset.dur) === state.bm.duration) btn.classList.add('active');
  });

  // 若預設 duration 被 disabled，自動選最大可用
  const activeDur = cfg.DURATIONS.find(d => {
    const endM = startM + d * 60;
    return endM <= limitM && endM <= maxEndM;
  });
  if (activeDur) {
    if (startM + state.bm.duration * 60 > limitM ||
        startM + state.bm.duration * 60 > maxEndM) {
      state.bm.duration = activeDur;
      const btn = $(`[data-dur="${activeDur}"]`, $('#dur-btns'));
      if (btn) btn.classList.add('active');
    }
  }

  if (limitM < maxEndM) {
    warn.textContent = `此時段後 ${minToTime(limitM)} 已有預約，可選時長受限`;
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }

  updateBmEndTime();
}

function updateBmEndTime() {
  const endMin = timeToMin(state.bm.startTime) + state.bm.duration * 60;
  $('#bm-end-label').textContent = minToTime(endMin);
  $('#bm-time-label').textContent = `${state.bm.startTime} – ${minToTime(endMin)}`;
}

/* ── 送出預約 ───────────────────────────────────────────────── */
function initBmForm() {
  $('#bm-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name      = $('#f-name').value.trim();
    const empId     = $('#f-empid').value.trim();
    const dept      = $('#f-dept').value.trim();
    const title     = $('#f-title').value.trim();
    const attendees = $('#f-attendees').value.trim();
    const note      = $('#f-note').value.trim();

    if (!name || !empId || !title || !attendees) {
      setMsg('請填寫所有必填欄位', 'error'); return;
    }

    const startTime = state.bm.startTime;
    const endTime   = minToTime(timeToMin(startTime) + state.bm.duration * 60);

    showLoading();
    try {
      const res = await apiPost('createBooking', {
        roomId:    cfg.ROOM.id,
        roomName:  cfg.ROOM.name,
        date:      state.bm.date,
        startTime, endTime,
        name, empId, dept, title, attendees, note,
      });
      hideLoading();
      if (res.ok) {
        closeBmModal();
        showModal({
          icon: '✅', title: '預約成功！',
          body: `${cfg.ROOM.name} ${fmtDateDisplay(new Date(state.bm.date + 'T00:00:00'))} ${startTime}–${endTime} 已完成預約`,
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
    const isPast = b.date < todayISO;
    const status = b.status === 'cancelled' ? 'cancelled' : isPast ? 'past' : 'active';
    const label  = { cancelled: '已取消', past: '已結束', active: '有效' }[status];
    return `<div class="booking-item">
      <div>
        <div class="booking-item-title">${b.title || '（無標題）'}</div>
        <div class="booking-item-meta">
          <span>📅 ${b.date}</span>
          <span>🕐 ${b.startTime} – ${b.endTime}</span>
          <span>👤 ${b.name}${b.dept ? '・' + b.dept : ''}</span>
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
        icon: '⚠️', title: '確定取消預約？',
        body: '取消後無法復原。',
        cancelLabel: '返回', onCancel: () => {},
        closeLabel: '確定取消',
        onClose: async () => {
          showLoading();
          try {
            const res = await apiPost('cancelBooking', { id: btn.dataset.id, empId: btn.dataset.empid });
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
  // 導覽
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));

  // 週導覽
  $('#w-prev').addEventListener('click', () => {
    const m = new Date(state.weekMonday);
    m.setDate(m.getDate() - 7);
    loadWeek(m);
  });
  $('#w-next').addEventListener('click', () => {
    const m = new Date(state.weekMonday);
    m.setDate(m.getDate() + 7);
    loadWeek(m);
  });
  $('#w-today').addEventListener('click', () => loadWeek(getMondayOf(new Date())));

  // 預約 modal
  $('#bm-close-x').addEventListener('click', closeBmModal);
  $('#bm-cancel-btn').addEventListener('click', closeBmModal);
  $('#bm-overlay').addEventListener('click', e => {
    if (e.target === $('#bm-overlay')) closeBmModal();
  });
  initBmForm();

  // 通用 modal
  $('#modal-overlay').addEventListener('click', e => {
    if (e.target === $('#modal-overlay')) hideGenericModal();
  });

  // 我的預約
  initMyBookings();

  // 載入本週
  loadWeek(getMondayOf(new Date()));
}

document.addEventListener('DOMContentLoaded', init);
