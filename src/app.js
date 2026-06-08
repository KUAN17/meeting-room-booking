/* ── 會議室預約系統 前端主程式 ─────────────────────────────── */
'use strict';

const cfg = window.APP_CONFIG;

/* ── 狀態 ──────────────────────────────────────────────────── */
const state = {
  rooms:         [],
  bookings:      [],       // 已從後端載入的預約
  selectedRoom:  null,
  selectedDate:  null,
  selectedSlots: [],       // ['09:00','10:00']
  calYear:       0,
  calMonth:      0,
  scheduleDate:  new Date(),
};

/* ── 工具函式 ───────────────────────────────────────────────── */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function fmtDate(d) {
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function today() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function isoToDate(s) { const [y,m,d] = s.split('-'); return new Date(+y, +m-1, +d); }

function showLoading() { $('#loading-overlay').classList.remove('hidden'); }
function hideLoading() { $('#loading-overlay').classList.add('hidden'); }

function showModal({ icon='', title='', body='', cancelLabel='', onCancel=null, closeLabel='確認', onClose=null }) {
  $('#modal-icon').textContent = icon;
  $('#modal-title').textContent = title;
  $('#modal-body').textContent = body;
  $('#modal-close').textContent = closeLabel;
  const cancelBtn = $('#modal-cancel');
  if (cancelLabel && onCancel) {
    cancelBtn.textContent = cancelLabel;
    cancelBtn.classList.remove('hidden');
    cancelBtn.onclick = () => { hideModal(); onCancel(); };
  } else {
    cancelBtn.classList.add('hidden');
  }
  $('#modal-close').onclick = () => { hideModal(); if (onClose) onClose(); };
  $('#modal-overlay').classList.remove('hidden');
}
function hideModal() { $('#modal-overlay').classList.add('hidden'); }

/* ── API 層 ─────────────────────────────────────────────────── */
async function apiCall(action, params = {}) {
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

/* ── 模擬後端（GAS_URL 未設定時使用） ──────────────────────── */
const mockDB = { bookings: JSON.parse(localStorage.getItem('mockBookings') || '[]') };

function saveMock() { localStorage.setItem('mockBookings', JSON.stringify(mockDB.bookings)); }

async function mockApi(action, params) {
  await new Promise(r => setTimeout(r, 220));   // simulate network
  switch (action) {
    case 'getRooms':
      return { ok: true, rooms: cfg.DEFAULT_ROOMS };

    case 'getBookings': {
      const list = mockDB.bookings.filter(b =>
        (!params.date   || b.date === params.date) &&
        (!params.roomId || b.roomId === params.roomId) &&
        b.status !== 'cancelled'
      );
      return { ok: true, bookings: list };
    }
    case 'getMyBookings': {
      const list = mockDB.bookings.filter(b => b.email === params.email);
      return { ok: true, bookings: list };
    }
    case 'createBooking': {
      const id = 'BK' + Date.now();
      const booking = { id, status: 'active', createdAt: new Date().toISOString(), ...params };
      mockDB.bookings.push(booking);
      saveMock();
      return { ok: true, bookingId: id };
    }
    case 'cancelBooking': {
      const idx = mockDB.bookings.findIndex(b => b.id === params.id && b.email === params.email);
      if (idx === -1) return { ok: false, error: '找不到預約或 Email 不符' };
      mockDB.bookings[idx].status = 'cancelled';
      saveMock();
      return { ok: true };
    }
    default:
      return { ok: false, error: 'unknown action' };
  }
}

/* ── 載入資料 ───────────────────────────────────────────────── */
async function loadRooms() {
  const res = await apiCall('getRooms');
  state.rooms = res.rooms || cfg.DEFAULT_ROOMS;
  renderRoomList();
}

async function loadBookings(date, roomId) {
  const res = await apiCall('getBookings', { date, roomId });
  state.bookings = res.bookings || [];
}

/* ── 導覽 ───────────────────────────────────────────────────── */
function navigate(view) {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'schedule') renderSchedule();
}

/* ── 會議室列表 ─────────────────────────────────────────────── */
function renderRoomList() {
  const el = $('#room-list');
  el.innerHTML = state.rooms.map(r => `
    <div class="room-card${state.selectedRoom?.id === r.id ? ' selected' : ''}"
         data-id="${r.id}">
      <div class="room-card-name">${r.name}</div>
      <div class="room-card-meta">
        <span>🏢 ${r.floor}</span>
        <span>👥 ${r.capacity} 人</span>
      </div>
      <div class="room-card-tags">
        ${(r.features || []).map(f => `<span class="room-tag">${f}</span>`).join('')}
      </div>
    </div>`).join('');

  $$('.room-card', el).forEach(card => {
    card.addEventListener('click', () => {
      state.selectedRoom = state.rooms.find(r => r.id === card.dataset.id);
      renderRoomList();
      refreshTimeSlots();
      updateSummary();
    });
  });
}

/* ── 月曆 ───────────────────────────────────────────────────── */
function initCalendar() {
  const t = today();
  state.calYear  = t.getFullYear();
  state.calMonth = t.getMonth();
  renderCalendar();
  $('#cal-prev').addEventListener('click', () => {
    if (state.calMonth === 0) { state.calYear--; state.calMonth = 11; }
    else state.calMonth--;
    renderCalendar();
  });
  $('#cal-next').addEventListener('click', () => {
    if (state.calMonth === 11) { state.calYear++; state.calMonth = 0; }
    else state.calMonth++;
    renderCalendar();
  });
}

function renderCalendar() {
  const { calYear: y, calMonth: m } = state;
  $('#cal-month-label').textContent = `${y} 年 ${m+1} 月`;

  const first = new Date(y, m, 1).getDay();
  const days  = new Date(y, m+1, 0).getDate();
  const t     = today();
  const maxD  = new Date(t); maxD.setDate(t.getDate() + cfg.BOOK_AHEAD_DAYS - 1);

  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div class="cal-day empty"></div>');
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, m, d);
    const iso  = fmtDateISO(date);
    const isToday    = date.toDateString() === t.toDateString();
    const isPast     = date < t;
    const isFuture   = date > maxD;
    const isSelected = state.selectedDate === iso;
    const cls = [
      'cal-day',
      isToday    ? 'today'    : '',
      isPast || isFuture ? 'disabled' : '',
      isSelected ? 'selected' : '',
    ].filter(Boolean).join(' ');
    cells.push(`<div class="${cls}" data-date="${iso}">${d}</div>`);
  }
  $('#cal-days').innerHTML = cells.join('');

  $$('.cal-day:not(.empty):not(.disabled)').forEach(el => {
    el.addEventListener('click', async () => {
      state.selectedDate  = el.dataset.date;
      state.selectedSlots = [];
      renderCalendar();
      await refreshTimeSlots();
      updateSummary();
    });
  });
}

/* ── 時段 ───────────────────────────────────────────────────── */
async function refreshTimeSlots() {
  const el = $('#time-slots');
  if (!state.selectedRoom || !state.selectedDate) {
    el.innerHTML = '<p class="hint">請先選擇會議室與日期</p>';
    return;
  }
  el.innerHTML = '<p class="hint">載入中…</p>';
  showLoading();
  try {
    await loadBookings(state.selectedDate, state.selectedRoom.id);
  } finally { hideLoading(); }
  renderTimeSlots();
}

function bookedSlots() {
  return state.bookings.flatMap(b => b.slots || []);
}

function renderTimeSlots() {
  const booked = new Set(bookedSlots());
  const nowH   = new Date().getHours();
  const nowMin  = new Date().getMinutes();
  const isToday = state.selectedDate === fmtDateISO(today());

  const html = cfg.TIME_SLOTS.map(slot => {
    const h = parseInt(slot);
    const isPast   = isToday && (h < nowH || (h === nowH && nowMin > 0));
    const isBooked = booked.has(slot);
    const isSelected = state.selectedSlots.includes(slot);
    const inRange  = false; // will be handled by selection logic

    let cls = 'time-slot';
    if (isBooked || isPast) cls += ' booked';
    else if (isSelected) cls += ' selected';

    const bk = state.bookings.find(b => (b.slots||[]).includes(slot));
    const sub = isBooked ? `<span class="slot-booked-tag">${bk ? bk.title?.slice(0,6)||'已預約' : '已預約'}</span>` : '';
    return `<div class="${cls}" data-slot="${slot}"><span class="slot-label">${slot}</span>${sub}</div>`;
  }).join('');
  $('#time-slots').innerHTML = html;

  $$('.time-slot:not(.booked)').forEach(el => {
    el.addEventListener('click', () => toggleSlot(el.dataset.slot));
  });
}

function toggleSlot(slot) {
  const idx = state.selectedSlots.indexOf(slot);
  if (idx === -1) {
    // 只允許連續時段
    if (state.selectedSlots.length === 0) {
      state.selectedSlots = [slot];
    } else {
      const all  = cfg.TIME_SLOTS;
      const sel  = state.selectedSlots.map(s => all.indexOf(s)).sort((a,b)=>a-b);
      const cur  = all.indexOf(slot);
      const min  = sel[0], max = sel[sel.length-1];
      if (cur === min - 1) {
        if (state.selectedSlots.length >= cfg.MAX_HOURS) { alert(`最多連續預約 ${cfg.MAX_HOURS} 小時`); return; }
        state.selectedSlots.unshift(slot);
      } else if (cur === max + 1) {
        if (state.selectedSlots.length >= cfg.MAX_HOURS) { alert(`最多連續預約 ${cfg.MAX_HOURS} 小時`); return; }
        state.selectedSlots.push(slot);
      } else {
        state.selectedSlots = [slot];
      }
    }
  } else {
    // deselect — only allow removing from ends
    const all = cfg.TIME_SLOTS;
    const sel = state.selectedSlots.map(s => all.indexOf(s)).sort((a,b)=>a-b);
    const cur = all.indexOf(slot);
    if (cur === sel[0] || cur === sel[sel.length-1]) {
      state.selectedSlots.splice(idx, 1);
    } else {
      state.selectedSlots = [slot];
    }
  }
  renderTimeSlots();
  updateSummary();
  updateSubmitBtn();
}

function updateSubmitBtn() {
  const ok = state.selectedRoom && state.selectedDate && state.selectedSlots.length > 0;
  $('#submit-btn').disabled = !ok;
}

/* ── 摘要 ───────────────────────────────────────────────────── */
function updateSummary() {
  const el = $('#booking-summary');
  if (!state.selectedRoom && !state.selectedDate) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  $('#sum-room').textContent = state.selectedRoom?.name || '—';
  $('#sum-date').textContent = state.selectedDate ? fmtDate(isoToDate(state.selectedDate)) : '—';
  const slots = state.selectedSlots;
  if (slots.length === 0) {
    $('#sum-time').textContent = '尚未選擇';
  } else {
    const end = cfg.TIME_SLOTS[cfg.TIME_SLOTS.indexOf(slots[slots.length-1]) + 1] || '結束';
    $('#sum-time').textContent = `${slots[0]} – ${end}（${slots.length} 小時）`;
  }
  updateSubmitBtn();
}

/* ── 送出預約 ───────────────────────────────────────────────── */
function initForm() {
  $('#booking-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!state.selectedRoom || !state.selectedDate || state.selectedSlots.length === 0) {
      setFormMsg('請完整選擇會議室、日期與時段', 'error'); return;
    }
    const body = {
      roomId:    state.selectedRoom.id,
      roomName:  state.selectedRoom.name,
      date:      state.selectedDate,
      slots:     state.selectedSlots,
      name:      $('#f-name').value.trim(),
      email:     $('#f-email').value.trim(),
      dept:      $('#f-dept').value.trim(),
      title:     $('#f-title').value.trim(),
      attendees: $('#f-attendees').value,
      note:      $('#f-note').value.trim(),
    };
    showLoading();
    try {
      const res = await apiPost('createBooking', body);
      hideLoading();
      if (res.ok) {
        showModal({
          icon: '✅', title: '預約成功！',
          body: `已成功預約 ${body.roomName}，${fmtDate(isoToDate(body.date))} ${body.slots[0]} 開始。預約編號：${res.bookingId}`,
          closeLabel: '確認',
          onClose: () => {
            $('#booking-form').reset();
            state.selectedSlots = [];
            renderTimeSlots(); updateSummary(); updateSubmitBtn();
          },
        });
      } else {
        showModal({ icon: '❌', title: '預約失敗', body: res.error || '請稍後再試' });
      }
    } catch (err) {
      hideLoading();
      showModal({ icon: '❌', title: '連線錯誤', body: err.message });
    }
  });
}

function setFormMsg(msg, type = '') {
  const el = $('#form-msg');
  el.textContent = msg;
  el.className = 'form-msg' + (type ? ' ' + type : '');
}

/* ── 我的預約 ───────────────────────────────────────────────── */
function initMyBookings() {
  $('#query-btn').addEventListener('click', queryMyBookings);
  $('#query-email').addEventListener('keydown', e => { if (e.key === 'Enter') queryMyBookings(); });
}

async function queryMyBookings() {
  const email = $('#query-email').value.trim();
  if (!email) return;
  showLoading();
  try {
    const res = await apiCall('getMyBookings', { email });
    hideLoading();
    renderMyBookings(res.bookings || []);
  } catch (err) {
    hideLoading();
    $('#my-bookings-list').innerHTML = `<p class="hint">查詢失敗：${err.message}</p>`;
  }
}

function renderMyBookings(bookings) {
  const el = $('#my-bookings-list');
  if (bookings.length === 0) {
    el.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
      </svg>
      <p>查無預約紀錄</p></div>`;
    return;
  }
  const t = today();
  el.innerHTML = bookings.map(b => {
    const bDate  = isoToDate(b.date);
    const isPast = bDate < t;
    const status = b.status === 'cancelled' ? 'cancelled' : isPast ? 'past' : 'active';
    const label  = { cancelled: '已取消', past: '已結束', active: '有效' }[status];
    const slots  = b.slots || [];
    const endIdx = cfg.TIME_SLOTS.indexOf(slots[slots.length-1]) + 1;
    const endT   = cfg.TIME_SLOTS[endIdx] || '—';
    return `<div class="booking-item">
      <div class="booking-item-left">
        <div class="booking-item-title">${b.title}</div>
        <div class="booking-item-meta">
          <span>🏢 ${b.roomName}</span>
          <span>📅 ${fmtDate(bDate)}</span>
          <span>🕐 ${slots[0] || '—'} – ${endT}</span>
          <span>👤 ${b.name}</span>
        </div>
      </div>
      <div class="booking-item-actions">
        <span class="badge badge-${status}">${label}</span>
        ${status === 'active' ? `<button class="btn btn-outline btn-sm" data-cancel="${b.id}" data-email="${b.email}">取消</button>` : ''}
      </div>
    </div>`;
  }).join('');

  $$('[data-cancel]', el).forEach(btn => {
    btn.addEventListener('click', () => {
      showModal({
        icon: '⚠️', title: '確定取消預約？',
        body: '取消後無法復原，請確認後再操作。',
        cancelLabel: '返回', onCancel: ()=>{},
        closeLabel: '確定取消',
        onClose: async () => {
          showLoading();
          try {
            const res = await apiPost('cancelBooking', { id: btn.dataset.cancel, email: btn.dataset.email });
            hideLoading();
            if (res.ok) { queryMyBookings(); }
            else showModal({ icon: '❌', title: '取消失敗', body: res.error || '請稍後再試' });
          } catch (err) { hideLoading(); showModal({ icon: '❌', title: '連線錯誤', body: err.message }); }
        },
      });
    });
  });
}

/* ── 時程表 ─────────────────────────────────────────────────── */
function initSchedule() {
  state.scheduleDate = today();
  updateScheduleDateLabel();
  $('#sch-prev').addEventListener('click', () => {
    state.scheduleDate.setDate(state.scheduleDate.getDate() - 1);
    updateScheduleDateLabel();
    renderSchedule();
  });
  $('#sch-next').addEventListener('click', () => {
    state.scheduleDate.setDate(state.scheduleDate.getDate() + 1);
    updateScheduleDateLabel();
    renderSchedule();
  });
  $('#sch-today').addEventListener('click', () => {
    state.scheduleDate = today();
    updateScheduleDateLabel();
    renderSchedule();
  });
}

function updateScheduleDateLabel() {
  const d = state.scheduleDate;
  const days = ['日','一','二','三','四','五','六'];
  $('#sch-date-label').textContent = `${fmtDate(d)}（週${days[d.getDay()]}）`;
}

async function renderSchedule() {
  const iso = fmtDateISO(state.scheduleDate);
  showLoading();
  let bookings = [];
  try {
    const res = await apiCall('getBookings', { date: iso });
    bookings = res.bookings || [];
  } finally { hideLoading(); }

  const now   = new Date();
  const isToday = iso === fmtDateISO(today());

  const headerCells = state.rooms.map(r =>
    `<th class="room-header">${r.name}<br><small style="font-weight:400;color:var(--gray-500)">${r.floor}・${r.capacity}人</small></th>`
  ).join('');

  const rows = cfg.TIME_SLOTS.map(slot => {
    const h = parseInt(slot);
    const isPast = isToday && h < now.getHours();
    const cells = state.rooms.map(room => {
      const bk = bookings.find(b => b.roomId === room.id && (b.slots||[]).includes(slot));
      if (bk) {
        const cls = isPast ? 'past-booked' : 'booked';
        return `<td><div class="sch-slot ${cls}">
          <div class="sch-booking-title">${bk.title}</div>
          <div class="sch-booking-sub">${bk.name}・${bk.dept||''}</div>
        </div></td>`;
      }
      const cls = isPast ? 'past-free' : 'free';
      return `<td><div class="sch-slot ${cls}"></div></td>`;
    }).join('');
    return `<tr><td class="sch-time-cell">${slot}</td>${cells}</tr>`;
  }).join('');

  $('#schedule-grid').innerHTML = `
    <table class="sch-table">
      <thead><tr><th>時段</th>${headerCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ── 初始化 ─────────────────────────────────────────────────── */
async function init() {
  // 導覽
  $$('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.view))
  );
  $('#modal-overlay').addEventListener('click', e => {
    if (e.target === $('#modal-overlay')) hideModal();
  });

  // 月曆 & 表單
  initCalendar();
  initForm();
  initMyBookings();
  initSchedule();

  // 載入會議室
  showLoading();
  try { await loadRooms(); } finally { hideLoading(); }
}

document.addEventListener('DOMContentLoaded', init);
