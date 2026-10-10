'use client';

import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, Plus,Trash2 } from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { api } from '@/lib/client-api';
import { NOTE_COLORS, type BoardMessage, type MessagePage, type NoteColor, type NotePosition } from '@/lib/board';
import Modal from './modal';

gsap.registerPlugin(useGSAP);
const colorNames: Record<NoteColor, string> = { yellow: '暖黄', blue: '浅蓝', pink: '淡粉', green: '浅绿' };
const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const NOTE_WIDTH = 224, NOTE_HEIGHT = 238;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export default function MessageBoard({ notify,isAdmin=false }: { notify: (message: string) => void;isAdmin?:boolean }) {
  const root = useRef<HTMLElement>(null);
  const [page, setPage] = useState<MessagePage | null>(null), [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [composing, setComposing] = useState(false), [selected, setSelected] = useState<BoardMessage | null>(null);
  const [position, setPosition] = useState<NotePosition>({x:.5,y:.5});
  const [columns, setColumns] = useState(4);
  const [confirmDelete,setConfirmDelete]=useState(false),[deleting,setDeleting]=useState(false);
  const board = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!board.current) return;
    const observer = new ResizeObserver(entries => { const width=entries[0].contentRect.width; setColumns(Math.max(1,Math.floor((width-56)/(NOTE_WIDTH+32)))); });
    observer.observe(board.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    api<MessagePage>(`messages?offset=${offset}&limit=12`).then(value => { if (live) setPage(value); }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [offset, refresh]);
  useGSAP(() => {
    if (loading || !page?.items.length) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => { gsap.from('.note-placement', { y: 12, autoAlpha: 0, duration: .5, stagger: .04, ease: 'power3.out', clearProps: 'transform,opacity,visibility' }); });
    return () => mm.revert();
  }, { scope: root, dependencies: [loading, page], revertOnUpdate: true });
  const inspect = async (id: string) => {
    try { setConfirmDelete(false);setSelected(await api<BoardMessage>('messages/' + id)); } catch (e) { notify((e as Error).message); }
  };
  const remove=async()=>{if(!selected||deleting)return;setDeleting(true);try{await api('messages/'+selected.id,{method:'DELETE'});setSelected(null);setConfirmDelete(false);setOffset(0);setRefresh(v=>v+1);notify('便签已删除');}catch(e){notify((e as Error).message);}finally{setDeleting(false);}};
  const composeAt = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.note-placement') || loading || error) return;
    const rect=e.currentTarget.getBoundingClientRect();
    setPosition({x:clamp((e.clientX-rect.left-e.currentTarget.clientLeft-28-NOTE_WIDTH/2)/Math.max(1,e.currentTarget.clientWidth-NOTE_WIDTH-56)),y:clamp((e.clientY-rect.top-e.currentTarget.clientTop-36-NOTE_HEIGHT/2)/Math.max(1,e.currentTarget.clientHeight-NOTE_HEIGHT-64))});
    setComposing(true);
  };
  const rows = Math.ceil((page?.items.length??0)/columns);
  return <section className="message-board-page" ref={root}>
      <div className="note-board" ref={board} style={{minHeight:Math.max(520,rows*(NOTE_HEIGHT+32)+64)}} role="region" aria-label="留言白板，点击空白处新增便签" tabIndex={0} onClick={composeAt} onKeyDown={e=>{if(e.target===e.currentTarget&&!loading&&!error&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setPosition({x:.5,y:.5});setComposing(true);}}}>
        {error ? <div className="whiteboard-status"><p>{error}</p><button className="secondary-btn" onClick={e=>{e.stopPropagation();setRefresh(v=>v+1);}}>重试</button></div> : loading ? <div className="whiteboard-status" role="status"><Loader2 className="spin" size={18}/></div> : page?.items.map((note,i) => {
          const at=note.position??{x:(i%columns)/Math.max(1,columns-1),y:rows>1?Math.floor(i/columns)/(rows-1):.12};
          return <div className="note-placement" key={note.id} style={{left:`calc(${at.x*100}% + ${28-at.x*(NOTE_WIDTH+56)}px)`,top:`calc(${at.y*100}% + ${36-at.y*(NOTE_HEIGHT+64)}px)`}}><button className={`message-note note-${note.color}`} onClick={()=>inspect(note.id)} aria-label={`查看 ${note.author} 的留言：${note.content.slice(0,36)}`}><span className="note-tape" aria-hidden="true"/><p>{note.content}</p><span className="note-signature"><strong>{note.author}</strong><time dateTime={note.createdAt}>{dateLabel(note.createdAt)}</time></span></button></div>;
        })}
      </div>
      {!!page&&page.total>12&&<div className="board-pagination"><span>第 {Math.floor(offset/12)+1} 页</span><div>{offset>0&&<button className="text-btn" onClick={()=>setOffset(Math.max(0,offset-12))}><ArrowLeft size={14}/>上一页</button>}{page.nextOffset!==null&&<button className="text-btn" onClick={()=>setOffset(page.nextOffset!)}>下一页<ArrowRight size={14}/></button>}</div></div>}
    {composing && <NoteComposer position={position} onClose={() => setComposing(false)} onPosted={() => { setComposing(false); setOffset(0); setRefresh(v => v + 1); notify('便利贴已贴上白板'); }} />}
    {selected && <Modal title="留言" onClose={() => setSelected(null)} dismissible={!deleting}><div className="note-view"><div className={`note-full note-${selected.color}`}><p>{selected.content}</p><div className="note-signature"><strong>{selected.author}</strong><time dateTime={selected.createdAt}>{dateLabel(selected.createdAt)}</time></div></div></div>{isAdmin&&<div className="modal-footer">{confirmDelete?<><span>确认删除这张便签？</span><button className="secondary-btn" disabled={deleting} onClick={()=>setConfirmDelete(false)}>取消</button><button className="primary-btn" disabled={deleting} onClick={remove}>{deleting?<Loader2 size={14} className="spin"/>:<Trash2 size={14}/>}确认删除</button></>:<button className="text-btn" onClick={()=>setConfirmDelete(true)}><Trash2 size={14}/>删除便签</button>}</div>}</Modal>}
  </section>;
}

function NoteComposer({ onClose, onPosted, position }: { onClose: () => void; onPosted: () => void; position: NotePosition }) {
  const [content, setContent] = useState(''), [author, setAuthor] = useState(''), [color, setColor] = useState<NoteColor>('yellow'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busy || !content.trim()) return;
    setBusy(true); setError('');
    try { await api<BoardMessage>('messages', { method: 'POST', body: JSON.stringify({ content, author, color, position }) }); onPosted(); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return <Modal title="写一张便利贴" onClose={onClose} dismissible={!busy}><form className="note-composer" onSubmit={submit}>
    <div className={`note-draft note-${color}`}><textarea aria-label="留言内容" placeholder="想说点什么？" value={content} onChange={e => setContent(e.target.value)} maxLength={2000} required autoFocus disabled={busy} /><span className="note-counter">{content.length} / 2000</span></div>
    <div className="note-compose-options"><label className="field">署名（选填）<input aria-label="留言署名" placeholder="留一个名字，或匿名发布" value={author} onChange={e => setAuthor(e.target.value)} maxLength={24} disabled={busy} /></label><div className="note-colors" role="group" aria-label="便签颜色">{NOTE_COLORS.map(value => <button type="button" className={`note-swatch note-${value}`} key={value} aria-label={'便签颜色：' + colorNames[value]} aria-pressed={color === value} onClick={() => setColor(value)} disabled={busy}>{color === value && <Check size={14} />}</button>)}</div></div>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="secondary-btn" onClick={onClose} disabled={busy}>取消</button><button className="primary-btn" disabled={busy || !content.trim()}>{busy ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}{busy ? '正在贴上…' : '贴上留言板'}</button></div>
  </form></Modal>;
}
