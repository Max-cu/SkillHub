import { getPool } from '../db/postgres.mjs';
import { ApiError, compareVersion } from './domain';

export type UserRole='user'|'admin';
export type ReviewStatus='pending'|'approved'|'rejected'|'withdrawn';
export type Review={id:string;skillId:string;version:string;status:ReviewStatus;reason:string;createdAt:string;reviewedAt:string|null;submitter:string;displayName:string;name:string;description:string};
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
    const skill=(await client.query('SELECT community_version FROM skills WHERE id=$1 FOR UPDATE',[found.rows[0].skill_id])).rows[0];
    const review=(await client.query('SELECT * FROM community_reviews WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(review.status!=='pending')throw new ApiError(409,'review_decided','该审核已处理或撤回');
    if(decision==='approve'&&skill.community_version&&compareVersion(review.version,skill.community_version)<0)throw new ApiError(409,'older_version','社区已存在更新版本，不能批准更早版本');
    await client.query('UPDATE community_reviews SET status=$1,reason=$2,reviewer=$3,reviewed_at=now() WHERE id=$4',[decision==='approve'?'approved':'rejected',(reason as string|undefined)?.trim()??'',reviewer,id]);
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
    await client.query('UPDATE skills SET community_version=NULL WHERE id=$1',[skillId]);
    await client.query('COMMIT');return {withdrawn:true};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
