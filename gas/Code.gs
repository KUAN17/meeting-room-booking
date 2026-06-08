/**
 * 會議室預約系統 — Google Apps Script 後端
 *
 * Google Sheet 欄位順序（bookings 工作表）：
 *   A: id        B: date       C: start_time  D: end_time
 *   E: dept      F: name       G: emp_id      H: created_at
 *   I: room_id   J: room_name  K: status      L: title
 *   M: email     N: attendees  O: note
 *
 * 部署方式：
 *   1. 在 Google Sheets 開啟「擴充功能 > Apps Script」
 *   2. 將此檔案內容貼入編輯器（取代預設的 Code.gs）
 *   3. 執行 setupSheets() → 會自動補齊缺少的欄位標題
 *   4. 部署 > 新增部署 > 類型「網頁應用程式」
 *      - 執行身分：我（試算表擁有者）
 *      - 存取權限：所有人
 *   5. 複製 Web App URL，貼入 src/config.js 的 GAS_URL
 */

// ── 設定 ────────────────────────────────────────────────────
const SHEET_BOOKINGS = 'bookings';
const SHEET_ROOMS    = 'rooms';

// 欄位索引（0-based）
const COL = {
  ID:        0,   // A
  DATE:      1,   // B
  START:     2,   // C start_time
  END:       3,   // D end_time
  DEPT:      4,   // E
  NAME:      5,   // F
  EMP_ID:    6,   // G
  CREATED:   7,   // H created_at
  ROOM_ID:   8,   // I
  ROOM_NAME: 9,   // J
  STATUS:    10,  // K
  TITLE:     11,  // L
  EMAIL:     12,  // M
  ATTENDEES: 13,  // N
  NOTE:      14,  // O
};

const ROOMS_DEFAULT = [
  { id: 'R01', name: '第一會議室', capacity: 10, floor: '3F', features: '投影機,白板' },
  { id: 'R02', name: '第二會議室', capacity: 6,  floor: '3F', features: '電視,白板' },
  { id: 'R03', name: '大型會議室', capacity: 30, floor: '4F', features: '投影機,視訊設備,白板' },
  { id: 'R04', name: '小型討論室', capacity: 4,  floor: '2F', features: '白板' },
];

// ── 進入點 ───────────────────────────────────────────────────
function doGet(e)  { return handleRequest(e, false); }
function doPost(e) { return handleRequest(e, true);  }

function handleRequest(e, isPost) {
  try {
    let action, params;
    if (isPost) {
      const body = JSON.parse(e.postData.contents);
      action = body.action;
      params = body;
    } else {
      action = e.parameter.action;
      params = e.parameter;
    }
    let result;
    switch (action) {
      case 'getRooms':      result = getRooms();            break;
      case 'getBookings':     result = getBookings(params);     break;
      case 'getWeekBookings': result = getWeekBookings(params); break;
      case 'getMyBookings': result = getMyBookings(params); break;
      case 'createBooking': result = createBooking(params); break;
      case 'cancelBooking': result = cancelBooking(params); break;
      case 'updateBooking': result = updateBooking(params); break;
      default:              result = { ok: false, error: 'Unknown action' };
    }
    return jsonRes(result);
  } catch (err) {
    return jsonRes({ ok: false, error: err.message });
  }
}

function jsonRes(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 初始化工作表（執行一次即可） ─────────────────────────────
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // bookings 工作表：補齊欄位標題
  let bSheet = ss.getSheetByName(SHEET_BOOKINGS);
  if (!bSheet) {
    bSheet = ss.insertSheet(SHEET_BOOKINGS);
  }
  const headers = [
    'id','date','start_time','end_time','dept','name','emp_id','created_at',
    'room_id','room_name','status','title','email','attendees','note'
  ];
  const existing = bSheet.getLastColumn() > 0
    ? bSheet.getRange(1, 1, 1, bSheet.getLastColumn()).getValues()[0]
    : [];
  headers.forEach((h, i) => {
    if (!existing[i]) bSheet.getRange(1, i + 1).setValue(h);
  });
  bSheet.setFrozenRows(1);
  bSheet.getRange(1, 1, 1, headers.length)
        .setBackground('#2563eb').setFontColor('#ffffff').setFontWeight('bold');

  // rooms 工作表
  let rSheet = ss.getSheetByName(SHEET_ROOMS);
  if (!rSheet) {
    rSheet = ss.insertSheet(SHEET_ROOMS);
    rSheet.appendRow(['id','name','capacity','floor','features']);
    rSheet.setFrozenRows(1);
    rSheet.getRange(1, 1, 1, 5)
          .setBackground('#2563eb').setFontColor('#ffffff').setFontWeight('bold');
    ROOMS_DEFAULT.forEach(r => rSheet.appendRow([r.id, r.name, r.capacity, r.floor, r.features]));
  }

  SpreadsheetApp.getUi().alert('✅ 工作表設定完成！');
}

// ── 業務邏輯 ─────────────────────────────────────────────────
function getRooms() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const sheet  = ss.getSheetByName(SHEET_ROOMS);
  if (!sheet || sheet.getLastRow() <= 1) {
    return { ok: true, rooms: ROOMS_DEFAULT.map(r => ({
      ...r, features: r.features.split(',').map(s => s.trim())
    })) };
  }
  const rows = sheet.getDataRange().getValues().slice(1);
  return {
    ok: true,
    rooms: rows.filter(r => r[0]).map(r => ({
      id:       String(r[0]),
      name:     String(r[1]),
      capacity: Number(r[2]),
      floor:    String(r[3]),
      features: String(r[4]).split(',').map(s => s.trim()).filter(Boolean),
    })),
  };
}

function getWeekBookings({ startDate, endDate, roomId }) {
  const rows = readBookings();
  const bookings = rows
    .filter(r => r[COL.ID] && String(r[COL.STATUS]) !== 'cancelled')
    .filter(r => {
      const d = toDateISO(r[COL.DATE]);
      return d >= startDate && d <= endDate;
    })
    .filter(r => !roomId || String(r[COL.ROOM_ID]) === roomId)
    .map(rowToObj);
  return { ok: true, bookings };
}

function getBookings({ date, roomId }) {
  const rows = readBookings();
  const bookings = rows
    .filter(r => r[COL.ID] && String(r[COL.STATUS]) !== 'cancelled')
    .filter(r => !date   || toDateISO(r[COL.DATE])   === date)
    .filter(r => !roomId || String(r[COL.ROOM_ID])   === roomId)
    .map(rowToObj);
  return { ok: true, bookings };
}

function getMyBookings({ empId, email }) {
  const rows = readBookings();
  const bookings = rows
    .filter(r => r[COL.ID])
    .filter(r => {
      if (empId) return String(r[COL.EMP_ID]).toLowerCase() === empId.toLowerCase();
      if (email) return String(r[COL.EMAIL]).toLowerCase() === email.toLowerCase();
      return false;
    })
    .map(rowToObj)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return { ok: true, bookings };
}

function createBooking(params) {
  const { roomId, roomName, date, startTime, endTime,
          dept, name, empId, title, email, attendees, note } = params;

  // 衝突檢查（同一會議室、同一天、時間重疊）
  const existing = getBookings({ date, roomId }).bookings;
  const conflict = existing.some(b => {
    // 若 [reqStart, reqEnd) 與 [bStart, bEnd) 有交集
    return startTime < b.endTime && endTime > b.startTime;
  });
  if (conflict) return { ok: false, error: '所選時段與現有預約衝突，請重新選擇' };

  const id    = 'BK' + Date.now();
  const sheet = getOrCreateBookingsSheet();
  // 按欄位順序寫入
  const row = new Array(15).fill('');
  row[COL.ID]        = id;
  row[COL.DATE]      = date;
  row[COL.START]     = startTime;
  row[COL.END]       = endTime;
  row[COL.DEPT]      = dept      || '';
  row[COL.NAME]      = name      || '';
  row[COL.EMP_ID]    = empId     || '';
  row[COL.CREATED]   = new Date().toISOString();
  row[COL.ROOM_ID]   = roomId    || '';
  row[COL.ROOM_NAME] = roomName  || '';
  row[COL.STATUS]    = 'active';
  row[COL.TITLE]     = title     || '';
  row[COL.EMAIL]     = email     || '';
  row[COL.ATTENDEES] = attendees || '';
  row[COL.NOTE]      = note      || '';
  sheet.appendRow(row);
  return { ok: true, bookingId: id };
}

function cancelBooking({ id, empId, email }) {
  const sheet = getOrCreateBookingsSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (String(r[COL.ID]) !== String(id)) continue;
    const matchEmp   = empId && String(r[COL.EMP_ID]).toLowerCase() === empId.toLowerCase();
    const matchEmail = email && String(r[COL.EMAIL]).toLowerCase() === email.toLowerCase();
    if (matchEmp || matchEmail) {
      sheet.getRange(i + 1, COL.STATUS + 1).setValue('cancelled');
      return { ok: true };
    }
  }
  return { ok: false, error: '找不到預約，或員工編號 / Email 不符' };
}

function updateBooking({ id, empId, roomId, date, startTime, endTime, name, dept, note }) {
  const sheet = getOrCreateBookingsSheet();
  const data  = sheet.getDataRange().getValues();

  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL.ID]) === String(id) &&
        String(data[i][COL.EMP_ID]).toLowerCase() === empId.toLowerCase()) {
      rowIdx = i; break;
    }
  }
  if (rowIdx === -1) return { ok: false, error: '找不到預約或員工編號不符' };

  // 衝突檢查（排除自己）
  const existing = getBookings({ date, roomId }).bookings.filter(b => b.id !== id);
  const conflict  = existing.some(b => startTime < b.endTime && endTime > b.startTime);
  if (conflict) return { ok: false, error: '所選時段與現有預約衝突，請重新選擇' };

  const r = rowIdx + 1;
  sheet.getRange(r, COL.DATE  + 1).setValue(date);
  sheet.getRange(r, COL.START + 1).setValue(startTime);
  sheet.getRange(r, COL.END   + 1).setValue(endTime);
  sheet.getRange(r, COL.NAME  + 1).setValue(name  || '');
  sheet.getRange(r, COL.DEPT  + 1).setValue(dept  || '');
  sheet.getRange(r, COL.NOTE  + 1).setValue(note  || '');
  return { ok: true };
}

// ── 輔助 ─────────────────────────────────────────────────────
function readBookings() {
  const sheet = getOrCreateBookingsSheet();
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getDataRange().getValues().slice(1);
}

function getOrCreateBookingsSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let sheet   = ss.getSheetByName(SHEET_BOOKINGS);
  if (!sheet) { sheet = ss.insertSheet(SHEET_BOOKINGS); }
  return sheet;
}

// Google Sheets 會自動將日期/時間字串轉為 Date 物件，讀回時需還原為字串
function toDateISO(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val);
}
function toTimeStr(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
  }
  // 若為數字（Sheets 內部時間值 0~1）
  if (typeof val === 'number') {
    const totalMin = Math.round(val * 24 * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  }
  return String(val);
}

function rowToObj(r) {
  return {
    id:        String(r[COL.ID]),
    date:      toDateISO(r[COL.DATE]),
    startTime: toTimeStr(r[COL.START]),
    endTime:   toTimeStr(r[COL.END]),
    dept:      String(r[COL.DEPT]   || ''),
    name:      String(r[COL.NAME]   || ''),
    empId:     String(r[COL.EMP_ID] || ''),
    createdAt: String(r[COL.CREATED]|| ''),
    roomId:    String(r[COL.ROOM_ID]  || ''),
    roomName:  String(r[COL.ROOM_NAME]|| ''),
    status:    String(r[COL.STATUS]   || ''),
    title:     String(r[COL.TITLE]    || ''),
    email:     String(r[COL.EMAIL]    || ''),
    attendees: Number(r[COL.ATTENDEES]|| 0),
    note:      String(r[COL.NOTE]     || ''),
  };
}
