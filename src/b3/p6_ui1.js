/* =========================================================================
   共通UI部品
   ========================================================================= */
function tile(label,value,sub,cls){
  const d=el('div','tile');
  d.appendChild(el('div','lb',label));
  const v=el('div','vl',value); if(cls) v.style.color='var(--'+cls+')';
  d.appendChild(v);
  if(sub){ const s=el('div','sc'); s.innerHTML=sub; d.appendChild(s); }
  return d;
}
/** 20円ROASの色（目標400% / 防衛300% / 危険200%） */
function roasCls(r){
  if(!isFinite(r)) return 'grey';
  if(r<+CFG.badRoas) return 'bad';
  if(r<+CFG.defRoas) return 'alert';
  if(r<+CFG.goalRoas) return 'warn';
  return 'ok';
}
function kindChip(k){
  const M={kw:['KW＋20円','t-info'],c20:['20円のみ','t-grey'],none:['広告なし','t-grey']};
  const m=M[k]||['—','t-grey']; return el('span','tag '+m[1],m[0]);
}
function dtypeChip(d){
  const t=dayType(d);
  if(t==='normal') return el('span','chip','通常日');
  const cls = t==='five' ? 'chip five':'chip ev';
  return el('span',cls,dtLabel(t));
}
function confChip(c){
  const M={'高':'t-ok','中':'t-warn','低':'t-grey'};
  return el('span','tag '+(M[c]||'t-grey'),'信頼度 '+c);
}
function buildTable(host,cols,rows,opts){
  opts=opts||{}; host.innerHTML='';
  const st=host._sort||opts.sort||{k:null,dir:-1};
  const wrap=el('div','tblwrap'), t=el('table','dt'), th=el('thead'), tr=el('tr');
  cols.forEach(c=>{
    const h=el('th', c.sort===false?'nos':'');
    h.textContent=c.t; if(c.title) h.title=c.title;
    if(c.num) h.style.textAlign='right';
    if(c.sort!==false){
      if(st.k===c.k) h.appendChild(el('span','ar', st.dir<0?' ▼':' ▲'));
      h.onclick=()=>{ host._sort=(st.k===c.k)?{k:c.k,dir:-st.dir}:{k:c.k,dir:-1};
        buildTable(host,cols,rows,opts); };
    }
    tr.appendChild(h);
  });
  th.appendChild(tr); t.appendChild(th);
  let data=rows.slice();
  if(st.k) data.sort((a,b)=>{ let x=a[st.k],y=b[st.k];
    if(typeof x==='string'||typeof y==='string'){ x=String(x==null?'':x); y=String(y==null?'':y);
      return st.dir*(x<y?-1:x>y?1:0); }
    x=isFinite(x)?x:-Infinity; y=isFinite(y)?y:-Infinity; return st.dir*(x-y); });
  const tb=el('tbody');
  data.slice(0,opts.limit||2000).forEach(r=>{
    const row=el('tr');
    cols.forEach(c=>{
      const td=el('td', c.cls||(c.num?'right':''));
      const v=c.f?c.f(r):r[c.k];
      const sink=c.cls==='name'?td.appendChild(el('span')):td;
      if(v instanceof Node) sink.appendChild(v);
      else if(c.html) sink.innerHTML=v==null?'':v;
      else sink.textContent=v==null?'':v;
      if(c.color){ const cc=c.color(r); if(cc) td.style.color='var(--'+cc+')'; }
      if(c.cls==='name'&&td.textContent) td.title=td.textContent;
      row.appendChild(td);
    });
    if(opts.rowCls){ const rc=opts.rowCls(r); if(rc) row.classList.add(rc); }
    tb.appendChild(row);
  });
  t.appendChild(tb);
  if(opts.foot){ const tf=el('tfoot'), fr=el('tr');
    cols.forEach(c=>{ const td=el('td',c.num?'right':''); const v=opts.foot(c,data);
      if(v!=null){ if(c.html) td.innerHTML=v; else td.textContent=v; } fr.appendChild(td); });
    tf.appendChild(fr); t.appendChild(tf); }
  wrap.appendChild(t); host.appendChild(wrap);
  if(data.length>(opts.limit||2000)) host.appendChild(el('div','small muted','（先頭'+(opts.limit||2000)+'件のみ表示）'));
  if(!data.length) host.appendChild(el('div','small muted','該当データがありません。'));
}
function dlCSV(name,cols,rows){
  const head=cols.map(c=>c.t).join(',');
  const body=rows.map(r=>cols.map(c=>{
    let v=c.raw?c.raw(r):(c.f?c.f(r):r[c.k]);
    if(v instanceof Node) v=v.textContent;
    v=v==null?'':String(v).replace(/<[^>]+>/g,'');
    return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;
  }).join(',')).join('\n');
  const blob=new Blob(['﻿'+head+'\n'+body],{type:'text/csv'});
  const a=el('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),3000);
}
function noteBox(html,cls){ const n=el('div','note'+(cls?' '+cls:'')); n.innerHTML=html; return n; }
function ul(list){ const u=el('ul'); u.style.margin='4px 0 0'; u.style.paddingLeft='18px';
  list.forEach(t=>{ const li=el('li'); li.innerHTML=t; u.appendChild(li); }); return u; }

/* =========================================================================
   ダッシュボード
   ========================================================================= */
function renderDash(){
  const di=$('#dgDate');
  if(!di.value) di.value = AGG.dates.length? addDays(AGG.dates[AGG.dates.length-1],1) : ymd(new Date());
  const today=di.value;
  const M=morningPlan(today);

  const env=$('#dgEnv'); env.innerHTML='';
  const w=el('span','row'); w.style.gap='8px';
  w.appendChild(el('span','small muted','本日：'));
  w.appendChild(dtypeChip(today));
  w.appendChild(el('span','chip',DOWJ[dow(today)]+'曜日'));
  w.appendChild(el('span','chip','推奨上限 '+yen(M.cap)));
  env.appendChild(w);

  /* --- 最上段：危険度と最重要の指示 --- */
  const main=$('#dgMain'); main.innerHTML='';
  const lvl = M.level==='warn'?'bad':M.level==='ok'?'ok':'none';
  const box=el('div','card'); box.style.padding='0'; box.style.overflow='hidden';
  const bar=el('div','risk '+lvl); bar.style.borderRadius='10px'; bar.style.margin='0';
  const L=el('div'); L.style.minWidth='190px';
  L.appendChild(el('div','lvl', M.levelName));
  L.appendChild(el('div','score','20円広告の危険度（前日確定値から）'));
  const st=el('div'); st.style.marginTop='8px';
  st.innerHTML='<div class="small">本日の開始予算</div><div style="font-size:24px;font-weight:800;font-variant-numeric:tabular-nums">'+yen(M.start)+'</div>';
  L.appendChild(st);
  bar.appendChild(L);
  const W=el('div','why');
  const hd=el('div'); hd.innerHTML='<b>判定理由</b>'; W.appendChild(hd);
  W.appendChild(ul(M.reasons));
  bar.appendChild(W);
  box.appendChild(bar); main.appendChild(box);

  /* --- タイル --- */
  const T=$('#dgTiles'); T.innerHTML='';
  T.appendChild(tile('本日の推奨上限', yen(M.cap),
    dtLabel(M.dtype)+'／絶対上限ではありません。好調時は理由付きで超過提案します。'));
  T.appendChild(tile('開始予算（提案）', yen(M.start),
    (M.level==='warn'?'強警戒のため上限の'+CFG.startWarn+'%':'上限の'+CFG.startNormal+'%')+'／'+num(CFG.unit)+'円単位'));
  T.appendChild(tile('前日の20円ROAS', pct(M.prevRoas,0),
    M.prev? ('前日 '+M.prev+'（'+dtLabel(dayType(M.prev))+'）／理想 '+CFG.goalRoas+'%・防衛 '+CFG.defRoas+'%') : '前日データなし',
    roasCls(M.prevRoas)));
  T.appendChild(tile('前日の20円実績額', yen(M.prevCost),
    '警戒基準 '+yen(CFG.warnCost)+' 以上で強警戒',
    M.hitCost?'bad':null));

  /* --- 運転プラン --- */
  const pl=$('#dgPlan'); pl.innerHTML='';
  const mk=(t,b)=>{ const q=el('div','stepline'); q.appendChild(el('div','t',t));
    const bb=el('div','b'); bb.innerHTML=b; q.appendChild(bb); return q; };
  pl.appendChild(mk('開始','<span class="amt">'+yen(M.start)+'</span> を設定。1日分をここで入れません。'));
  const sh=[['9:30','s0930'],['15:00','s1500'],['18:30','s1830']];
  sh.forEach(([lb,key])=>{
    const s=slotShare(key,M.dtype);
    const amt=M.planTotal*s.pct/100;
    pl.appendChild(mk(lb+' 再判定',
      'この時刻までの想定消化 <span class="amt">'+yen(amt)+'</span>（進捗 '+pct(s.pct,0)+'／'+s.label+'）<br>'+
      '<span class="small muted">'+(key==='s0930'?'初動を確認。維持／'+num(CFG.unit)+'円単位で追加／追加せず予算切れ許容 を判断。'
        :key==='s1500'?'最重要の中間判定。9:30→15:00の増え方から「追加／維持／18:30まで意図的停止」を判断。'
        :'夜間需要に向けた最終投入。残りの推奨上限と当日の消化状態から追加額を提案。')+'</span>'));
  });
  const ns=nightShare();
  pl.appendChild(mk('夜の需要','18:30以降の注文シェアは <span class="amt">'+pct(ns.v,1)+'</span>（'+ns.src+'）'));
  pl.appendChild(mk('本日の想定総額','<span class="amt">'+yen(M.planTotal)+'</span>'+
    (M.level==='warn'?'（強警戒のため推奨上限の'+CFG.cutRate+'%に抑制）':'（推奨上限どおり）')));
  if(M.level==='warn') pl.appendChild(noteBox(
    '強警戒の日は、<b>18:30まで意図的に予算切れ・停止を継続すること</b>が正式な推奨状態です。予算切れは失敗ではありません。'));

  /* --- 前日までの20円広告 --- */
  const pv=$('#dgPrev'); pv.innerHTML='';
  if(!M.prev) pv.innerHTML='<div class="small muted">前日のデータがありません。</div>';
  else{
    const P=AGG.day[M.prev];
    const kv=(k,v,cls)=>{ const q=el('div','kpi2'); q.appendChild(el('div','',k));
      const b=el('b'); b.textContent=v; if(cls) b.style.color='var(--'+cls+')'; q.appendChild(b); return q; };
    pv.appendChild(kv('前日の20円ROAS（判定に使う指標）', pct(P.roas20,0), roasCls(P.roas20)));
    pv.appendChild(kv('前日の20円実績額', yen(P.c20a), P.c20a>=+CFG.warnCost?'bad':null));
    pv.appendChild(kv('前日の20円CVR', pct(P.cvr20,2)));
    pv.appendChild(kv('前日の20円 平均CPC', isFinite(P.cpc20)?P.cpc20.toFixed(1)+'円':'—'));
    const sep=el('hr','sep'); pv.appendChild(sep);
    pv.appendChild(kv('［参考］KW ROAS', pct(P.roasKw,0)));
    pv.appendChild(kv('［参考］RPP全体ROAS', pct(P.roasAll,0)));
    pv.appendChild(kv('［参考］KW実績額', yen(P.kwa)));
    const l7=lastN(today,7).map(d=>AGG.day[d]);
    if(l7.length){
      const t=el('div'); t.style.marginTop='10px';
      t.appendChild(el('div','small muted','直近7日の20円ROAS'));
      const bars=el('div'); bars.style.display='grid'; bars.style.gap='3px'; bars.style.marginTop='4px';
      l7.forEach(D=>{
        const r=el('div'); r.style.display='grid'; r.style.gridTemplateColumns='70px 1fr 58px 74px';
        r.style.gap='8px'; r.style.alignItems='center';
        r.appendChild(el('div','small mono', D.date.slice(5)+'('+DOWJ[dow(D.date)]+')'));
        const m=el('div','mini'); const i=el('i');
        i.style.width=Math.min(100,(D.roas20/800*100))+'%';
        i.style.background='var(--'+roasCls(D.roas20)+')'; m.appendChild(i); r.appendChild(m);
        const rr=el('div','small mono right',pct(D.roas20,0)); rr.style.color='var(--'+roasCls(D.roas20)+')';
        rr.style.fontWeight='700'; r.appendChild(rr);
        r.appendChild(el('div','small mono right',yen(D.c20a)));
        bars.appendChild(r);
      });
      t.appendChild(bars);
      t.appendChild(el('div','small muted','棒＝20円ROAS（右端は20円実績額）'));
      pv.appendChild(t);
    }
    pv.appendChild(noteBox('本ツールの判定指標は<b>20円ROAS</b>です。KW ROASとRPP全体ROASは参考表示で、判定には使いません。','blue'));
  }

  /* --- 翌日の仮プラン --- */
  const dr=$('#dgDraft'); dr.innerHTML='';
  const D=tomorrowDraft(today);
  const box2=el('div','reason'); box2.appendChild(ul(D.notes)); dr.appendChild(box2);
}
