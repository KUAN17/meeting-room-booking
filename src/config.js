// ── 設定檔 ────────────────────────────────────────────────
// 部署 Google Apps Script 後，將 Web App URL 填入下方
window.APP_CONFIG = {
  // Google Apps Script Web App URL
  // 格式：https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
  GAS_URL: 'https://script.google.com/macros/s/AKfycbw8ZlVNVgjEo6OBVOwl19Xy8DONDh0dkIXplxKK9J4mJEF-5HQZlRUg1DJiPaIC-ofB/exec',

  // 預設會議室（若 GAS_URL 為空則使用此列表）
  DEFAULT_ROOMS: [
    { id: 'R01', name: '第一會議室', capacity: 10, floor: '3F', features: ['投影機', '白板'] },
    { id: 'R02', name: '第二會議室', capacity: 6,  floor: '3F', features: ['電視', '白板'] },
    { id: 'R03', name: '大型會議室', capacity: 30, floor: '4F', features: ['投影機', '視訊設備', '白板'] },
    { id: 'R04', name: '小型討論室', capacity: 4,  floor: '2F', features: ['白板'] },
  ],

  // 可預約時段（整點）
  TIME_SLOTS: [
    '08:00','09:00','10:00','11:00',
    '12:00','13:00','14:00','15:00',
    '16:00','17:00','18:00','19:00',
  ],

  // 每次最多可預約幾個小時
  MAX_HOURS: 4,

  // 可預約幾天以內（含今天）
  BOOK_AHEAD_DAYS: 30,
};
