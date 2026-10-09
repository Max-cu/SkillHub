import { getPool,assertDatabase } from '../db/postgres.mjs';
const args=process.argv.slice(2),subject=args[args.indexOf('--subject')+1],role=args[args.indexOf('--role')+1];
if(args.length!==4||!args.includes('--subject')||!args.includes('--role')||!subject||!['user','admin'].includes(role))throw new Error('Usage: node scripts/set-role.mjs --subject EXACT_CAS_ACCOUNT --role admin|user');
const pool=getPool();
try {
 await assertDatabase();
 const result=await pool.query('UPDATE auth_users SET role=$1,updated_at=now() WHERE cas_subject=$2 RETURNING id,role',[role,subject]);
 if(result.rowCount!==1)throw new Error('No matching SkillHub account. The user must log in first; use the exact CAS subject.');
 console.log(JSON.stringify(result.rows[0]));
}finally{await pool.end();}
