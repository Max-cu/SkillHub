'use client';
import { useEffect,useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { Skill } from '@/lib/types';
import type { Review } from '@/lib/community';
const labels={pending:'待审核',approved:'已通过',rejected:'已驳回',withdrawn:'已撤回'};
export function CommunityControls({skill,version,onChanged}:{skill:Skill;version:string;onChanged:()=>void}) {
  const [reviews,setReviews]=useState<Review[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{let live=true;api<Review[]>('skills/'+skill.id+'/reviews').then(r=>{if(live)setReviews(r);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[skill.id,revision]);
  const current=reviews.find(r=>r.version===version);
  const act=async(withdraw=false)=>{setBusy(true);setError('');try{await api('skills/'+skill.id+'/community',{method:withdraw?'DELETE':'POST',...(withdraw?{}:{body:JSON.stringify({version})})});setConfirm(false);setRevision(v=>v+1);onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="community-controls"><div><strong>社区发布</strong><span>{current?`v${version} · ${labels[current.status]}`:'仅自己可见'}{skill.communityVersion?` · 社区当前 v${skill.communityVersion}`:''}</span>{current?.reason&&<p>审核说明：{current.reason}</p>}</div><div className="community-buttons">
    <button className="secondary-btn" disabled={busy||current?.status==='pending'||current?.status==='approved'} onClick={()=>act()}>{busy&&<Loader2 size={14} className="spin"/>}提交 v{version} 审核</button>
    {(skill.communityVersion||reviews.some(r=>r.status==='pending'))&&<button className="text-btn" disabled={busy} onClick={()=>setConfirm(true)}>撤回社区</button>}
  </div>{confirm&&<div className="inline-confirm"><span>撤回所有社区版本和待审核申请？私有技能保留。</span><button className="text-btn" disabled={busy} onClick={()=>act(true)}>确认撤回</button><button className="text-btn" onClick={()=>setConfirm(false)}>取消</button></div>}{error&&<p className="form-error" role="alert">{error}</p>}</div>;
}
export function ReviewDecision({review,onDone}:{review:Review;onDone:()=>void}) {
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const decide=async(decision:'approve'|'reject')=>{setBusy(true);setError('');try{await api('admin/reviews/'+review.id+'/decision',{method:'POST',body:JSON.stringify({decision,reason})});onDone();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="review-decision"><p>{review.displayName} · 提交版本 v{review.version} · {labels[review.status]}</p>{review.status==='pending'?<><label className="field">审核说明（选填）<textarea aria-label="审核说明" maxLength={1000} rows={2} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/></label><div className="community-buttons"><button className="secondary-btn" disabled={busy} onClick={()=>decide('reject')}>驳回</button><button className="primary-btn" disabled={busy} onClick={()=>decide('approve')}>{busy&&<Loader2 size={14} className="spin"/>}审核通过</button></div></>:review.reason&&<p>{review.reason}</p>}{error&&<p className="form-error" role="alert">{error}</p>}</div>;
}
export default function AdminView({refresh,inspect}:{refresh:number;inspect:(review:Review)=>void}) {
  const [status,setStatus]=useState('pending'),[offset,setOffset]=useState(0),[data,setData]=useState<{items:Review[];total:number;nextOffset:number|null}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{let live=true;setLoading(true);setError('');api<typeof data>('admin/reviews?'+new URLSearchParams({status,offset:String(offset),limit:'20'})).then(v=>{if(live)setData(v);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[status,offset,refresh]);
  return <section className="admin-page"><div className="section-heading"><h2>社区审核</h2><select aria-label="审核状态" value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option><option value="withdrawn">已撤回</option><option value="all">全部记录</option></select></div>{error?<p className="form-error" role="alert">{error}</p>:loading?<p className="muted">正在读取…</p>:data?.items.length?<><table className="review-table"><thead><tr><th>技能</th><th>提交人</th><th>版本</th><th>状态</th><th/></tr></thead><tbody>{data.items.map(r=><tr key={r.id}><td><strong>{r.name}</strong><p>{r.description}</p></td><td>{r.displayName}</td><td>v{r.version}</td><td>{labels[r.status]}</td><td><button className="text-btn" onClick={()=>inspect(r)}>{r.status==='pending'?'查看并审核':'查看记录'}</button></td></tr>)}</tbody></table><div className="board-pagination"><span>{data.total} 条记录</span><div>{offset>0&&<button className="text-btn" onClick={()=>setOffset(Math.max(0,offset-20))}>上一页</button>}{data.nextOffset!==null&&<button className="text-btn" onClick={()=>setOffset(data.nextOffset!)}>下一页</button>}</div></div></>:<p className="muted">暂无审核记录。</p>}</section>;
}
