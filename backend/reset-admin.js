import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function hashVal(plain) {
  return 'sha256:' + crypto.createHash('sha256').update(String(plain).trim()).digest('hex');
}

const USERS_FILE = path.join(process.cwd(), 'users.json');

const newPass = process.argv[2] ? String(process.argv[2]).trim() : 'admin123';
const newAnswer = process.argv[3] ? String(process.argv[3]).trim().toLowerCase() : '1234';

if (newPass.length < 6) {
  console.log('⚠️ Error: Password must be at least 6 characters long!');
  process.exit(1);
}

let users = [];
try {
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  }
} catch (e) {
  users = [];
}

let admin = users.find(u => (u.username || '').toLowerCase() === 'admin');
if (!admin) {
  admin = {
    id: 'admin',
    username: 'admin',
    role: 'admin',
    active: true,
    max_accounts: 9999,
    max_targets: 9999,
    registered_phones: [],
    ai_enabled: true
  };
  users.unshift(admin);
}

admin.password = hashVal(newPass);
admin.security_question = 'What is your secret pin?';
admin.security_answer = hashVal(newAnswer);

fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');

console.log('\n=============================================');
console.log('✅ ADMIN PASSWORD SUCCESSFULLY RESET!');
console.log('=============================================');
console.log('👤 Username          : admin');
console.log('🔑 New Password      : ' + newPass);
console.log('❓ Security Question : ' + admin.security_question);
console.log('💡 Security Answer   : ' + newAnswer);
console.log('=============================================\n');
