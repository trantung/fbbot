/** Cấu hình Chromium dùng chung — PC và VPS phải giống nhau khi sync profile */
function getContextOptions(headless = true) {
  return {
    headless,
    viewport: { width: 1366, height: 900 },
    locale: 'vi-VN',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  };
}

module.exports = { getContextOptions };
