// ── 設定檔 ────────────────────────────────────────────────
window.APP_CONFIG = {
  // ⚠️ Fork 本專案後請務必換成自己部署的 GAS Web App URL，
  //    否則資料會寫進原作者的試算表。留空字串（''）則使用 localStorage 離線模擬。
  GAS_URL: 'https://script.google.com/macros/s/AKfycbw8ZlVNVgjEo6OBVOwl19Xy8DONDh0dkIXplxKK9J4mJEF-5HQZlRUg1DJiPaIC-ofB/exec',

  ROOM: { id: 'R01', name: '測試室', capacity: 10, floor: '3F', features: ['投影機', '白板'] },

  START_HOUR: 9,   // 09:00
  END_HOUR:   19,  // 19:00（最後時段 18:30~19:00）
};
