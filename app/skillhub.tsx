'use client';

import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Bookmark, Bot, Check, CircleHelp, Code2, Command, Copy, FileCode2, GitBranch, Layers3, LayoutDashboard, Loader2, LockKeyhole, Plus, Terminal, Trash2, X, Zap, FlaskConical, Palette, Search, Sparkles } from 'lucide-react';
import Modal from './modal';
import Markdown from './markdown';
import MessageBoard from './message-board';
import AdminView,{CardCommunityButton,CommunityControls,CommunityModeration,ReviewDecision} from './community-controls';
import type { Review } from '@/lib/community';
import { api } from '@/lib/client-api';
import { MAX_ZIP_BYTES } from '@/lib/package-limits.mjs';
import { AGENT_SKILL_ID, AGENTS, CATEGORIES, type Agent, type AgentSkillRef, type AgentStatus, type Category, type HubAgent, type Skill, type PackageMetadata } from '@/lib/types';

gsap.registerPlugin(useGSAP);
type View = 'discover' | 'agents' | 'favorites' | 'board' | 'api' | 'research' | 'admin';
type Summary = Omit<Skill, 'markdown'>;
type Meta = { workspace?:'local'|'shared'|'cas'|null;loginConfigured?:boolean;aiEnabled?:boolean;skillCount:number;sourceCount:number;favoriteCount:number;user:{id:string;displayName?:string;email?:string;scope:string;role:'user'|'admin'}|null };
const categoryLabels: Record<Category|'auto',string> = { auto:'AI 分类中', development:'开发工程', design:'设计创意', productivity:'效率工具', testing:'测试与调试', documentation:'文档写作' };
const categoryIcons: Record<Category|'auto',typeof Code2> = { auto:Sparkles, development:Code2, design:Palette, productivity:Zap, testing:FlaskConical, documentation:BookOpen };
const agentLabels: Record<Agent,string> = { 'claude-code':'Claude Code',codex:'Codex',cursor:'Cursor','gemini-cli':'Gemini CLI' };

function SupportLogo() { return <span className="support-logo"><img src="/skillgo-logo.png" alt="" width="1280" height="1280" /></span>; }
function SkillIcon({skill}:{skill:Summary}) { const Icon = categoryIcons[skill.category]; return <span className={`skill-icon ${skill.category}`}><Icon size={23} strokeWidth={1.7}/></span>; }
export default function SkillHub() {
  const root=useRef<HTMLDivElement>(null),searchRef=useRef<HTMLInputElement>(null);
  const [view,setView]=useState<View>('discover'),[category,setCategory]=useState(''),[query,setQuery]=useState(''),[debounced,setDebounced]=useState('');
  const [meta,setMeta]=useState<Meta|null>(null),[skills,setSkills]=useState<Summary[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[moreLoading,setMoreLoading]=useState(false);
  const [selected,setSelected]=useState<Skill|null>(null),[modal,setModal]=useState<'publish'|null>(null),[toast,setToast]=useState('');
  const [library,setLibrary]=useState<'mine'|'community'>('mine'),[reviewContext,setReviewContext]=useState<Review|null>(null);
  const notify=(message:string)=>setToast(message), reload=()=>setRefresh(v=>v+1);
  useEffect(()=>{const t=setTimeout(()=>setDebounced(query),250);return()=>clearTimeout(t);},[query]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(t);},[toast]);
  useEffect(()=>{const listener=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();searchRef.current?.focus();}};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);},[]);
  useEffect(()=>{let current=true;api<Meta>('meta').then(v=>{if(current)setMeta(v);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[refresh]);
  const params=()=>new URLSearchParams({q:debounced,scope:view==='favorites'?'all':library,...(category?{category}:{}),...(view==='favorites'?{favorites:'true'}:{})});
  const lastQueryKey=useRef('');
  useEffect(()=>{
    if(!['discover','favorites'].includes(view))return;
    if(view==='favorites'&&meta&&!meta.user){setSkills([]);setTotal(0);setLoading(false);return;}
    const key=[debounced,category,view,library,meta?.user?.id??''].join('|');
    const silent=lastQueryKey.current===key;lastQueryKey.current=key;
    let current=true;if(!silent)setLoading(true);setError('');
    api<{items:Summary[];total:number}>('skills?'+params()).then(v=>{if(current){setSkills(v.items);setTotal(v.total);}}).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};
  // The query is rebuilt from exactly these values.
  },[debounced,category,view,library,refresh,meta?.user?.id]);
  // Polling keeps one stable interval: only the boolean activity flag is a dependency, so silent refreshes never retrigger animations.
  const aiActive=skills.some(s=>['queued','running'].includes(s.aiStatus)||s.reviewStatus==='pending');
  useEffect(()=>{
    if(!['discover','favorites'].includes(view)||!aiActive)return;
    let live=true;const timer=setInterval(()=>{api<{items:Summary[];total:number}>('skills?'+params()).then(r=>{if(live){setSkills(r.items);setTotal(r.total);}}).catch(()=>{});},5000);
    return()=>{live=false;clearInterval(timer);};
  },[view,aiActive,debounced,category,library]);
  useGSAP(()=>{
    const mm=gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)',()=>{
      const targets=root.current?.querySelectorAll('.site-header, .hero-copy');
      if(targets?.length) gsap.from(targets,{y:12,autoAlpha:0,duration:.6,stagger:.1,ease:'power3.out',clearProps:'transform,opacity,visibility'});
    });
    return()=>mm.revert();
  },{scope:root});
  // Entrance animations run only for cards not yet seen in the current list context; polling refreshes never replay them.
  const animatedCards=useRef<Set<string>>(new Set()),cardContext=useRef('');
  const listContext=view+'|'+library+'|'+category+'|'+debounced;
  if(cardContext.current!==listContext){cardContext.current=listContext;animatedCards.current.clear();}
  useGSAP(()=>{
    if(loading||(view!=='discover'&&view!=='favorites'))return;
    const mm=gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)',()=>{
      const cards=[...(root.current?.querySelectorAll<HTMLElement>('.skill-card')??[])];
      const fresh=cards.filter(card=>!animatedCards.current.has(card.dataset.skillId??''));
      for(const card of fresh)animatedCards.current.add(card.dataset.skillId??'');
      if(fresh.length)gsap.from(fresh,{y:14,autoAlpha:0,stagger:.06,duration:.55,ease:'power3.out',clearProps:'transform,opacity,visibility'});
      const empty=root.current?.querySelector('.empty-state');
      if(empty)gsap.from(empty,{y:14,autoAlpha:0,duration:.5,ease:'power3.out',clearProps:'transform,opacity,visibility'});
    });
    return()=>mm.revert();
  },{scope:root,dependencies:[loading,skills,view],revertOnUpdate:true});
  const navigate=(next:View)=>{window.scrollTo({top:0,behavior:'instant'});setView(next);setCategory('');setQuery('');setSelected(null);setReviewContext(null);};
  const toastRef=useRef<HTMLDivElement>(null);
  useGSAP(()=>{if(!toast)return;const mm=gsap.matchMedia();mm.add('(prefers-reduced-motion: no-preference)',()=>gsap.from(toastRef.current,{y:14,autoAlpha:0,duration:.4,ease:'power3.out',clearProps:'transform,opacity,visibility'}));return()=>mm.revert();},{dependencies:[toast]});
  const signedIn=()=>{if(meta?.user)return true;notify('正在确认登录身份，请稍后重试');return false;};
  const favorite=async(skill:Summary)=>{
    if(!signedIn())return;
    const next=!skill.favorite;
    // Optimistic local update: never trigger a list reload (which flashes skeleton + replays cards).
    setSkills(prev=>view==='favorites'&&!next?prev.filter(s=>s.id!==skill.id):prev.map(s=>s.id===skill.id?{...s,favorite:next,favoriteCount:s.favoriteCount+(next?1:-1)}:s));
    if(view==='favorites'&&!next)setTotal(t=>Math.max(0,t-1));
    if(selected?.id===skill.id)setSelected({...selected,favorite:next});
    try{await api('skills/'+skill.id+'/favorite',{method:next?'PUT':'DELETE'});notify(next?'已加入收藏，可在顶部「收藏」查看':'已移出收藏');}
    catch(e){setSkills(prev=>view==='favorites'&&!next?[skill,...prev]:prev.map(s=>s.id===skill.id?{...s,favorite:!next,favoriteCount:s.favoriteCount+(next?-1:1)}:s));if(selected?.id===skill.id)setSelected({...selected,favorite:!next});notify((e as Error).message);}
  };
  const inspect=async(skill:Summary)=>{try{setReviewContext(null);setSelected(await api<Skill>('skills/'+skill.id+'?version='+skill.version));}catch(e){notify((e as Error).message);}};
  const inspectReview=async(review:Review)=>{try{setSelected(await api<Skill>('admin/reviews/'+review.id+'/skill'));setReviewContext(review);}catch(e){notify((e as Error).message);}};
  const refreshSelected=async()=>{reload();try{if(selected&&!reviewContext)setSelected(await api<Skill>('skills/'+selected.id));}catch(e){notify((e as Error).message);}};
  const copy=async(text:string)=>{try{await navigator.clipboard.writeText(text);notify('已复制到剪贴板');}catch{notify('无法访问剪贴板，请手动复制');}};
  const logout=async()=>{try{const r=await api<{logoutUrl:string}>('auth/logout',{method:'POST'});window.localStorage.setItem('skillhub-auth-change',String(Date.now()));window.location.assign(r.logoutUrl);}catch(e){notify((e as Error).message);}};
  const loadMore=async()=>{setMoreLoading(true);try{const p=params();p.set('offset',String(skills.length));const r=await api<{items:Summary[]}>('skills?'+p);setSkills(prev=>[...prev,...r.items]);}catch(e){notify((e as Error).message);}finally{setMoreLoading(false);}};

  return <div className="app-shell" ref={root}>
    <header className="site-header">
      <div className="header-inner">
        <button className="brand" onClick={()=>navigate('discover')} aria-label="SkillHub 首页"><img className="company-logo" src="/tianchen-logo.png" alt="中国化学 · 天辰公司 CNCEC TIANCHEN" width="1074" height="359" /></button>
        <nav className="main-nav" aria-label="主导航">
          <button className={view==='discover'?'active':''} onClick={()=>navigate('discover')}>发现</button>
          <button className={view==='agents'?'active':''} onClick={()=>navigate('agents')}>AgentHub</button>
          <button className={view==='favorites'?'active':''} onClick={()=>navigate('favorites')}>收藏</button>
          <button className={view==='board'?'active':''} onClick={()=>navigate('board')}>留言板</button>
          <button className={view==='api'?'active':''} onClick={()=>navigate('api')}>开发者 API</button>
          {meta?.user?.role==='admin'&&<button className={view==='admin'?'active':''} onClick={()=>navigate('admin')}>管理</button>}
        </nav>
        <div className="header-actions">
          <button className="text-btn" onClick={()=>{if(signedIn())setModal('publish');}}>上传技能 <Plus size={15}/></button>
          <div className="account-actions"><span title={meta?.user?.displayName}>{meta?.user?.displayName??'…'}</span>{meta?.loginConfigured&&<button className="login-link" onClick={logout}>退出 <ArrowRight size={14}/></button>}</div>
        </div>
      </div>
    </header>
    <div className="main-shell"><main className="main-content">
      {['discover','favorites'].includes(view)?<>
        <section className="hero"><div className="hero-copy"><h1>{view==='discover'?<>Find what you need.<br/><span>Or just look around.</span></>:'Your favorites. All in one place.'}</h1></div></section>

        <section className="catalog-section">
          <div className="section-heading">{view==='favorites'?<h2>我的收藏 <span>{total}</span></h2>:<div className="library-switch" aria-label="技能库范围"><button className={library==='mine'?'active':''} onClick={()=>setLibrary('mine')}>我的技能</button><button className={library==='community'?'active':''} onClick={()=>setLibrary('community')}>社区</button><span>{total}</span></div>}</div>
          <div className="catalog-controls"><div className="search-box"><Search size={18}/><input ref={searchRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索技能、标签或任务" aria-label="搜索技能"/>{query?<button className="icon-btn" onClick={()=>setQuery('')} aria-label="清空搜索"><X size={14}/></button>:<kbd><Command size={11}/> K</kbd>}</div></div>

          <div className="category-tabs" aria-label="分类筛选"><button className={!category?'active':''} onClick={()=>setCategory('')}>全部技能</button>{CATEGORIES.map(c=><button key={c} className={category===c?'active':''} onClick={()=>setCategory(c)}>{categoryLabels[c]}</button>)}</div>
          {error?<div className="empty-state"><CircleHelp size={28}/><h3>暂时无法加载</h3><p>{error}</p><button className="secondary-btn" onClick={reload}>重试</button></div>:loading?<div className="skill-grid">{[0,1,2,3,4,5].map(i=><div className="skeleton-card" key={i}><div/><span/><span/><span/></div>)}</div>:skills.length?<><div className="skill-grid">{skills.map(skill=><article className="skill-card" key={skill.id} data-skill-id={skill.id}><div className="card-top"><SkillIcon skill={skill}/><div className="card-badges"><button className={`icon-btn bookmark-btn ${skill.favorite?'saved':''}`} onClick={()=>favorite(skill)} aria-label={skill.favorite?'取消收藏 '+skill.name:'收藏 '+skill.name}><Bookmark size={17} fill={skill.favorite?'currentColor':'none'}/></button></div></div><button className="card-content" onClick={()=>inspect(skill)}><h3>{skill.name}<ArrowUpRight size={15}/></h3><span className="card-author">{skill.source?skill.source.replace('https://github.com/','').split('/')[0]:skill.owner===meta?.user?.id?'我的技能':'社区发布'}{['queued','running'].includes(skill.aiStatus)&&' · AI 整理中'}<span className="author-dot">·</span>v{skill.version}</span><p>{skill.description}</p></button><div className="card-tags">{skill.tags.slice(0,3).map(t=><button key={t} onClick={()=>setQuery(t)}>{t}</button>)}</div><div className="card-footer"><span className="card-compatibility">{categoryLabels[skill.category]}</span><div className="card-actions">{skill.owner===meta?.user?.id&&<CardCommunityButton skill={skill} notify={notify} onSubmitted={reload}/>}<a className="card-download" href={`/api/v1/skills/${skill.id}/download?version=${skill.version}`} aria-label={'下载 '+skill.name+' ZIP'}><ArrowDownToLine size={14}/>下载</a></div></div></article>)}</div>{skills.length<total&&<button className="secondary-btn load-more" disabled={moreLoading} onClick={loadMore}>{moreLoading?<Loader2 className="spin" size={15}/>:<Plus size={15}/>}加载更多</button>}</>: <div className="empty-state">{view==='favorites'?<Bookmark size={30}/>:<Search size={30}/>}<h3>{view==='favorites'?(!meta?.user?'登录，建立你的技能收藏':'还没有收藏的技能'):'还没有找到匹配的技能'}</h3><p>{view==='favorites'?(!meta?.user?'收藏会保存在你的工作空间中。':'在「发现」里点卡片右上角的星标，把常用技能收进这里。'):'换个关键词，或调整分类。'}</p>{view==='favorites'?!meta?.user?<a className="primary-btn" href="/api/v1/auth/login">登录</a>:<button className="primary-btn" onClick={()=>navigate('discover')}>去发现</button>:<button className="secondary-btn" onClick={()=>{setQuery('');setCategory('');}}>清空筛选</button>}</div>}
        </section>
      </>:view==='agents'?<AgentHub notify={notify}/>:view==='board'?<MessageBoard notify={notify} isAdmin={meta?.user?.role==='admin'}/>:view==='api'?<ApiView meta={meta} notify={notify} copy={copy}/>:view==='admin'&&meta?.user?.role==='admin'?<AdminView refresh={refresh} inspect={inspectReview}/>:<ResearchView/>}
      <footer className="page-footer" aria-label="技术支持"><button className="support-credit" onClick={()=>navigate('research')} aria-label="技术支持 SkillGo · 关于 SkillHub"><SupportLogo/><span>技术支持 · SkillGo</span></button><span className="support-divider" aria-hidden="true">/</span><span>{meta?.workspace!=='local'?'独立部署 · 数据保存在服务器':'本地运行 · 数据保存在本机'}</span></footer>
      </main>
    </div>
    {toast&&<div className="toast" role="status" ref={toastRef}><Check size={16}/>{toast}</div>}
    {selected&&<DetailModal isAdmin={meta?.user?.role==='admin'} notify={notify} skill={selected} onClose={()=>{setSelected(null);setReviewContext(null);}} favorite={()=>favorite(selected)} copy={copy} owned={!reviewContext&&selected.owner===meta?.user?.id} onChanged={refreshSelected} onDeleted={()=>{setSelected(null);setReviewContext(null);reload();notify('技能已删除');}} onUpdate={setSelected} onReviewUpdate={setReviewContext} review={reviewContext} onReviewDone={()=>{setSelected(null);setReviewContext(null);reload();notify('审核完成');}}/>}
    {modal==='publish'&&<PublishModal onClose={()=>setModal(null)} notify={notify} onPublished={()=>{setModal(null);reload();setLibrary('mine');navigate('discover');}}/>}
  </div>;
}

function DetailModal({skill,onClose,favorite,copy,owned,onChanged,onDeleted,onUpdate,review,onReviewDone,onReviewUpdate,isAdmin,notify}:{isAdmin:boolean;notify:(message:string)=>void;skill:Skill;onClose:()=>void;favorite:()=>void;copy:(text:string)=>void;owned:boolean;onChanged:()=>void;onDeleted:()=>void;onUpdate:(s:Skill)=>void;review:Review|null;onReviewDone:()=>void;onReviewUpdate:(r:Review)=>void}) {
  const [tab,setTab]=useState('readme'),[versions,setVersions]=useState<{version:string;digest:string;changelog:string;created_at:string;commit:string|null;downloads_count:number}[]>([]),[markdown,setMarkdown]=useState(skill.markdown),[version,setVersion]=useState(skill.version),[error,setError]=useState(''),[bundle,setBundle]=useState<PackageMetadata|null>(null);
  const [confirmVersion,setConfirmVersion]=useState<string|null>(null),[deletingVersion,setDeletingVersion]=useState(false);
  const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[metaError,setMetaError]=useState('');
  const [editName,setEditName]=useState(skill.name),[editDescription,setEditDescription]=useState(skill.originalDescription),[editCategory,setEditCategory]=useState<Category>(skill.category==='auto'?'productivity':skill.category),[editLicense,setEditLicense]=useState(skill.license),[editAgents,setEditAgents]=useState<Agent[]>(skill.agents),[editTags,setEditTags]=useState(skill.tags.join(', '));
  const [confirmDelete,setConfirmDelete]=useState(false),[deleting,setDeleting]=useState(false);
  useEffect(()=>{setEditing(false);setConfirmDelete(false);setMetaError('');setEditName(skill.name);setEditDescription(skill.originalDescription);setEditCategory(skill.category==='auto'?'productivity':skill.category);setEditLicense(skill.license);setEditAgents(skill.agents);setEditTags(skill.tags.join(', '));},[skill.id,skill.version]);
  const resource=review?'admin/reviews/'+review.id:'skills/'+skill.id;
  useEffect(()=>{if(review){setVersions([]);return;}loadVersions();},[skill.id,review?.id]);
  // While the AI summary/review is in flight, refresh this modal's data every 4s without user action.
  const pending = review ? ['queued','running'].includes(review.aiStatus) : (['queued','running'].includes(skill.aiStatus) || skill.reviewStatus==='pending');
  useEffect(()=>{
    if(!pending)return;
    let live=true;
    const t=setInterval(async()=>{
      try {
        if(review){
          // Administrator view must use the admin review endpoint; the owner reviews API returns 404.
          const current=await api<Review>('admin/reviews/'+review.id);
          if(live)onReviewUpdate(current);
        } else {
          const fresh=await api<Skill>('skills/'+skill.id);
          if(live) onUpdate(fresh);
        }
      } catch { /* transient */ }
    },4000);
    return ()=>{live=false;clearInterval(t);};
  },[pending, review?.id, review?.aiStatus, skill.aiStatus, skill.reviewStatus]);
  useEffect(()=>{let live=true;setBundle(null);api<PackageMetadata>(resource+'/package?version='+version).then(v=>{if(live)setBundle(v);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[resource,version]);
  const readVersion=async(v:string)=>{try{const r=await fetch('/api/v1/'+resource+'/file?version='+v);if(!r.ok){if(r.status===401)window.dispatchEvent(new Event('skillhub-session-expired'));throw new Error('无法加载版本');}setMarkdown(await r.text());setVersion(v);setTab('readme');}catch(e){setError((e as Error).message);}};
  const scrollRef=useRef<HTMLDivElement>(null);
  useGSAP(()=>{const mm=gsap.matchMedia();mm.add('(prefers-reduced-motion: no-preference)',()=>gsap.fromTo(scrollRef.current,{autoAlpha:0,y:8},{autoAlpha:1,y:0,duration:.32,ease:'power3.out',clearProps:'transform,opacity,visibility'}));return()=>mm.revert();},{dependencies:[tab,version,skill.id],revertOnUpdate:true});
  const saveMetadata=async(e:FormEvent)=>{e.preventDefault();if(saving)return;setSaving(true);setMetaError('');try{await api('skills/'+skill.id,{method:'PATCH',body:JSON.stringify({name:editName.trim(),description:editDescription.trim(),category:editCategory,license:editLicense.trim()||'Unspecified',agents:editAgents,tags:editTags.split(',').map(t=>t.trim()).filter(Boolean)})});setEditing(false);notify('展示资料已更新');onChanged();}catch(e){setMetaError((e as Error).message);}finally{setSaving(false);}};
  const removeSkill=async()=>{if(deleting)return;setDeleting(true);try{await api('skills/'+skill.id,{method:'DELETE'});onDeleted();}catch(e){notify((e as Error).message);setDeleting(false);}};
  const loadVersions=()=>api<typeof versions>('skills/'+skill.id+'/versions').then(setVersions).catch(e=>setError((e as Error).message));
  const removeVersion=async(v:string)=>{
    if(deletingVersion)return;setDeletingVersion(true);setMetaError('');
    try{
      await api('skills/'+skill.id+'/versions/'+v,{method:'DELETE'});
      const rest=versions.filter(x=>x.version!==v);
      setVersions(rest);setConfirmVersion(null);notify('版本 v'+v+' 已删除');
      if(v===version&&rest[0])await readVersion(rest[0].version);
      if(v===skill.version){const fresh=await api<Skill>('skills/'+skill.id);onUpdate(fresh);}
      onChanged();
    }catch(e){notify((e as Error).message);}finally{setDeletingVersion(false);}
  };
  return <Modal title={skill.name} onClose={onClose} wide dismissible={!deleting}>
    <div className="detail-summary"><SkillIcon skill={skill}/><div><p>{skill.description}</p><span>{categoryLabels[skill.category]} <span className="footer-dot">·</span> {skill.license} <span className="footer-dot">·</span> v{version}</span></div>{!review&&<button className={`icon-btn ${skill.favorite?'saved':''}`} onClick={favorite} aria-label="切换收藏"><Bookmark size={20} fill={skill.favorite?'currentColor':'none'}/></button>}</div>
    <div className="detail-actions"><a className="primary-btn" href={`/api/v1/${resource}/download?version=${version}`}><ArrowDownToLine size={15}/>下载 ZIP</a>{bundle?.kind==='catalog-markdown'&&<span className="bundle-note">示例快照，仅含 SKILL.md</span>}{owned&&<div className="detail-owner-actions"><button className="text-btn" onClick={()=>setEditing(v=>!v)} disabled={deleting}>{editing?'取消编辑':'编辑资料'}</button><button className="text-btn danger-text" onClick={()=>setConfirmDelete(true)} disabled={deleting}>删除技能</button></div>}</div>
    {pending&&<p className="ai-pending"><Loader2 size={13} className="spin"/>{review?'AI 正在审核该版本，结果会自动刷新…':'AI 正在整理或审核，状态会自动刷新…'}</p>}
    {editing&&owned&&<form className="metadata-edit" onSubmit={saveMetadata}>
      <p className="edit-note">修改最新版本 v{skill.version} 的展示资料；SKILL.md、原包与版本号不变。修改描述、分类或标签会重置 AI 整理。</p>
      <div className="form-grid"><label className="field">名称<input value={editName} onChange={e=>setEditName(e.target.value)} required maxLength={120} disabled={saving}/></label><label className="field">分类<select value={editCategory} onChange={e=>setEditCategory(e.target.value as Category)} disabled={saving}>{CATEGORIES.map(c=><option key={c} value={c}>{categoryLabels[c]}</option>)}</select></label></div>
      <label className="field">描述<textarea value={editDescription} onChange={e=>setEditDescription(e.target.value)} required maxLength={20000} rows={3} disabled={saving}/></label>
      <div className="form-grid"><label className="field">许可证<input value={editLicense} onChange={e=>setEditLicense(e.target.value)} maxLength={80} disabled={saving}/></label><label className="field">标签（英文逗号分隔）<input value={editTags} onChange={e=>setEditTags(e.target.value)} placeholder="最多 10 个标签" disabled={saving}/></label></div>
      <fieldset className="agent-fieldset"><legend>声明适用的 Agent</legend>{AGENTS.map(a=><label key={a}><input type="checkbox" checked={editAgents.includes(a)} onChange={e=>setEditAgents(e.target.checked?[...editAgents,a]:editAgents.filter(x=>x!==a))} disabled={saving}/>{agentLabels[a]}</label>)}</fieldset>
      {metaError&&<p className="form-error" role="alert">{metaError}</p>}
      <div className="modal-footer"><button type="button" className="secondary-btn" onClick={()=>setEditing(false)} disabled={saving}>取消</button><button className="primary-btn" disabled={saving||!editAgents.length}>{saving&&<Loader2 size={15} className="spin"/>}{saving?'正在保存…':'保存资料'}</button></div>
    </form>}
    {confirmDelete&&owned&&!editing&&<div className="delete-confirm" role="alertdialog" aria-label="确认删除技能"><span>永久删除「{skill.name}」的全部版本、原包、审核与社区记录？此操作不可恢复。</span><div className="delete-confirm-actions"><button className="secondary-btn" onClick={()=>setConfirmDelete(false)} disabled={deleting}>取消</button><button className="primary-btn" disabled={deleting} onClick={removeSkill}>{deleting&&<Loader2 size={14} className="spin"/>}{deleting?'正在删除…':'确认删除'}</button></div></div>}
    {owned&&skill.importWarnings.length>0&&<p className="bundle-note">导入提示：{skill.importWarnings.join(" ")}</p>}
    <div className="detail-tabs"><button className={tab==='readme'?'active':''} onClick={()=>setTab('readme')}>SKILL.md</button><button className={tab==='files'?'active':''} onClick={()=>setTab('files')}>包内容</button>{!review&&<button className={tab==='versions'?'active':''} onClick={()=>setTab('versions')}>版本</button>}<button className={tab==='connect'?'active':''} onClick={()=>setTab('connect')}>API</button></div>
    <div className="detail-scroll" ref={scrollRef}>{error&&<p className="form-error">{error}</p>}
    {tab==='readme'?<><div className="source-file-bar"><span><FileCode2 size={14}/>SKILL.md <span>v{version}</span></span><button className="text-btn" onClick={()=>copy(markdown)}><Copy size={13}/>复制</button></div><Markdown text={markdown}/></>:tab==='files'?<div className="package-files">{bundle?bundle.files.map(file=><div key={file.path}><FileCode2 size={15}/><code>{file.path}</code><span>{(file.size/1024).toFixed(1)} KB</span></div>):<p className="muted">正在读取包内容…</p>}</div>:tab==='versions'?<div className="versions-list">{versions.map(v=>{const protectedVersion=v.version===skill.communityVersion;const reviewing=v.version===skill.version&&skill.reviewStatus==='pending';return <div key={v.version} className={confirmVersion===v.version?'confirming':''}><span className="version-node"><GitBranch size={16}/></span><div><strong>v{v.version}{v.version===skill.version&&<span className="featured-badge">Latest</span>}{protectedVersion&&<span className="featured-badge">社区版</span>}</strong><p>{v.changelog||<span className="muted">未填写更新说明</span>}</p><small>{new Date(v.created_at).toLocaleDateString('zh-CN')} · 下载 {v.downloads_count??0} 次</small>{confirmVersion===v.version&&<span className="inline-confirm"><span>删除 v{v.version} 的原包与记录？{protectedVersion?'社区版不可删除。':reviewing?'该版本正在审核，不能删除。':'此操作不可恢复。'}</span>{!protectedVersion&&!reviewing&&<><button className="text-btn danger-text" disabled={deletingVersion} onClick={()=>removeVersion(v.version)}>{deletingVersion?'正在删除…':'确认删除'}</button><button className="text-btn" disabled={deletingVersion} onClick={()=>setConfirmVersion(null)}>取消</button></>}{(protectedVersion||reviewing)&&<button className="text-btn" onClick={()=>setConfirmVersion(null)}>知道了</button>}</span>}</div><div className="version-actions"><button className="secondary-btn" onClick={()=>readVersion(v.version)}>查看</button>{owned&&!protectedVersion&&!reviewing&&<button className="icon-btn danger-text" aria-label={'删除版本 v'+v.version} title="删除该版本" disabled={deletingVersion||versions.length<=1} onClick={()=>setConfirmVersion(v.version)}><Trash2 size={15}/></button>}</div></div>;})}</div>:<div className="connect-content"><h3>下载精确版本</h3><div className="code-block"><code>GET /api/v1/{resource}/download?version={version}</code><button aria-label="复制下载 API" onClick={()=>copy(`/api/v1/${resource}/download?version=${version}`)}><Copy size={15}/></button></div><p>上传的 ZIP 保持原始内容，可直接下载整个包。解压后放入 Agent 的技能目录。</p><dl className="metadata-list"><dt>ZIP 摘要</dt><dd>{bundle?.digest??'读取中…'}</dd><dt>SKILL.md 摘要</dt><dd>{versions.find(v=>v.version===version)?.digest??skill.digest}</dd><dt>声明适用</dt><dd>{skill.agents.map(a=>agentLabels[a]).join(' / ')}</dd></dl></div>}
    </div>
    {owned&&<CommunityControls skill={skill} version={version} onChanged={onChanged}/>}
    {review&&<ReviewDecision review={review} onDone={onReviewDone}/>}
    {isAdmin&&(review||skill.communityVersion||skill.communityBlocked)&&<CommunityModeration skill={skill} onDone={()=>{onClose();onChanged();}} notify={notify}/>}
  </Modal>;
}

function PublishModal({onClose,notify,onPublished}:{onClose:()=>void;notify:(s:string)=>void;onPublished:()=>void}) {
  const [file,setFile]=useState<File|null>(null),[version,setVersion]=useState(''),[category,setCategory]=useState<Category|'auto'>('auto'),[license,setLicense]=useState('Unspecified'),[agents,setAgents]=useState<Agent[]>([...AGENTS]),[tags,setTags]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [progress,setProgress]=useState<number|null>(null),[processing,setProcessing]=useState(false);
  const choose=(value:File|undefined)=>{setError('');if(!value)return;if(!value.name.toLowerCase().endsWith('.zip')||value.size>MAX_ZIP_BYTES){setFile(null);setError('请选择不超过 50 MB 的 .zip 技能包');return;}setFile(value);};
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!file||busy)return;setBusy(true);setError('');setProgress(0);setProcessing(false);
    try{
      const form=new FormData();form.append('file',file);if(version.trim())form.append('version',version.trim());form.append('category',category);form.append('license',license);form.append('agents',JSON.stringify(agents));form.append('tags',JSON.stringify(tags.split(',').map(v=>v.trim()).filter(Boolean)));
      // XHR upload gives real byte progress; fetch cannot report the outgoing request body.
      const upload=new Promise<{status:number;body:{error?:{message:string}}}>((resolve,reject)=>{
        const xhr=new XMLHttpRequest();
        xhr.open('POST','/api/v1/skills');
        xhr.upload.onprogress=ev=>{if(ev.lengthComputable)setProgress(Math.round(ev.loaded/ev.total*100));};
        xhr.upload.onload=()=>setProcessing(true);
        xhr.onerror=()=>reject(new Error('网络错误，上传中断'));
        xhr.onload=()=>{let body={};try{body=JSON.parse(xhr.responseText);}catch{}resolve({status:xhr.status,body});};
        xhr.send(form);
      });
      const response=await upload;
      if(response.status===401)window.dispatchEvent(new Event('skillhub-session-expired'));
      if(response.status<200||response.status>=300)throw new Error(response.body.error?.message??'上传失败');
      notify('已保存到我的技能，AI 正在总结与分类');onPublished();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);setProgress(null);setProcessing(false);}};
  return <Modal title="上传技能" onClose={onClose} wide><form className="publish-form" onSubmit={submit}>
    <p className="publish-privacy">上传后仅自己可见，AI 会自动整理简介、分类与标签。需要分享时，点击技能卡片上的“发布到社区”，AI 审核通过后对其他用户可见。</p>
    <label className={`zip-upload ${file?'has-file':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();choose(e.dataTransfer.files[0]);}}><ArrowDownToLine size={26}/><strong>{file?file.name:'选择或拖入 ZIP 技能包'}</strong><span>{file? (file.size/1024).toFixed(1)+' KB':'包含 SKILL.md，可附带脚本、参考资料和资源文件。'}</span><small>最大 50 MB</small><input type="file" accept=".zip,application/zip" aria-label="选择 ZIP 技能包" onChange={e=>choose(e.target.files?.[0])}/></label>
    <div className="upload-guide"><span>支持多层目录和不同大小写的 SKILL.md，其他资源原样保留。</span><a className="text-btn" href="/api/v1/package-template">下载示例包 <ArrowDownToLine size={13}/></a></div>
    {busy&&progress!==null&&<div className="upload-progress" role="status"><div className="upload-progress-bar"><span style={{width:(processing?100:progress)+'%'}}/></div><span className="upload-progress-label">{processing?'服务器正在校验并保存包…':'上传中 '+progress+'%'}</span></div>}
    <div className="form-grid"><label className="field">版本（选填）<input value={version} onChange={e=>setVersion(e.target.value)} placeholder="自动递增，或指定 x.y.z"/></label><label className="field">分类<select value={category} onChange={e=>setCategory(e.target.value as Category|'auto')}><option value="auto">自动分类（AI 推荐）</option>{CATEGORIES.map(c=><option key={c} value={c}>{categoryLabels[c]}</option>)}</select></label></div>
    <details className="publish-options"><summary>更多发布信息</summary><label className="field">许可证<input value={license} onChange={e=>setLicense(e.target.value)} required maxLength={80}/></label><label className="field">标签<input value={tags} onChange={e=>setTags(e.target.value)} placeholder="以英文逗号分隔"/></label><fieldset className="agent-fieldset"><legend>声明适用的 Agent</legend>{AGENTS.map(a=><label key={a}><input type="checkbox" checked={agents.includes(a)} onChange={e=>setAgents(e.target.checked?[...agents,a]:agents.filter(x=>x!==a))}/>{agentLabels[a]}</label>)}</fieldset></details>
    {error&&<div className="form-error" role="alert">{error}</div>}<div className="modal-footer"><button type="button" className="secondary-btn" onClick={onClose}>取消</button><button className="primary-btn" disabled={busy||!file||!agents.length}>{busy&&<Loader2 size={15} className="spin"/>}{busy?'正在保存…':'保存到我的技能'}</button></div>
  </form></Modal>;
}

function ApiView({meta,notify,copy}:{meta:Meta|null;notify:(s:string)=>void;copy:(text:string)=>void}) {
  const [keys,setKeys]=useState<{id:string;name:string;prefix:string;scope:string}[]>([]),[name,setName]=useState(''),[scope,setScope]=useState('read'),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[keyError,setKeyError]=useState('');
  const [endpoint,setEndpoint]=useState('skills'),[result,setResult]=useState(''),[running,setRunning]=useState(false),[apiFile,setApiFile]=useState<File|null>(null);
  const loadKeys=()=>api<typeof keys>('keys').then(setKeys).catch(e=>setKeyError(e.message));
  useEffect(()=>{if(meta?.user)loadKeys();},[meta?.user?.id]);
  const createKey=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setKeyError('');try{const r=await api<{token:string}>('keys',{method:'POST',body:JSON.stringify({name,scope})});setToken(r.token);setName('');loadKeys();notify('API Key 已创建，仅展示一次');}catch(e){setKeyError((e as Error).message);}finally{setBusy(false);}};
  const revoke=async(id:string)=>{try{await api('keys/'+id,{method:'DELETE'});setToken('');loadKeys();notify('API Key 已撤销');}catch(e){setKeyError((e as Error).message);}};
  const run=async()=>{setRunning(true);try{let options:RequestInit={};if(endpoint==='upload'){if(!apiFile)throw new Error('请选择 ZIP 包');const form=new FormData();form.append('file',apiFile);options={method:'POST',body:form};}const r=await fetch('/api/v1/'+(endpoint==='upload'?'skills':endpoint),options);if(r.status===401)window.dispatchEvent(new Event('skillhub-session-expired'));setResult('HTTP '+r.status+'\n'+JSON.stringify(await r.json(),null,2));}catch(e){setResult((e as Error).message);}finally{setRunning(false);}};
  const endpoints=[['GET','/skills','搜索、分类与分页'],['POST','/skills','上传标准 ZIP 技能包'],['GET','/skills/{id}','技能详情'],['GET','/skills/{id}/versions','不可变版本与下载量'],['DELETE','/skills/{id}/versions/{version}','删除单个私有版本'],['GET','/skills/{id}/package','包内容与摘要'],['GET','/skills/{id}/download','完整 ZIP 下载'],['PUT / DELETE','/skills/{id}/favorite','收藏管理'],['GET','/package-template','下载 ZIP 示例包'],['GET / POST','/agents','我的 Agent 列表 / 新建'],['GET','/agents/{id}','Agent 详情'],['PATCH','/agents/{id}','所有者更新 Agent'],['DELETE','/agents/{id}','所有者删除 Agent'],['POST','/agents/{id}/invoke','调用；允许名单内转发到已保存的上游'],['GET / POST','/keys','查询与创建 API Key'],['DELETE','/keys/{id}','撤销 API Key'],['GET / POST','/messages','查看与发布便利贴'],['GET / DELETE','/messages/{id}','全文 / 管理员删除'],['POST / DELETE','/skills/{id}/community','提交审核 / 撤回社区'],['GET','/skills/{id}/reviews','查看自己的审核记录'],['GET','/admin/reviews','管理员审核列表'],['POST','/admin/reviews/{id}/decision','管理员通过 / 驳回']];
  return <><section className="page-heading"><span className="eyebrow">DEVELOPERS</span><h1>为你的工作流而开放。</h1><p>界面能做的事，你的应用也能。用一套 API 接入 SkillHub。</p></section><div className="api-overview"><span className="api-overview-icon"><Terminal size={30}/></span><div><span className="eyebrow">REST API · V1</span><h2>REST API · v1</h2><p>标准 JSON、精确版本、统一错误格式。API Key 支持只读或读写权限。</p></div><a className="secondary-btn" href="/docs" target="_blank" rel="noreferrer"><BookOpen size={15}/>API 文档</a></div><div className="api-columns"><section className="surface-panel"><div className="panel-heading"><h2>接口一览</h2><span className="subtle-tag">/api/v1</span></div><div className="endpoint-list">{endpoints.map(([method,path,label])=><div key={method+path}><span className={`method-badge ${method.startsWith('POST')?'post':''}`}>{method}</span><div><code>{path}</code><small>{label}</small></div></div>)}</div><a className="text-btn" href="/docs" target="_blank" rel="noreferrer">查看参数与调用示例 <ArrowUpRight size={14}/></a></section><section className="surface-panel playground"><div className="panel-heading"><h2>在线试一试</h2><span className="live-tag"><i/>LIVE</span></div><p>直接调用当前运行的 API。</p><label className="field">选择接口<select value={endpoint} onChange={e=>setEndpoint(e.target.value)}><option value="skills">GET /skills</option><option value="meta">GET /meta</option><option value="upload">POST /skills · 上传 ZIP</option></select></label>{endpoint==='upload'&&<label className="field">ZIP 文件<input type="file" accept=".zip,application/zip" onChange={e=>setApiFile(e.target.files?.[0]??null)}/></label>}<button className="primary-btn" onClick={run} disabled={running}>{running?<Loader2 className="spin" size={15}/>:<Terminal size={15}/>}发送请求</button><pre className="api-result" aria-live="polite">{result||'// 返回结果会显示在这里'}</pre></section></div><section className="surface-panel keys-panel"><div className="panel-heading"><div><h2>API Keys</h2><p>密钥仅在创建时展示，数据库保存单向摘要。</p></div><LockKeyhole size={20}/></div>{meta?.user?<><form className="key-create" onSubmit={createKey}><input aria-label="API Key 名称" placeholder="例如：开发环境" value={name} onChange={e=>setName(e.target.value)} required maxLength={60}/><select aria-label="API Key 权限" value={scope} onChange={e=>setScope(e.target.value)}><option value="read">只读</option><option value="write">读写</option></select><button className="primary-btn" disabled={busy}>{busy?<Loader2 className="spin" size={14}/>:<Plus size={14}/>}创建密钥</button></form>{token&&<div className="created-key"><strong>请保存密钥，关闭页面后无法再次查看。</strong><div><code>{token}</code><button className="icon-btn" onClick={()=>copy(token)} aria-label="复制新密钥"><Copy size={16}/></button></div></div>}{keys.length>0?<div className="key-list">{keys.map(k=><div key={k.id}><KeyIcon/><strong>{k.name}</strong><code>{k.prefix}…</code><span className="subtle-tag">{k.scope==='read'?'只读':'读写'}</span><button className="icon-btn" onClick={()=>revoke(k.id)} aria-label={'撤销 '+k.name}><Trash2 size={15}/></button></div>)}</div>:<p className="muted">还没有 API Key。</p>}</>:<p className="muted">正在加载工作区…</p>}{keyError&&<p className="form-error">{keyError}</p>}<div className="api-auth-note"><p>调用时使用 <code>Authorization: Bearer sg_…</code>。{meta?.loginConfigured?'当前登录公司账号；收藏和密钥仅属于你。':'当前为本地测试身份。'}</p></div></section></>;
}
function KeyIcon(){return <LockKeyhole size={16} className="muted"/>;}
const agentStatusLabel: Record<AgentStatus,string> = { draft:'草稿', published:'已发布' };
function useAttachableSkills() {
  const [skills,setSkills]=useState<Summary[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{
    let current=true;
    Promise.all([
      api<{items:Summary[]}>('skills?scope=mine&limit=100'),
      api<{items:Summary[]}>('skills?scope=community&limit=100'),
    ]).then(([mine,community])=>{
      if(!current)return;
      const seen=new Set<string>();
      const items:Summary[]=[];
      for(const skill of [...mine.items,...community.items]){
        if(!AGENT_SKILL_ID.test(skill.id)||seen.has(skill.id))continue;
        seen.add(skill.id);items.push(skill);
      }
      setSkills(items);
    }).catch(e=>{if(current)setError((e as Error).message);}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[]);
  return {skills,error,loading};
}
function skillChoiceLabel(skill:Summary,pinned?:string){return skill.name+'@'+(pinned??skill.version);}
function AgentHub({notify}:{notify:(message:string)=>void}) {
  const root=useRef<HTMLElement>(null);
  const [query,setQuery]=useState(''),[debounced,setDebounced]=useState(''),[agents,setAgents]=useState<HubAgent[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[moreLoading,setMoreLoading]=useState(false);
  const [selected,setSelected]=useState<HubAgent|null>(null),[creating,setCreating]=useState(false),[editing,setEditing]=useState(false),listKey=useRef<string|null>(null);
  useEffect(()=>{const t=setTimeout(()=>setDebounced(query),250);return()=>clearTimeout(t);},[query]);
  useEffect(()=>{
    const silent=listKey.current===debounced;listKey.current=debounced;
    let current=true;if(!silent)setLoading(true);setError('');
    api<{items:HubAgent[];total:number}>('agents?scope=mine&limit=24&q='+encodeURIComponent(debounced)).then(v=>{if(current){setAgents(v.items);setTotal(v.total);}}).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[debounced,refresh]);
  useGSAP(()=>{
    if(loading)return;
    const mm=gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)',()=>{
      const cards=root.current?.querySelectorAll('.skill-card');
      if(cards?.length)gsap.from(cards,{y:14,autoAlpha:0,stagger:.06,duration:.55,ease:'power3.out',clearProps:'transform,opacity,visibility'});
      const empty=root.current?.querySelector('.empty-state');
      if(empty)gsap.from(empty,{y:14,autoAlpha:0,duration:.5,ease:'power3.out',clearProps:'transform,opacity,visibility'});
    });
    return()=>mm.revert();
  },{scope:root,dependencies:[loading,agents],revertOnUpdate:true});
  const loadMore=async()=>{setMoreLoading(true);try{const page=await api<{items:HubAgent[]}>('agents?scope=mine&limit=24&offset='+agents.length+'&q='+encodeURIComponent(debounced));setAgents(prev=>[...prev,...page.items]);}catch(e){notify((e as Error).message);}finally{setMoreLoading(false);}};
  const saved=(agent:HubAgent,created:boolean)=>{setCreating(false);setEditing(false);setSelected(agent);setRefresh(v=>v+1);notify(created?'Agent 已保存':'Agent 已更新');};
  return <><section className="page-heading"><span className="eyebrow">AGENTHUB</span><h1>我的 Agent。</h1></section><section className="catalog-section" ref={root}>
    <div className="section-heading"><h2>全部 <span>{total}</span></h2><button className="text-btn" onClick={()=>{setSelected(null);setEditing(false);setCreating(true);}}>新建 Agent <Plus size={15}/></button></div>
    <div className="catalog-controls"><div className="search-box"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索名称、标识或说明" aria-label="搜索 Agent"/>{query?<button className="icon-btn" onClick={()=>setQuery('')} aria-label="清空搜索"><X size={14}/></button>:null}</div></div>
    {error?<div className="empty-state"><CircleHelp size={28}/><h3>暂时无法加载</h3><p>{error}</p><button className="secondary-btn" onClick={()=>setRefresh(v=>v+1)}>重试</button></div>:loading?<div className="skill-grid">{[0,1,2,3].map(i=><div className="skeleton-card" key={i}><div/><span/><span/><span/></div>)}</div>:agents.length?<><div className="skill-grid">{agents.map(agent=><article className="skill-card" key={agent.id} data-skill-id={agent.id}><div className="card-top"><span className="skill-icon"><Bot size={20} strokeWidth={1.7}/></span></div><button className="card-content" onClick={()=>{setEditing(false);setSelected(agent);}}><h3>{agent.name}<ArrowUpRight size={15}/></h3><span className="card-author">{agent.slug}</span><p>{agent.description||'还没有说明'}</p></button><div className="card-tags">{agent.config.tools.slice(0,3).map(tool=><button key={tool} onClick={()=>setQuery(tool)}>{tool}</button>)}</div><div className="card-footer"><span className="card-compatibility">{agentStatusLabel[agent.status]}</span></div></article>)}</div>{agents.length<total&&<button className="secondary-btn load-more" disabled={moreLoading} onClick={loadMore}>{moreLoading?<Loader2 className="spin" size={15}/>:<Plus size={15}/>}加载更多</button>}</>:<div className="empty-state"><Bot size={30}/><h3>{query?'没有匹配的 Agent':'还没有 Agent'}</h3><p>{query?'换个关键词。':'写下一个名称和人设，保存在你的账号里。'}</p>{query?<button className="secondary-btn" onClick={()=>setQuery('')}>清空搜索</button>:<button className="primary-btn" onClick={()=>{setSelected(null);setCreating(true);}}>新建 Agent</button>}</div>}
  </section>
  {creating&&<AgentEditor agent={null} onClose={()=>setCreating(false)} onSaved={agent=>saved(agent,true)}/>}
  {selected&&editing&&<AgentEditor agent={selected} onClose={()=>setEditing(false)} onSaved={agent=>saved(agent,false)}/>}
  {selected&&!editing&&<AgentDetail agent={selected} onClose={()=>setSelected(null)} onEdit={()=>setEditing(true)} onDeleted={()=>{setSelected(null);setRefresh(v=>v+1);notify('Agent 已删除');}} notify={notify}/>}
  </>;
}
function AgentEditor({agent,onClose,onSaved}:{agent:HubAgent|null;onClose:()=>void;onSaved:(agent:HubAgent)=>void}) {
  const [name,setName]=useState(agent?.name??''),[slug,setSlug]=useState(agent?.slug??''),[description,setDescription]=useState(agent?.description??''),[persona,setPersona]=useState(agent?.config.persona??''),[tools,setTools]=useState(agent?.config.tools.join(', ')??''),[upstreamUrl,setUpstreamUrl]=useState(agent?.config.upstreamUrl??''),[status,setStatus]=useState<AgentStatus>(agent?.status??'draft'),[selected,setSelected]=useState<AgentSkillRef[]>(agent?.config.skills??[]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const catalog=useAttachableSkills();
  const toggleSkill=(skillId:string)=>{
    setError('');
    setSelected(prev=>{
      if(prev.some(ref=>ref.skillId===skillId))return prev.filter(ref=>ref.skillId!==skillId);
      if(prev.length>=20){setError('最多挂载 20 个技能');return prev;}
      return [...prev,{skillId}];
    });
  };
  const submit=async(e:FormEvent)=>{
    e.preventDefault();if(agent&&!slug.trim()){setError('请填写 slug');return;}
    setBusy(true);setError('');
    const payload:Record<string,unknown>={name,description,status,config:{persona,tools:tools.split(/[,，]/).map(item=>item.trim()).filter(Boolean),skills:selected,upstreamUrl:upstreamUrl.trim()||null}};
    if(slug.trim())payload.slug=slug.trim();
    try{onSaved(await api<HubAgent>(agent?'agents/'+agent.id:'agents',{method:agent?'PATCH':'POST',body:JSON.stringify(payload)}));}
    catch(err){setError((err as Error).message);setBusy(false);}
  };
  const known=new Set(catalog.skills.map(skill=>skill.id));
  return <Modal title={agent?'编辑 Agent':'新建 Agent'} onClose={onClose} wide><form className="publish-form" onSubmit={submit}>
    <div className="form-grid"><label className="field">名称<input value={name} onChange={e=>setName(e.target.value)} required maxLength={120} placeholder="例如：值班助手"/></label><label className="field">标识<input value={slug} onChange={e=>setSlug(e.target.value)} maxLength={100} placeholder={agent?'小写字母、数字和连字符':'留空则根据名称生成'} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" aria-label="Agent 标识"/></label></div>
    <label className="field">说明<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={4000} rows={3} placeholder="这个 Agent 用来做什么"/></label>
    <label className="field">人设<textarea value={persona} onChange={e=>setPersona(e.target.value)} maxLength={20000} rows={5} placeholder="系统提示。保存在这里，转发时交给上游。"/></label>
    <div className="form-grid"><label className="field">工具范围<input value={tools} onChange={e=>setTools(e.target.value)} placeholder="以逗号分隔，例如 search, notes"/></label><label className="field">状态<select aria-label="Agent 状态" value={status} onChange={e=>setStatus(e.target.value as AgentStatus)}><option value="draft">草稿</option><option value="published">已发布</option></select></label></div>
    <fieldset className="skill-ref-fieldset"><legend>挂载技能</legend><span>从我的技能和已进入社区的技能中选择，最多 20 个。只保存引用；未钉死的版本在调用时再解析。</span>{catalog.loading?<span>正在读取技能…</span>:catalog.skills.length||selected.some(ref=>!known.has(ref.skillId))?<div className="skill-ref-list">{catalog.skills.map(skill=>{const ref=selected.find(item=>item.skillId===skill.id);return <label key={skill.id}><input type="checkbox" checked={!!ref} onChange={()=>toggleSkill(skill.id)}/>{skillChoiceLabel(skill,ref?.version)}</label>;})}{selected.filter(ref=>!known.has(ref.skillId)).map(ref=><label key={ref.skillId}><input type="checkbox" checked onChange={()=>toggleSkill(ref.skillId)}/>{ref.version?ref.skillId+'@'+ref.version:ref.skillId}<small>当前列表中不可见</small></label>)}</div>:<span>还没有可挂载的技能。</span>}{catalog.error?<span>{catalog.error}</span>:null}</fieldset>
    <label className="field">上游地址<span>选填。服务端只在允许名单通过后转发。</span><input value={upstreamUrl} onChange={e=>setUpstreamUrl(e.target.value)} maxLength={500} placeholder="https://example.internal/v1" inputMode="url"/></label>
    {error&&<div className="form-error" role="alert">{error}</div>}
    <div className="modal-footer"><button type="button" className="secondary-btn" onClick={onClose} disabled={busy}>取消</button><button className="primary-btn" disabled={busy||!name.trim()}>{busy&&<Loader2 size={15} className="spin"/>}{busy?'正在保存…':'保存'}</button></div>
  </form></Modal>;
}
function AgentDetail({agent,onClose,onEdit,onDeleted,notify}:{agent:HubAgent;onClose:()=>void;onEdit:()=>void;onDeleted:()=>void;notify:(message:string)=>void}) {
  const [input,setInput]=useState(''),[context,setContext]=useState(''),[receipt,setReceipt]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[deleting,setDeleting]=useState(false);
  const catalog=useAttachableSkills();
  const refs=agent.config.skills??[];
  const invoke=async(e:FormEvent)=>{
    e.preventDefault();setError('');
    let parsed:unknown;
    if(context.trim()){try{parsed=JSON.parse(context);}catch{setError('context 须为 JSON');return;}}
    setBusy(true);
    try{
      const body:Record<string,unknown>={input};
      if(context.trim())body.context=parsed;
      setReceipt(JSON.stringify(await api('agents/'+agent.id+'/invoke',{method:'POST',body:JSON.stringify(body)}),null,2));
    }catch(err){setError((err as Error).message);}finally{setBusy(false);}
  };
  const remove=async()=>{if(deleting)return;setDeleting(true);try{await api('agents/'+agent.id,{method:'DELETE'});onDeleted();}catch(err){notify((err as Error).message);setDeleting(false);}};
  return <Modal title={agent.name} onClose={onClose} wide>
    <div className="detail-summary"><span className="skill-icon"><Bot size={20} strokeWidth={1.7}/></span><div><p>{agent.description||'还没有说明'}</p><span>{agent.slug} <span className="footer-dot">·</span> {agentStatusLabel[agent.status]}</span></div></div>
    <div className="detail-actions"><button className="text-btn" onClick={onEdit}>编辑资料</button><button className="text-btn danger-text" onClick={()=>setConfirm(true)} disabled={deleting}>删除 Agent</button></div>
    {confirm&&<div className="delete-confirm" role="alertdialog" aria-label="确认删除 Agent"><span>永久删除「{agent.name}」？此操作不可恢复。</span><div className="delete-confirm-actions"><button className="secondary-btn" onClick={()=>setConfirm(false)} disabled={deleting}>取消</button><button className="primary-btn" disabled={deleting} onClick={remove}>{deleting&&<Loader2 size={14} className="spin"/>}{deleting?'正在删除…':'确认删除'}</button></div></div>}
    <form className="publish-form" onSubmit={invoke}>
      {agent.config.persona?<label className="field">人设<pre className="markdown-code">{agent.config.persona}</pre></label>:null}
      <div className="field">挂载技能{refs.length?<ul className="skill-ref-list">{refs.map(ref=>{const found=catalog.skills.find(skill=>skill.id===ref.skillId);const version=ref.version??found?.version;return <li key={ref.skillId}>{found?found.name:ref.skillId}{version?<small>@{version}</small>:null}{!catalog.loading&&!found?<small>当前无法读取</small>:null}</li>;})}</ul>:<span>还没有挂载技能。</span>}</div>
      <p className="publish-privacy">{agent.config.tools.length?'工具范围：'+agent.config.tools.join('、'):'还没有声明工具范围。'}{agent.config.upstreamUrl?' 上游地址已保存。调用仅在服务端允许名单通过后转发。':''}</p>
      <label className="field">调用输入<textarea value={input} onChange={e=>setInput(e.target.value)} required maxLength={20000} rows={4} placeholder="要交给这个 Agent 的内容"/></label>
      <label className="field">上下文 JSON<span>选填。写入回执，转发时一并交给上游。</span><textarea value={context} onChange={e=>setContext(e.target.value)} rows={3} placeholder='{"locale":"zh-CN"}'/></label>
      {error&&<div className="form-error" role="alert">{error}</div>}
      <div className="modal-footer"><button className="primary-btn" disabled={busy||!input.trim()}>{busy&&<Loader2 size={15} className="spin"/>}{busy?'正在调用…':'调用'}</button></div>
      {receipt&&<pre className="api-result" aria-live="polite">{receipt}</pre>}
    </form>
  </Modal>;
}
function ResearchView() {
  const rows=[{name:'Vercel Skills',url:'https://github.com/vercel-labs/skills',good:'通用 SKILL.md 格式与多 Agent 生态。',choice:'保留通用格式；发布只接收 ZIP，不提供 GitHub 导入。',icon:Terminal},{name:'ClawHub',url:'https://github.com/openclaw/clawhub',good:'注册表、不可变版本与完整的 API。',choice:'借鉴版本与 API 模型，完整保存上传包。',icon:Layers3},{name:'SkillHub Local',url:'https://github.com/mjalalimanesh/skillhub-local',good:'集中管理本机技能，清晰展示内容。',choice:'保持极简 PC 工作台，专注搜索、发布、下载和收藏。',icon:LayoutDashboard}];
  return <><section className="page-heading"><span className="eyebrow">ABOUT</span><h1>关于 SkillHub。</h1><p>一个简单的技能库。</p></section><div className="research-grid">{rows.map(row=><article className="surface-panel research-card" key={row.name}><span className="skill-icon"><row.icon size={24}/></span><h2>{row.name}</h2><h4>值得借鉴</h4><p>{row.good}</p><h4>我们的选择</h4><p>{row.choice}</p><a className="text-btn" href={row.url} target="_blank" rel="noreferrer">查看调研项目 <ArrowUpRight size={14}/></a></article>)}</div></>;
}
