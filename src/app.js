/* ── 會議室預約系統 前端主程式 ─────────────────────────────── */
'use strict';

const cfg = window.APP_CONFIG;

/* ── 狀態 ──────────────────────────────────────────────────── */
const state = {
  rooms:         [],
  bookings:      [],
  selectedRoom:  null,
  selectedDate:  null,
  startSlot:     null,   // '09:00'
  endSlot:       null,   // '11:00'（exclusive，即 11:00 開始的那格）
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
function isoToDate(s) { const [y,m,d] = s.split('-'); return new Date(+y,+m-1,+d); }
function timeToMin(t) { const [h,m] = t.split(':'); return +h*60 + +m; }
function addHour(t) {
  const [h,m] = t.split(':');
  return `${String(+h+1).padStart(2,'0')}:${m}`;
}

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
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
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

/* ── 模擬後端（GAS_URL 未設定時） ──────────────────────────── */
const mockDB = { bookings: JSON.parse(localStorage.getItem('mockBookings') || '[]') };
function saveMock() { localStorage.setItem('mockBookings', JSON.stringify(mockDB.bookings)); }

async function mockApi(action, params) {
  await new Promise(r => setTimeout(r, 200));
  switch (action) {
    case 'getRooms':
      return { ok: true, rooms: cfg.DEFAULT_ROOMS };

    case 'getBookings': {
      const list = mockDB.bookings.filter(b =>
        b.status !== 'cancelled' &&
        (!params.date   || b.date   === params.date) &&
        (!params.roomId || b.roomId === params.roomId)
      );
      return { ok: true, bookings: list };
    }
    case 'getMyBookings': {
      const list = mockDB.bookings.filter(b =>
        (params.empId  && b.empId  === params.empId) ||
        (params.email  && b.email  === params.email)
      );
      return { ok: true, bookings: list };
    }
    case 'createBooking': {
      // 衝突檢查
      const existing = mockDB.bookings.filter(b =>
        b.status !== 'cancelled' && b.date === params.date && b.roomId === params.roomId
      );
      const conflict = existing.some(b =>
        params.startTime < b.endTime && params.endTime > b.startTime
      );
      if (conflict) return { ok: false, error: '所選時段與現有預約衝突，請重新選擇' };
      const id = 'BK' + Date.now();
      mockDB.bookings.push({ id, status: 'active', createdAt: new Date().toISOString(), ...params });
      saveMock();
      return { ok: true, bookingId: id };
    }
    case 'cancelBooking': {
      const idx = mockDB.bookings.findIndex(b =>
        b.id === params.id &&
        ((params.empId && b.empId === params.empId) ||
         (params.email && b.email === params.email))
      );
      if (idx === -1) return { ok: false, error: '找不到預約，或員工編號 / Email 不符' };
      mockDB.bookings[idx].status = 'cancelled';
      saveMock();
      return { ok: true };
    }
    default: return { ok: false, error: 'unknown action' };
  }
}

/* ── 導覽 ───────────────────────────────────────────────────── */
function navigate(view) {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'schedule') renderSchedule();
}

/* ── 會議室列表 ─────────────────────────────────────────────── */
async function loadRooms() {
  const res = await apiCall('getRooms');
  state.rooms = res.rooms || cfg.DEFAULT_ROOMS;
  renderRoomList();
}

function renderRoomList() {
  const el = $('#room-list');
  el.innerHTML = state.rooms.map(r => `
    <div class="room-card${state.selectedRoom?.id === r.id ? ' selected' : ''}" data-id="${r.id}">
      <div class="room-card-name">${r.name}</div>
      <div class="room-card-meta">
        <span>🏢 ${r.floor}</span><span>👥 ${r.capacity} 人</span>
      </div>
      <div class="room-card-tags">
        ${(r.features||[]).map(f=>`<span class="room-tag">${f}</span>`).join('')}
      </div>
    </div>`).join('');
  $$('.room-card', el).forEach(card => {
    card.addEventListener('click', () => {
      state.selectedRoom  = state.rooms.find(r => r.id === card.dataset.id);
      state.startSlot = null; state.endSlot = null;
      renderRoomList(); refreshTimeSlots(); updateSummary();
    });
  });
}

/* ── 月曆 ───────────────────────────────────────────────────── */
function initCalendar() {
  const t = today();
  state.calYear = t.getFullYear(); state.calMonth = t.getMonth();
  renderCalendar();
  $('#cal-prev').addEventListener('click', () => {
    if (state.calMonth === 0) { state.calYear--; state.calMonth = 11; } else state.calMonth--;
    renderCalendar();
  });
  $('#cal-next').addEventListener('click', () => {
    if (state.calMonth === 11) { state.calYear++; state.calMonth = 0; } else state.calMonth++;
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
    const cls  = ['cal-day',
      date.toDateString() === t.toDateString() ? 'today' : '',
      (date < t || date > maxD) ? 'disabled' : '',
      state.selectedDate === iso ? 'selected' : '',
    ].filter(Boolean).join(' ');
    cells.push(`<div class="${cls}" data-date="${iso}">${d}</div>`);
  }
  $('#cal-days').innerHTML = cells.join('');
  $$('.cal-day:not(.empty):not(.disabled)').forEach(el => {
    el.addEventListener('click', async () => {
      state.selectedDate = el.dataset.date;
      state.startSlot = null; state.endSlot = null;
      renderCalendar();
      await refreshTimeSlots();
      updateSummary();
    });
  });
}

/* ── 時段（連續拖選：點起點再點終點） ──────────────────────── */
async function refreshTimeSlots() {
  const el = $('#time-slots');
  if (!state.selectedRoom || !state.selectedDate) {
    el.innerHTML = '<p class="hint">請先選擇會議室與日期</p>'; return;
  }
  el.innerHTML = '<p class="hint">載入中…</p>';
  showLoading();
  try {
    const res = await apiCall('getBookings', { date: state.selectedDate, roomId: state.selectedRoom.id });
    state.bookings = res.bookings || [];
  } finally { hideLoading(); }
  renderTimeSlots();
}

function isSlotBusy(slot) {
  const slotMin = timeToMin(slot);
  return state.bookings.some(b =>
    slotMin >= timeToMin(b.startTime) && slotMin < timeToMin(b.endTime)
  );
}

function renderTimeSlots() {
  const nowH   = new Date().getHours();
  const isToday = state.selectedDate === fmtDateISO(today());
  const selStart = state.startSlot ? timeToMin(state.startSlot) : null;
  const selEnd   = state.endSlot   ? timeToMin(state.endSlot)   : null;

  const html = cfg.TIME_SLOTS.map(slot => {
    const h      = parseInt(slot);
    const slotM  = timeToMin(slot);
    const isPast = isToday && h < nowH;
    const busy   = isSlotBusy(slot);
    const bk     = state.bookings.find(b =>
      slotM >= timeToMin(b.startTime) && slotM < timeToMin(b.endTime)
    );

    let cls = 'time-slot';
    if (busy || isPast) {
      cls += ' booked';
    } else if (selStart !== null && selEnd !== null &&
               slotM >= selStart && slotM < selEnd) {
      cls += ' selected';
    } else if (selStart !== null && selEnd === null && slotM === selStart) {
      cls += ' selected';
    }

    const sub = busy
      ? `<span class="slot-booked-tag">${bk ? (bk.title?.slice(0,6) || '已預約') : '已預約'}</span>`
      : '';
    return `<div class="${cls}" data-slot="${slot}"><span class="slot-label">${slot}</span>${sub}</div>`;
  }).join('');

  $('#time-slots').innerHTML = html;
  $$('.time-slot:not(.booked)').forEach(el => {
    el.addEventListener('click', () => pickSlot(el.dataset.slot));
  });
}

function pickSlot(slot) {
  if (!state.startSlot || (state.startSlot && state.endSlot)) {
    // 重新選起點
    state.startSlot = slot; state.endSlot = null;
  } else {
    // 選終點
    const startM = timeToMin(state.startSlot);
    const endM   = timeToMin(slot);
    if (endM <= startM) { state.startSlot = slot; state.endSlot = null; }
    else {
      // 確保中間沒有已預約的時段
      const slots = cfg.TIME_SLOTS.filter(s => {
        const m = timeToMin(s);
        return m >= startM && m < endM;
      });
      const maxH = cfg.MAX_HOURS;
      if (slots.length > maxH) {
        alert(`最多連續預約 ${maxH} 小時`); return;
      }
      const hasConflict = slots.some(s => isSlotBusy(s));
      if (hasConflict) {
        alert('選取範圍內包含已預約的時段，請重新選擇'); return;
      }
      state.endSlot = slot;   // endSlot exclusive（開始時間）
    }
  }
  renderTimeSlots(); updateSummary(); updateSubmitBtn();
}

function updateSubmitBtn() {
  const ok = state.selectedRoom && state.selectedDate && state.startSlot && state.endSlot;
  $('#submit-btn').disabled = !ok;
}

/* ── 摘要 ───────────────────────────────────────────────────── */
function updateSummary() {
  const el = $('#booking-summary');
  if (!state.selectedRoom && !state.selectedDate) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  $('#sum-room').textContent = state.selectedRoom?.name || '—';
  $('#sum-date').textContent = state.selectedDate ? fmtDate(isoToDate(state.selectedDate)) : '—';
  if (state.startSlot && state.endSlot) {
    const startM = timeToMin(state.startSlot);
    const endM   = timeToMin(state.endSlot);
    const hrs    = (endM - startM) / 60;
    $('#sum-time').textContent = `${state.startSlot} – ${state.endSlot}（${hrs} 小時）`;
  } else if (state.startSlot) {
    $('#sum-time').textContent = `${state.startSlot}（請再選結束時段）`;
  } else {
    $('#sum-time').textContent = '尚未選擇';
  }
  updateSubmitBtn();
}

/* ── 表單 ───────────────────────────────────────────────────── */
function initForm() {
  $('#booking-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!state.selectedRoom || !state.selectedDate || !state.startSlot || !state.endSlot) {
      setFormMsg('請完整選擇會議室、日期與時段（需選起訖兩個時間點）', 'error'); return;
    }
    const body = {
      roomId:    state.selectedRoom.id,
      roomName:  state.selectedRoom.name,
      date:      state.selectedDate,
      startTime: state.startSlot,
      endTime:   state.endSlot,
      name:      $('#f-name').value.trim(),
      empId:     $('#f-empid').value.trim(),
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
          body: `已成功預約 ${body.roomName}，${fmtDate(isoToDate(body.date))} ${body.startTime}–${body.endTime}。預約編號：${res.bookingId}`,
          closeLabel: '確認',
          onClose: () => {
            $('#booking-form').reset();
            state.startSlot = null; state.endSlot = null;
            renderTimeSlots(); updateSummary(); updateSubmitBtn();
          },
        });
      } else {
        showModal({ icon: '❌', title: '預約失敗', body: res.error || '請稍後再試' });
      }
    } catch (err) {
      hideLoading(); showModal({ icon: '❌', title: '連線錯誤', body: err.message });
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
  $('#query-empid').addEventListener('keydown', e => { if (e.key === 'Enter') queryMyBookings(); });
}
async function queryMyBookings() {
  const empId = $('#query-empid').value.trim();
  if (!empId) return;
  showLoading();
  try {
    const res = await apiCall('getMyBookings', { empId });
    hideLoading(); renderMyBookings(res.bookings || []);
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
      </svg><p>查無預約紀錄</p></div>`;
    return;
  }
  const t = today();
  el.innerHTML = bookings.map(b => {
    const bDate  = isoToDate(b.date);
    const isPast = bDate < t;
    const status = b.status === 'cancelled' ? 'cancelled' : isPast ? 'past' : 'active';
    const label  = { cancelled: '已取消', past: '已結束', active: '有效' }[status];
    return `<div class="booking-item">
      <div class="booking-item-left">
        <div class="booking-item-title">${b.title || '（無標題）'}</div>
        <div class="booking-item-meta">
          <span>🏢 ${b.roomName}</span>
          <span>📅 ${fmtDate(bDate)}</span>
          <span>🕐 ${b.startTime} – ${b.endTime}</span>
          <span>👤 ${b.name}${b.dept ? '・' + b.dept : ''}</span>
        </div>
      </div>
      <div class="booking-item-actions">
        <span class="badge badge-${status}">${label}</span>
        ${status === 'active'
          ? `<button class="btn btn-outline btn-sm" data-cancel="${b.id}" data-empid="${b.empId}" data-email="${b.email}">取消</button>`
          : ''}
      </div>
    </div>`;
  }).join('');

  $$('[data-cancel]', el).forEach(btn => {
    btn.addEventListener('click', () => {
      showModal({
        icon: '⚠️', title: '確定取消預約？',
        body: '取消後無法復原，請確認後再操作。',
        cancelLabel: '返回', onCancel: () => {},
        closeLabel: '確定取消',
        onClose: async () => {
          showLoading();
          try {
            const res = await apiPost('cancelBooking', {
              id: btn.dataset.cancel,
              empId: btn.dataset.empid,
              email: btn.dataset.email,
            });
            hideLoading();
            if (res.ok) queryMyBookings();
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
    updateScheduleDateLabel(); renderSchedule();
  });
  $('#sch-next').addEventListener('click', () => {
    state.scheduleDate.setDate(state.scheduleDate.getDate() + 1);
    updateScheduleDateLabel(); renderSchedule();
  });
  $('#sch-today').addEventListener('click', () => {
    state.scheduleDate = today(); updateScheduleDateLabel(); renderSchedule();
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

  const now     = new Date();
  const isToday = iso === fmtDateISO(today());

  const headerCells = state.rooms.map(r =>
    `<th class="room-header">${r.name}<br><small style="font-weight:400;color:var(--gray-500)">${r.floor}・${r.capacity}人</small></th>`
  ).join('');

  const rows = cfg.TIME_SLOTS.map(slot => {
    const h = parseInt(slot);
    const isPast = isToday && h < now.getHours();
    const slotM = timeToMin(slot);
    const cells = state.rooms.map(room => {
      const bk = bookings.find(b =>
        b.roomId === room.id &&
        slotM >= timeToMin(b.startTime) && slotM < timeToMin(b.endTime)
      );
      if (bk) {
        const cls = isPast ? 'past-booked' : 'booked';
        return `<td><div class="sch-slot ${cls}">
          <div class="sch-booking-title">${bk.title || '已預約'}</div>
          <div class="sch-booking-sub">${bk.name}${bk.dept ? '・'+bk.dept : ''}</div>
        </div></td>`;
      }
      return `<td><div class="sch-slot ${isPast ? 'past-free' : 'free'}"></div></td>`;
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
  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.view)));
  $('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) hideModal(); });
  initCalendar(); initForm(); initMyBookings(); initSchedule();
  showLoading();
  try { await loadRooms(); } finally { hideLoading(); }
}
document.addEventListener('DOMContentLoaded', init);
