import { randomUUID } from 'node:crypto';
import { getPool,assertDatabase } from '../db/postgres.mjs';
import { inspectAiArchive,callAi,AiError } from './ai-service.mjs';
const pool=getPool;
const compare=(a,b)=>{const aa=a.split('.').map(Number),bb=b.split('.').map(Number);return aa[0]-bb[0]||aa[1]-bb[1]||aa[2]-bb[2];};
export async function processAiJob(config) {
 await assertDatabase();const token=randomUUID();
 await pool().query("UPDATE ai_jobs SET status='queued',claim_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<now()");
 const claimed=await pool().query(`UPDATE ai_jobs j SET status='running',attempts=attempts+1,claim_token=$1,lease_until=now()+$2*interval '1 second',updated_at=now() WHERE j.id=(SELECT q.id FROM ai_jobs q WHERE q.status='queued' AND q.available_at<=now() AND (q.kind='summary' OR NOT EXISTS(SELECT 1 FROM ai_jobs s WHERE s.kind='summary' AND s.skill_id=q.skill_id AND s.version=q.version AND s.status IN ('queued','running'))) ORDER BY q.created_at,q.kind DESC,q.id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING j.*`,[token,config.timeout+60]);
 const job=claimed.rows[0];if(!job)return false;
 try {
  const version=(await pool().query('SELECT v.*,s.community_blocked,s.community_version,p.digest AS package_digest,p.size,p.files FROM versions v JOIN skills s ON s.id=v.skill_id LEFT JOIN packages p ON p.skill_id=v.skill_id AND p.version=v.version WHERE v.skill_id=$1 AND v.version=$2',[job.skill_id,job.version])).rows[0];
  if(!version)throw new AiError('package_integrity');
  if(job.kind==='review') {
   const review=(await pool().query('SELECT status FROM community_reviews WHERE id=$1',[job.review_id])).rows[0];
   if(!review||review.status!=='pending'||version.community_blocked){await pool().query("UPDATE ai_jobs SET status='cancelled',claim_token=NULL WHERE id=$1 AND claim_token=$2",[job.id,token]);return true;}
   await pool().query("UPDATE community_reviews SET ai_status='running' WHERE id=$1 AND status='pending'",[job.review_id]);
  }else await pool().query("UPDATE versions SET ai_status='running' WHERE skill_id=$1 AND version=$2",[job.skill_id,job.version]);
  let input={version:job.version,metadata:JSON.parse(version.metadata),texts:[{path:'SKILL.md',content:version.markdown}],files:[{path:'SKILL.md',size:version.markdown.length}],complete:version.markdown.length<=60000};
  if(version.package_digest) {
   const chunks=(await pool().query('SELECT content FROM package_chunks WHERE skill_id=$1 AND version=$2 ORDER BY chunk_index',[job.skill_id,job.version])).rows;
   const archive=Buffer.concat(chunks.map(c=>c.content));if(archive.length!==version.size)throw new AiError('package_integrity');
   input={...input,...inspectAiArchive(archive,version.package_digest)};
  }
  let result;if(job.kind==='review'&&!input.complete)result={decision:'manual',reason:'技能包包含无法完整读取的文件或超出自动审核文本范围，请管理员检查完整原包。'};
  else result=await callAi(config,job.kind,input);
  const client=await pool().connect();
  try {
   await client.query('BEGIN');const skill=(await client.query('SELECT community_version,community_blocked FROM skills WHERE id=$1 FOR UPDATE',[job.skill_id])).rows[0];
   const review=job.kind==='review'?(await client.query('SELECT status FROM community_reviews WHERE id=$1 FOR UPDATE',[job.review_id])).rows[0]:null;
   const current=(await client.query('SELECT status,claim_token FROM ai_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
   if(current.status!=='running'||current.claim_token!==token){await client.query('ROLLBACK');return true;}
   if(job.kind==='summary') {
    const published=(await client.query("SELECT 1 FROM community_reviews WHERE skill_id=$1 AND version=$2 AND (status='approved' OR (status='withdrawn' AND (reviewer IS NOT NULL OR decision_source='ai'))) LIMIT 1",[job.skill_id,job.version])).rows.length||skill.community_version===job.version;
    if(!published)await client.query("UPDATE versions SET ai_status='ready',ai_summary=$1,ai_category=$2,ai_tags=$3 WHERE skill_id=$4 AND version=$5",[result.summary,result.category,JSON.stringify(result.tags),job.skill_id,job.version]);
    else await client.query("UPDATE versions SET ai_status='ready' WHERE skill_id=$1 AND version=$2",[job.skill_id,job.version]);
   }else if(review?.status==='pending'&&!skill.community_blocked) {
    if(result.decision==='approve'&&skill.community_version&&compare(job.version,skill.community_version)<0)result={decision:'manual',reason:'社区已存在更新版本，请管理员处理这条旧版本申请。'};
    const status=result.decision==='approve'?'approved':result.decision==='reject'?'rejected':'pending';
    await client.query("UPDATE community_reviews SET status=$1,reason=$2,decision_source=$3,ai_status=$4,ai_model=$5,ai_report=$6,package_digest=$7,reviewed_at=CASE WHEN $1='pending' THEN NULL ELSE now() END WHERE id=$8",[status,result.reason,status==='pending'?'human':'ai',result.decision==='manual'?'manual':'done',config.model,JSON.stringify(result),version.package_digest??version.digest,job.review_id]);
    if(status==='approved')await client.query('UPDATE skills SET community_version=$1 WHERE id=$2',[job.version,job.skill_id]);
   }
   await client.query("UPDATE ai_jobs SET status='done',claim_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[job.id]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }catch(error) {
  const code=error instanceof AiError?error.code:'ai_processing_error',retry=code==='ai_unavailable'&&job.attempts<2;
  const changed=await pool().query("UPDATE ai_jobs SET status=$1,error_code=$2,claim_token=NULL,lease_until=NULL,available_at=now()+interval '15 seconds',updated_at=now() WHERE id=$3 AND claim_token=$4 RETURNING id",[retry?'queued':'error',code,job.id,token]);
  if(changed.rowCount&&!retry) {
   if(job.kind==='summary')await pool().query("UPDATE versions SET ai_status='error' WHERE skill_id=$1 AND version=$2 AND ai_status<>'ready'",[job.skill_id,job.version]);
   else await pool().query("UPDATE community_reviews SET ai_status='error',reason='AI 暂不可用或结果无效，已保留待审核，请管理员处理。' WHERE id=$1 AND status='pending'",[job.review_id]);
  }
  console.warn('SkillHub AI job',code); // Never log model inputs, outputs, headers or URLs.
 }
 return true;
}
