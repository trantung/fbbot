require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const {
  runPost,
  runPostBulk,
  syncDriveFolder,
  runPushFromCache,
  listAccountsText,
  loadConfig,
  resolvePostJobs,
} = require('./post-core');
const {
  logCommand,
  getCommandHistory,
  formatHistoryText,
  COMMAND_PURPOSE,
} = require('./command-log');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('Thiếu TELEGRAM_BOT_TOKEN trong .env');
  process.exit(1);
}

const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const bot = new TelegramBot(TOKEN, { polling: true });

function isAllowed(chatId) {
  if (!ALLOWED_CHAT_IDS.length) {
    return true;
  }

  return ALLOWED_CHAT_IDS.includes(String(chatId));
}

function deny(msg) {
  return bot.sendMessage(
    msg.chat.id,
    'Bạn không có quyền dùng bot này. Liên hệ admin để thêm TELEGRAM_ALLOWED_CHAT_IDS.',
  );
}

function userLabel(msg) {
  return msg.from?.username
    ? `@${msg.from.username}`
    : String(msg.from?.id || msg.chat.id);
}

async function runLogged(msg, command, args, purpose, fn) {
  const raw = msg.text;

  logCommand({
    source: 'telegram',
    chatId: msg.chat.id,
    user: userLabel(msg),
    command,
    args,
    purpose,
    raw,
    status: 'started',
  });

  try {
    const result = await fn();
    const resultText = result?.resultText || result?.summary || 'ok';

    logCommand({
      source: 'telegram',
      chatId: msg.chat.id,
      user: userLabel(msg),
      command,
      args,
      purpose,
      raw,
      status: 'completed',
      result: typeof resultText === 'string' ? resultText : JSON.stringify(resultText).slice(0, 200),
    });

    return result;
  } catch (e) {
    logCommand({
      source: 'telegram',
      chatId: msg.chat.id,
      user: userLabel(msg),
      command,
      args,
      purpose,
      raw,
      status: 'failed',
      result: e.message,
    });

    throw e;
  }
}

const HELP_TEXT = `📘 FB AGENT — HƯỚNG DẪN LỆNH

━━━━━━━━━━━━━━━━━━━━
📌 CẤU HÌNH (pages.json)
• Tài khoản: accountA, accountB...
• Mỗi TK có nhiều group FB
• Cookie: cookies/<tài khoản>.json

━━━━━━━━━━━━━━━━━━━━
🔄 QUY TRÌNH NHIỀU BÀI (KHUYÊN DÙNG)

Folder Drive CHA chứa nhiều folder CON.
Mỗi folder CON = 1 Google Doc + nhiều ảnh.

Bước 1 — Tải về server (1 lần/ngày):
/sync <PARENT_FOLDER_ID>
→ Tải hết folder con → cache trên VPS
→ Không đăng Facebook

Bước 2 — Đăng từ cache (không Google):
/push <tài khoản> <PARENT_FOLDER_ID>
→ Đọc file đã tải, đăng lên group

Ví dụ:
/sync 1ABCxyzParent
/push accountE 1ABCxyzParent
/push all 1ABCxyzParent

━━━━━━━━━━━━━━━━━━━━
📋 DANH SÁCH LỆNH

/list
→ Xem tài khoản + tên group + URL

/post history
/history [số_dòng]
→ Xem lịch sử lệnh đã chạy (file logs/commands.jsonl)

━━━━━━━━━━━━━━━━━━━━
🔄 /sync <PARENT_FOLDER_ID>
Ý nghĩa: Tải folder Drive cha về server.
• Quét mọi folder con
• Mỗi con: 1 Doc → content.txt + tải hết ảnh
• Lưu: cache/{ngày}/{PARENT}/{folder_con}/
• Không đăng FB, không tốn lần 2

━━━━━━━━━━━━━━━━━━━━
📤 /push <tài khoản> <PARENT_FOLDER_ID>
Ý nghĩa: Đăng từ cache (đã /sync).
• Không gọi Google Drive/Docs
• Mỗi folder con = 1 bài
• Đăng lên MỌI group của tài khoản

<tài khoản> có thể:
• accountA — 1 TK, mọi group
• accountA:thuenha — 1 group cụ thể
• accountA,accountB — nhiều TK
• all — mọi TK trong pages.json

━━━━━━━━━━━━━━━━━━━━
📤 /post <tài khoản> <DOC_ID> <FOLDER_ID>
Ý nghĩa: Đăng 1 bài (cần Google).
• DOC_ID: ID Google Doc
• FOLDER_ID: folder ảnh trên Drive
• Dùng khi chỉ đăng 1 bài lẻ

━━━━━━━━━━━━━━━━━━━━
📦 /bulk <tài khoản> <PARENT_FOLDER_ID>
Ý nghĩa: Nhiều bài — tải Google + đăng luôn.
• Gộp /sync + /push trong 1 lệnh
• Lần 2 cùng ngày dùng cache, nhanh hơn

━━━━━━━━━━━━━━━━━━━━
💡 GHI CHÚ

• Sang ngày mới → /sync lại (hoặc CACHE_REFRESH=true)
• accountA = mọi group của A trong pages.json
• Lỗi đăng nhập → node login.js accountA

❓ /help — xem lại bảng này`;

bot.onText(/\/start/, async (msg) => {
  if (!isAllowed(msg.chat.id)) {
    return deny(msg);
  }

  logCommand({
    chatId: msg.chat.id,
    user: userLabel(msg),
    command: 'start',
    raw: msg.text,
    status: 'completed',
  });

  await bot.sendMessage(msg.chat.id, 'Chào! Bot đăng bài Facebook group.\n\n' + HELP_TEXT);
});

bot.onText(/\/help/, async (msg) => {
  if (!isAllowed(msg.chat.id)) {
    return deny(msg);
  }

  logCommand({
    chatId: msg.chat.id,
    user: userLabel(msg),
    command: 'help',
    raw: msg.text,
    status: 'completed',
  });

  await bot.sendMessage(msg.chat.id, HELP_TEXT);
});

bot.onText(/\/post(?:@\w+)?\s+history(?:\s+(\d+))?/i, async (msg, match) => {
  if (!isAllowed(msg.chat.id)) {
    return deny(msg);
  }

  const limit = parseInt(match[1] || '15', 10);
  const history = getCommandHistory(limit);

  logCommand({
    chatId: msg.chat.id,
    user: userLabel(msg),
    command: 'history',
    args: match[1] ? [String(limit)] : [],
    purpose: COMMAND_PURPOSE.history,
    raw: msg.text,
    status: 'completed',
    result: `${history.length} mục`,
  });

  await bot.sendMessage(msg.chat.id, `📜 Lịch sử lệnh (${history.length}):\n\n${formatHistoryText(history)}`);
});

bot.onText(/\/history(?:\s+(\d+))?/i, async (msg, match) => {
  if (!isAllowed(msg.chat.id)) {
    return deny(msg);
  }

  const limit = parseInt(match[1] || '15', 10);
  const history = getCommandHistory(limit);

  await bot.sendMessage(msg.chat.id, `📜 Lịch sử lệnh (${history.length}):\n\n${formatHistoryText(history)}`);
});

bot.onText(/\/list/, async (msg) => {
  if (!isAllowed(msg.chat.id)) {
    return deny(msg);
  }

  try {
    await runLogged(msg, 'list', [], COMMAND_PURPOSE.list, async () => {
      await bot.sendMessage(msg.chat.id, listAccountsText(loadConfig()));

      return { resultText: 'ok' };
    });
  } catch (e) {
    await bot.sendMessage(msg.chat.id, e.message);
  }
});

bot.onText(/\/sync(?:@\w+)?\s+(\S+)/, async (msg, match) => {
  if (!isAllowed(msg.chat.id)) {
    return deny(msg);
  }

  const parentFolderId = match[1];

  try {
    await bot.sendMessage(
      msg.chat.id,
      `🔄 Sync Drive → server\nFolder: ${parentFolderId}\n⏳ Đang tải...`,
    );

    const result = await runLogged(
      msg,
      'sync',
      [parentFolderId],
      COMMAND_PURPOSE.sync,
      () => syncDriveFolder(parentFolderId),
    );

    const lines = result.details.map(
      (d, i) =>
        `${i + 1}. ${d.name} — ${d.fromCache ? 'cache' : 'tải mới'} (${d.images} ảnh)`,
    );

    await bot.sendMessage(
      msg.chat.id,
      `✅ Sync xong ${result.total} bài\n` +
        `📁 cache/${result.dateKey}/${result.parentId}/\n` +
        `Tải mới: ${result.downloaded} | Đã có: ${result.cached}\n\n` +
        lines.join('\n') +
        `\n\nTiếp theo: /push accountA ${parentFolderId}`,
    );
  } catch (e) {
    console.error(e);
    await bot.sendMessage(msg.chat.id, `❌ Lỗi: ${e.message}`);
  }
});

bot.onText(/\/push(?:@\w+)?\s+(\S+)\s+(\S+)/, async (msg, match) => {
  if (!isAllowed(msg.chat.id)) {
    return deny(msg);
  }

  const target = match[1];
  const parentFolderId = match[2];

  try {
    const jobs = resolvePostJobs(target, loadConfig());
    const totalGroups = jobs.reduce((n, j) => n + j.groups.length, 0);

    await bot.sendMessage(
      msg.chat.id,
      `📤 Push từ cache (không Google)\n` +
        `${target} → ${jobs.length} TK, ${totalGroups} group/bài\n⏳ Đang đăng...`,
    );

    const { summary, failed, postCount, dateKey } = await runLogged(
      msg,
      'push',
      [target, parentFolderId],
      COMMAND_PURPOSE.push,
      () => runPushFromCache(target, parentFolderId),
    );

    for (const r of summary) {
      const label = `[${r.post}] ${r.profile}/${r.name}`;

      if (r.ok) {
        await bot.sendMessage(msg.chat.id, `✅ ${label}`);
      } else {
        await bot.sendMessage(msg.chat.id, `❌ ${label}\n${r.error}`);
      }
    }

    await bot.sendMessage(
      msg.chat.id,
      `🏁 Push xong: ${summary.length - failed}/${summary.length} (${postCount} bài, ngày ${dateKey})`,
    );
  } catch (e) {
    console.error(e);
    await bot.sendMessage(msg.chat.id, `❌ Lỗi: ${e.message}`);
  }
});

bot.onText(/\/bulk(?:@\w+)?\s+(\S+)\s+(\S+)/, async (msg, match) => {
  if (!isAllowed(msg.chat.id)) {
    return deny(msg);
  }

  const target = match[1];
  const parentFolderId = match[2];

  try {
    const jobs = resolvePostJobs(target, loadConfig());
    const totalGroups = jobs.reduce((n, j) => n + j.groups.length, 0);

    await bot.sendMessage(
      msg.chat.id,
      `📦 Bulk (sync + đăng)\n${jobs.length} TK, ${totalGroups} group/bài\n⏳ Đang chạy...`,
    );

    const { summary, failed, postCount, cacheHits } = await runLogged(
      msg,
      'bulk',
      [target, parentFolderId],
      COMMAND_PURPOSE.bulk,
      () => runPostBulk(target, parentFolderId),
    );

    for (const r of summary) {
      const label = `[${r.post}] ${r.profile}/${r.name}`;

      if (r.ok) {
        await bot.sendMessage(msg.chat.id, `✅ ${label}`);
      } else {
        await bot.sendMessage(msg.chat.id, `❌ ${label}\n${r.error}`);
      }
    }

    await bot.sendMessage(
      msg.chat.id,
      `🏁 Bulk xong: ${summary.length - failed}/${summary.length} (${postCount} bài, cache ${cacheHits}/${postCount})`,
    );
  } catch (e) {
    console.error(e);
    await bot.sendMessage(msg.chat.id, `❌ Lỗi: ${e.message}`);
  }
});

bot.onText(/\/post(?:@\w+)?\s+(\S+)\s+(\S+)\s+(\S+)/, async (msg, match) => {
  if (!isAllowed(msg.chat.id)) {
    return deny(msg);
  }

  const target = match[1];
  const docId = match[2];
  const folderId = match[3];

  if (target.toLowerCase() === 'history') {
    return;
  }

  try {
    const jobs = resolvePostJobs(target, loadConfig());
    const totalGroups = jobs.reduce((n, j) => n + j.groups.length, 0);

    await bot.sendMessage(
      msg.chat.id,
      `🚀 Post 1 bài\n${jobs.length} TK, ${totalGroups} group\n⏳ Đang chạy...`,
    );

    const { summary, failed } = await runLogged(
      msg,
      'post',
      [target, docId, folderId],
      COMMAND_PURPOSE.post,
      () => runPost(target, docId, folderId),
    );

    for (const r of summary) {
      const label = `${r.profile}/${r.name}`;

      if (r.ok) {
        await bot.sendMessage(msg.chat.id, `✅ ${label}`);
      } else {
        await bot.sendMessage(msg.chat.id, `❌ ${label}\n${r.error}`);
      }
    }

    await bot.sendMessage(
      msg.chat.id,
      `🏁 Hoàn tất: ${summary.length - failed}/${summary.length} thành công`,
    );
  } catch (e) {
    console.error(e);
    await bot.sendMessage(msg.chat.id, `❌ Lỗi: ${e.message}`);
  }
});

bot.on('message', async (msg) => {
  if (!msg.text || !msg.text.startsWith('/')) {
    return;
  }

  if (!isAllowed(msg.chat.id)) {
    return deny(msg);
  }

  if (/^\/(start|help|list|post|bulk|sync|push|history)/i.test(msg.text)) {
    return;
  }

  await bot.sendMessage(msg.chat.id, 'Lệnh không hợp lệ. Gõ /help');
});

console.log('Bot Telegram đang chạy');
console.log('Lịch sử lệnh: logs/commands.jsonl');

if (ALLOWED_CHAT_IDS.length) {
  console.log('Chat được phép:', ALLOWED_CHAT_IDS.join(', '));
}
