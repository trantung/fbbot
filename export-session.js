/**
 * Không bắt buộc — bot dùng profiles/accountA (User Data Dir).
 * Chỉ dùng nếu cần backup cookie .json phụ.
 *
 * Cách chính: node login.js accountA → node pack-profile.js accountA
 */
console.error('Dùng: node login.js accountA  rồi  node pack-profile.js accountA');
process.exit(1);
