import { getPool } from '../db/postgres.mjs';
import { ApiError, compareVersion } from './domain';

export type UserRole='user'|'admin';
export type ReviewStatus='pending'|'approved'|'rejected'|'withdrawn';
export type Review={id:string;skillId:string;version:string;status:ReviewStatus;reason:string;createdAt:string;reviewedAt:string|null;submitter:string;displayName:string;name:string;description:string;decisionSource:'human'|'ai';aiStatus:string;aiModel:string|null};
export function requireAdmin(role:UserRole) {if(role!=='admin')throw new ApiError(403,'admin_required','此操作仅限管理员');}

export async function decideReview(id:string,reviewer:string,decision:unknown,reason:unknown) {
  if(decision!=='approve'&&decision!=='reject')throw new ApiError(400,'invalid_decision','decision 为 approve 或 reject');
  if(reason!==undefined&&(typeof reason!=='string'||reason.length>1000))throw new ApiError(400,'invalid_reason','审核说明最多 1000 字符');
  const client=await getPool().connect();
  try {
    await client.query('BEGIN');
    // Lock the skill before its review: approval and withdrawal share one lock order.
    const found=await client.query('SELECT skill_id FROM community_reviews WHERE id=$1',[id]);
    if(!found.rows[0])throw new ApiError(404,'review_not_found','审核记录不存在');
    const skill=(await client.query('SELECT community_version,community_blocked FROM skills WHERE id=$1 FOR UPDATE',[found.rows[0].skill_id])).rows[0];
    const review=(await client.query('SELECT * FROM community_reviews WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(review.status!=='pending')throw new ApiError(409,'review_decided','该审核已处理或撤回');
    if(decision==='approve'&&skill.community_blocked)throw new ApiError(409,'community_blocked','请先解除该技能的下架限制');
    if(decision==='approve'&&skill.community_version&&compareVersion(review.version,skill.community_version)<0)throw new ApiError(409,'older_version','社区已存在更新版本，不能批准更早版本');
    await client.query("UPDATE community_reviews SET status=$1,reason=$2,reviewer=$3,reviewed_at=now(),decision_source='human',ai_status=CASE WHEN ai_status IN ('queued','running') THEN 'cancelled' ELSE ai_status END WHERE id=$4",[decision==='approve'?'approved':'rejected',(reason as string|undefined)?.trim()??'',reviewer,id]);
    await client.query("UPDATE ai_jobs SET status='cancelled',claim_token=NULL WHERE review_id=$1 AND status IN ('queued','running')",[id]);
    if(decision==='approve')await client.query('UPDATE skills SET community_version=$1 WHERE id=$2',[review.version,review.skill_id]);
    await client.query('COMMIT');return {id,status:decision==='approve'?'approved':'rejected',version:review.version};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function withdrawCommunity(skillId:string,owner:string) {
  const client=await getPool().connect();
  try {
    await client.query('BEGIN');
    const row=await client.query('SELECT id FROM skills WHERE id=$1 AND owner=$2 FOR UPDATE',[skillId,owner]);
    if(!row.rows.length)throw new ApiError(404,'skill_not_found','技能不存在');
    await client.query("UPDATE community_reviews SET status='withdrawn',reviewed_at=now() WHERE skill_id=$1 AND status IN ('pending','approved')",[skillId]);
    await client.query("UPDATE ai_jobs SET status='cancelled',claim_token=NULL WHERE skill_id=$1 AND kind='review' AND status IN ('queued','running')",[skillId]);
    await client.query('UPDATE skills SET community_version=NULL WHERE id=$1',[skillId]);
    await client.query('COMMIT');return {withdrawn:true};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function moderateCommunity(skillId:string,actor:string,action:'remove'|'unblock',reason:unknown) {
 if(reason!==undefined&&(typeof reason!=='string'||reason.length>1000))throw new ApiError(400,'invalid_reason','下架说明最多 1000 字符');
 const text=(reason as string|undefined)?.trim()||(action==='remove'?'管理员下架不合规社区内容':'管理员解除下架限制'),client=await getPool().connect();
 try {
  await client.query('BEGIN');const row=(await client.query('SELECT s.id FROM skills s WHERE s.id=$1 AND (s.community_version IS NOT NULL OR s.community_blocked OR EXISTS(SELECT 1 FROM community_reviews r WHERE r.skill_id=s.id)) FOR UPDATE',[skillId])).rows[0];if(!row)throw new ApiError(404,'skill_not_found','技能不存在');
  if(action==='remove') {
   await client.query("UPDATE community_reviews SET status='withdrawn',reviewed_at=now() WHERE skill_id=$1 AND status IN ('pending','approved')",[skillId]);
   await client.query("UPDATE ai_jobs SET status='cancelled',claim_token=NULL WHERE skill_id=$1 AND kind='review' AND status IN ('queued','running')",[skillId]);
   await client.query('UPDATE skills SET community_version=NULL,community_blocked=true,moderation_reason=$1 WHERE id=$2',[text,skillId]);
  }else await client.query("UPDATE skills SET community_blocked=false,moderation_reason='' WHERE id=$1",[skillId]);
  await client.query('INSERT INTO community_moderation(id,skill_id,actor,action,reason) VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),skillId,actor,action,text]);
  await client.query('COMMIT');return {removed:action==='remove',blocked:action==='remove'};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function retryAi(skillId:string,owner:string,version:string,reviewId?:string) {
 const client=await getPool().connect();
 try {
  await client.query('BEGIN');const skill=(await client.query('SELECT community_blocked,community_version FROM skills WHERE id=$1 AND owner=$2 FOR UPDATE',[skillId,owner])).rows[0];
  if(!skill)throw new ApiError(404,'skill_not_found','技能不存在');
  const stored=(await client.query('SELECT ai_status FROM versions WHERE skill_id=$1 AND version=$2 FOR UPDATE',[skillId,version])).rows[0];if(!stored)throw new ApiError(404,'version_not_found','版本不存在');
  if(!reviewId&&(skill.community_version===version||(await client.query("SELECT 1 FROM community_reviews WHERE skill_id=$1 AND version=$2 AND (status='approved' OR (status='withdrawn' AND (reviewer IS NOT NULL OR decision_source='ai')))",[skillId,version])).rows.length))throw new ApiError(409,'version_frozen','已通过的展示内容保持不变，请上传新版本');
  if(reviewId) {
   if(skill.community_blocked)throw new ApiError(403,'community_blocked','请管理员先解除下架限制');
   const review=(await client.query('SELECT status,ai_status FROM community_reviews WHERE id=$1 AND skill_id=$2 AND version=$3 FOR UPDATE',[reviewId,skillId,version])).rows[0];
   if(!review)throw new ApiError(404,'review_not_found','审核记录不存在');
   if(review.status!=='pending'||['queued','running'].includes(review.ai_status))throw new ApiError(409,'review_busy','审核已处理或正在运行');
   await client.query("INSERT INTO ai_jobs(id,kind,skill_id,version,review_id) VALUES($1,'review',$2,$3,$4) ON CONFLICT(review_id) WHERE kind='review' DO UPDATE SET status='queued',attempts=0,claim_token=NULL,lease_until=NULL,error_code='',available_at=now()",[crypto.randomUUID(),skillId,version,reviewId]);
   await client.query("UPDATE community_reviews SET ai_status='queued',reason='' WHERE id=$1",[reviewId]);
  }
  if(stored.ai_status!=='ready') {
   if(!reviewId&&['queued','running'].includes(stored.ai_status))throw new ApiError(409,'ai_busy','AI 正在整理该版本');
   await client.query("INSERT INTO ai_jobs(id,kind,skill_id,version) VALUES($1,'summary',$2,$3) ON CONFLICT(skill_id,version) WHERE kind='summary' DO UPDATE SET status='queued',attempts=0,claim_token=NULL,lease_until=NULL,error_code='',available_at=now() WHERE ai_jobs.status NOT IN ('queued','running')",[crypto.randomUUID(),skillId,version]);
   await client.query("UPDATE versions SET ai_status='queued' WHERE skill_id=$1 AND version=$2 AND ai_status NOT IN ('queued','running')",[skillId,version]);
  }else if(!reviewId)throw new ApiError(409,'ai_ready','该版本已完成 AI 整理');
  await client.query('COMMIT');return {queued:true};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
