/**
 * 會議室預約系統 — Google Apps Script 後端
 *
 * 部署方式：
 *   1. 在 Google Sheets 開啟「擴充功能 > Apps Script」
 *   2. 將此檔案貼入編輯器（取代預設的 Code.gs）
 *   3. 執行 setupSheets() 建立工作表結構
 *   4. 部署 > 新增部署 > 類型選「網頁應用程式」
 *      - 執行身分：我（試算表擁有者）
 *      - 存取權限：所有人
 *   5. 複製 Web App URL，貼入 src/config.js 的 GAS_URL
 */

// ── 設定 ────────────────────────────────────────────────────
const SHEET_BOOKINGS = '預約紀錄';
const SHEET_ROOMS    = '會議室';

const ROOMS_DEFAULT = [
  { id: 'R01', name: '第一會議室', capacity: 10, floor: '3F', features: '投影機,白板' },
  { id: 'R02', name: '第二會議室', capacity: 6,  floor: '3F', features: '電視,白板' },
  { id: 'R03', name: '大型會議室', capacity: 30, floor: '4F', features: '投影機,視訊設備,白板' },
  { id: 'R04', name: '小型討論室', capacity: 4,  floor: '2F', features: '白板' },
];

// ── 進入點 ───────────────────────────────────────────────────
function doGet(e) {
  return handleRequest(e);
}
function doPost(e) {
  return handleRequest(e, true);
}

function handleRequest(e, isPost = false) {
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
      case 'getRooms':      result = getRooms();              break;
      case 'getBookings':   result = getBookings(params);     break;
      case 'getMyBookings': result = getMyBookings(params);   break;
      case 'createBooking': result = createBooking(params);   break;
      case 'cancelBooking': result = cancelBooking(params);   break;
      default:              result = { ok: false, error: 'Unknown action' };
    }
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 工作表操作 ───────────────────────────────────────────────
function getOrCreateSheet(name, headers) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let sheet   = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
         .setBackground('#2563eb').setFontColor('#ffffff').setFontWeight('bold');
  }
  return sheet;
}

function setupSheets() {
  // 預約紀錄工作表
  getOrCreateSheet(SHEET_BOOKINGS, [
    'ID', '狀態', '會議室ID', '會議室名稱', '日期', '時段',
    '主題', '姓名', 'Email', '部門', '人數', '備註', '建立時間'
  ]);

  // 會議室工作表
  const roomSheet = getOrCreateSheet(SHEET_ROOMS, ['ID', '名稱', '容量', '樓層', '設備']);
  if (roomSheet.getLastRow() <= 1) {
    ROOMS_DEFAULT.forEach(r => {
      roomSheet.appendRow([r.id, r.name, r.capacity, r.floor, r.features]);
    });
  }
  SpreadsheetApp.getUi().alert('✅ 工作表建立完成！');
}

// ── 業務邏輯 ─────────────────────────────────────────────────
function getRooms() {
  const sheet = getOrCreateSheet(SHEET_ROOMS, ['ID', '名稱', '容量', '樓層', '設備']);
  const rows  = sheet.getDataRange().getValues().slice(1);  // skip header
  const rooms = rows.filter(r => r[0]).map(r => ({
    id:       String(r[0]),
    name:     String(r[1]),
    capacity: Number(r[2]),
    floor:    String(r[3]),
    features: String(r[4]).split(',').map(s => s.trim()).filter(Boolean),
  }));
  return { ok: true, rooms };
}

function getBookings({ date, roomId }) {
  const sheet = getOrCreateSheet(SHEET_BOOKINGS, []);
  const rows  = sheet.getDataRange().getValues().slice(1);
  const bookings = rows
    .filter(r => r[0] && r[1] !== 'cancelled')
    .filter(r => (!date   || String(r[4]) === date))
    .filter(r => (!roomId || String(r[2]) === roomId))
    .map(rowToBooking);
  return { ok: true, bookings };
}

function getMyBookings({ email }) {
  const sheet = getOrCreateSheet(SHEET_BOOKINGS, []);
  const rows  = sheet.getDataRange().getValues().slice(1);
  const bookings = rows
    .filter(r => r[0] && String(r[8]).toLowerCase() === email.toLowerCase())
    .map(rowToBooking)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return { ok: true, bookings };
}

function createBooking(params) {
  const { roomId, roomName, date, slots, name, email, dept, title, attendees, note } = params;

  // 衝突檢查
  const existing = getBookings({ date, roomId }).bookings;
  const bookedSlots = new Set(existing.flatMap(b => b.slots));
  const reqSlots    = Array.isArray(slots) ? slots : JSON.parse(slots);
  const conflict    = reqSlots.some(s => bookedSlots.has(s));
  if (conflict) return { ok: false, error: '所選時段已被預約，請重新選擇' };

  const id    = 'BK' + Date.now();
  const sheet = getOrCreateSheet(SHEET_BOOKINGS, []);
  sheet.appendRow([
    id, 'active', roomId, roomName, date, reqSlots.join(','),
    title, name, email, dept || '', attendees || '', note || '',
    new Date().toISOString(),
  ]);
  return { ok: true, bookingId: id };
}

function cancelBooking({ id, email }) {
  const sheet = getOrCreateSheet(SHEET_BOOKINGS, []);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id) &&
        String(data[i][8]).toLowerCase() === email.toLowerCase()) {
      sheet.getRange(i + 1, 2).setValue('cancelled');
      return { ok: true };
    }
  }
  return { ok: false, error: '找不到預約或 Email 不符' };
}

// ── 輔助 ─────────────────────────────────────────────────────
function rowToBooking(r) {
  return {
    id:        String(r[0]),
    status:    String(r[1]),
    roomId:    String(r[2]),
    roomName:  String(r[3]),
    date:      String(r[4]),
    slots:     String(r[5]).split(',').filter(Boolean),
    title:     String(r[6]),
    name:      String(r[7]),
    email:     String(r[8]),
    dept:      String(r[9]),
    attendees: Number(r[10]),
    note:      String(r[11]),
    createdAt: String(r[12]),
  };
}
