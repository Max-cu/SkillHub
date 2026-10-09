import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const file = new URL('../.env', import.meta.url);
let content = existsSync(file) ? readFileSync(file,'utf8') : '';
const add = (name,value) => { if (!new RegExp(`^${name}=`, 'm').test(content)) content += `\n${name}=${value}\n`; };
add('SKILLHUB_WORKSPACE_ORIGINS', process.argv[2] || 'http://127.0.0.1:3356');
add('SKILLHUB_PORT','3356');
add('SKILLHUB_PG_ADMIN_PASSWORD', randomBytes(32).toString('hex'));
add('SKILLHUB_PG_APP_PASSWORD', randomBytes(32).toString('hex'));
writeFileSync(file,content,{mode:0o600});
if (process.platform !== 'win32') chmodSync(file,0o600);
console.log('SkillHub .env prepared with independent PostgreSQL passwords; credentials are not displayed.');
