'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { api } from '@/lib/client-api';

export type AuthState={authenticated:boolean;loginConfigured:boolean;user:{id:string;displayName:string}|null;service:string|null};
let boot:Promise<AuthState>|undefined;
function authenticate() {
  return boot??=(async()=>{
    const url=new URL(window.location.href),tickets=url.searchParams.getAll('ticket');
    if(tickets.length){
      url.searchParams.delete('ticket');window.history.replaceState(null,'',url.pathname+url.search+url.hash);
      if(tickets.length!==1)throw new Error('登录回调无效，请重新登录');
      await api('auth/cas/exchange',{method:'POST',body:JSON.stringify({ticket:tickets[0],service:window.location.origin+'/'})});
    }
    return api<AuthState>('auth/me');
  })();
}
export default function AuthGate({children}:{children:ReactNode}) {
  const [state,setState]=useState<AuthState|null>(null),[error,setError]=useState('');
  useEffect(()=>{let live=true;authenticate().then(value=>{if(live)setState(value);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
  useEffect(()=>{
    const expired=()=>{boot=undefined;setState({authenticated:false,loginConfigured:true,user:null,service:null});setError('登录已过期或已退出，请重新登录。');};
    const changed=(event:StorageEvent)=>{if(event.key==='skillhub-auth-change')expired();};
    window.addEventListener('skillhub-session-expired',expired);window.addEventListener('storage',changed);
    return()=>{window.removeEventListener('skillhub-session-expired',expired);window.removeEventListener('storage',changed);};
  },[]);
  if(state?.authenticated)return children;
  return <div className="auth-shell"><header className="auth-header"><img src="/tianchen-logo.png" alt="中国化学 · 天辰公司" width="1074" height="359"/></header><main className="auth-content">
    {!state&&!error?<div className="auth-loading" role="status"><Loader2 size={20} className="spin"/>正在确认登录状态…</div>:<><span className="eyebrow">SKILLHUB</span><h1>你的技能，从这里开始。</h1><p>使用公司账号登录 SkillHub。</p>{error&&<p className="auth-error" role="alert">{error}</p>}<a className="primary-btn" href="/api/v1/auth/login">公司账号登录 <ArrowRight size={15}/></a></>}
  </main><footer className="auth-footer"><span className="support-credit"><span className="support-logo"><img src="/skillgo-logo.png" alt="" width="1280" height="1280"/></span>技术支持 · SkillGo</span></footer></div>;
}
