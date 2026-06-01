const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./paths');

const LOG_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'commands.jsonl');

const COMMAND_PURPOSE = {
  post: 'Đăng 1 bài (Google Doc + folder ảnh) lên group Facebook',
  bulk: 'Đăng nhiều bài từ folder Drive cha (tải Google nếu chưa cache)',
  sync: 'Tải folder Drive cha về server (cache local), không đăng FB',
  push: 'Đăng bài từ cache local đã sync, không gọi Google Drive',
  list: 'Xem danh sách tài khoản & group',
  history: 'Xem lịch sử lệnh đã chạy',
  help: 'Xem hướng dẫn',
  start: 'Khởi động bot',
};

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * @param {{
 *   source?: string,
 *   chatId?: string|number,
 *   user?: string,
 *   command: string,
 *   args?: string[],
 *   purpose?: string,
 *   raw?: string,
 *   status: string,
 *   result?: string,
 * }} entry
 */
function logCommand(entry) {
  ensureLogDir();

  const record = {
    id: Date.now(),
    at: new Date().toISOString(),
    source: entry.source || 'telegram',
    chatId: entry.chatId != null ? String(entry.chatId) : null,
    user: entry.user || null,
    command: entry.command,
    args: entry.args || [],
    purpose: entry.purpose || COMMAND_PURPOSE[entry.command] || entry.command,
    raw: entry.raw || null,
    status: entry.status,
    result: entry.result || null,
  };

  fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');

  return record;
}

function getCommandHistory(limit = 15) {
  if (!fs.existsSync(LOG_FILE)) {
    return [];
  }

  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);

  return lines
    .slice(-Math.max(1, limit))
    .reverse()
    .map((line) => JSON.parse(line));
}

function formatHistoryText(history) {
  if (!history.length) {
    return 'Chưa có lịch sử lệnh.';
  }

  return history
    .map((h, i) => {
      const args = h.args?.length ? ' ' + h.args.join(' ') : '';
      const time = h.at.replace('T', ' ').slice(0, 19);

      return (
        `${i + 1}. [${h.status}] ${time}\n` +
        `   /${h.command}${args}\n` +
        `   → ${h.purpose}\n` +
        (h.result ? `   Kết quả: ${h.result}` : '')
      );
    })
    .join('\n\n');
}

module.exports = {
  LOG_FILE,
  COMMAND_PURPOSE,
  logCommand,
  getCommandHistory,
  formatHistoryText,
};
