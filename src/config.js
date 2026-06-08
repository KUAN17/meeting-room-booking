// ── 設定檔 ────────────────────────────────────────────────
window.APP_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbw8ZlVNVgjEo6OBVOwl19Xy8DONDh0dkIXplxKK9J4mJEF-5HQZlRUg1DJiPaIC-ofB/exec',

  ROOM: { id: 'R01', name: '測試室', capacity: 10, floor: '3F', features: ['投影機', '白板'] },

  START_HOUR: 8,   // 08:00
  END_HOUR:   18,  // 18:00（最後時段 17:30~18:00）

  // 可選時長（單位：小時）
  DURATIONS: [0.5, 1, 1.5, 2, 2.5, 3],
  DEFAULT_DURATION: 1,

  BOOK_AHEAD_WEEKS: 4,
};
