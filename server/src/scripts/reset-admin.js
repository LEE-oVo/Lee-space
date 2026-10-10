import { randomBytes } from 'node:crypto';
import { getDb } from '../db/index.js';
import { createUser, getUserByUsername, setUserRoles, listUsers, updatePassword, revokeAllSessions } from '../db/repo.js';
import { hashPassword } from '../lib/password.js';

const db = getDb();

const args = process.argv.slice(2);
const force = args.includes('--force');
const username = args.find((a) => !a.startsWith('--')) || 'admin';
const exist = getUserByUsername(username);

if (exist && !force) {
  setUserRoles(exist.id, ['admin']);
  console.log(`用户 ${username} 已存在，已确保拥有 admin 角色。（加 --force 可重置密码）`);
  process.exit(0);
}

const password = randomBytes(12).toString('base64url').slice(0, 12) + 'Aa1';

if (exist) {
  updatePassword(exist.id, hashPassword(password));
  setUserRoles(exist.id, ['admin']);
  revokeAllSessions(exist.id);
  console.log(`用户 ${username} 的密码已重置。`);
} else {
  const id = createUser({
    username,
    passwordHash: hashPassword(password),
    displayName: '工作台管理员',
    email: null,
    avatarColor: '#7F77DD',
  });
  setUserRoles(id, ['admin']);
}

console.log('=========================================');
console.log(' 管理员账号');
console.log('-----------------------------------------');
console.log(` 用户名: ${username}`);
console.log(` 密码  : ${password}`);
console.log('-----------------------------------------');
console.log(' 请立即登录后修改密码，此密码不会再次显示。');
console.log('=========================================');
console.log(`当前用户数: ${listUsers().length}`);
db.close();
