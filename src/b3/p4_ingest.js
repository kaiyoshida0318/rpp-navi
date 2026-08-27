/* =========================================================================
   取込エンジン（第2版）
   ========================================================================= */
function logLine(msg,cls){
  const L=$('#log'); if(L.textContent==='待機中…') L.textContent='';
  const s=el('span',cls||''); s.textContent=msg+'\n'; L.appendChild(s); L.scrollTop=L.scrollHeight;
}
function blankItem(){ return {ic:0,ia:0,is12:0,io12:0,is720:0,io720:0,
                              kc:0,ka:0,ks12:0,ko12:0,ks720:0,ko720:0,bid:null,kwn:0}; }
function ensureDay(d){ if(!DB.days[d]) DB.days[d]={items:{},total:null,src:{}}; return DB.days[d]; }

function detectKind(rows){
  const flat=rows.slice(0,40).map(r=>r.map(c=>String(c).trim()));
  const has=k=>flat.some(r=>r.some(c=>c===k));
  // CPC設定表：日次実績ではなく設定のスナップショット
  if(has('コントロールカラム')&&has('商品CPC')&&has('キーワードCPC')&&!has('クリック数(合計)')) return 'cpcset';
  if(has('コントロールカラム')&&has('キーワード')) return 'kw';
  if(has('コントロールカラム')&&has('商品管理番号')&&has('入札単価')) return 'item';
  if(has('日付')&&(has('割引後実績額')||(has('CPC実績(合計)')&&!has('商品管理番号')))) return 'daily';
  if(has('商品管理番号')&&has('売上件数')&&(has('平均単価')||has('売上点数'))) return 'sales';
  return null;
}

const IMP={files:0,item:0,kw:0,daily:0,sales:0,hourly:0,watch:0,cpcset:0,events:0,skipped:0,errors:0,dates:null};

async function ingestFile(name, buf){
  const low=name.toLowerCase();
  if(low.endsWith('.zip')){
    let inner;
    try{ inner=await unzip(buf.buffer?buf.buffer:buf); }
    catch(e){ logLine('  × ZIP展開失敗: '+name+' — '+e.message,'e'); IMP.errors++; return; }
    for(const f of inner) await ingestFile(f.name, f.data);
    return;
  }
  if(low.endsWith('.xlsx')||low.endsWith('.xls')){
    try{ await ingestXlsx(name, buf.buffer?buf.buffer:buf); }
    catch(e){ logLine('  × XLSX読込失敗: '+name+' — '+e.message,'e'); IMP.errors++; }
    return;
  }
  if(!/\.(csv|tsv|txt)$/.test(low)) return;
  const text=safeDecode(buf);
  // イベント日程テキストの判定は厳密に。商品名に「マラソン」等が入る売上CSVを誤検出しないこと。
  const EVLINE=/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})\s*[～~\-]\s*(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})/;
  if(EVLINE.test(text) && !/商品管理番号/.test(text) && !/コントロールカラム/.test(text)){
    ingestEvents(text,name); return; }
  const rows=parseCSV(text);
  const kind=detectKind(rows);
  if(!kind){ logLine('  ? 種別不明のためスキップ: '+name,'w'); IMP.skipped++; return; }
  const fileDate=normDate(name.replace(/^.*[\/\\]/,''));
  try{
    if(kind==='item')       ingestItem(rows,name,fileDate);
    else if(kind==='kw')    ingestKw(rows,name,fileDate);
    else if(kind==='daily') ingestDaily(rows,name,fileDate);
    else if(kind==='sales') ingestSales(rows,name,fileDate);
    else if(kind==='cpcset')ingestCpcSet(rows,name,fileDate);
  }catch(e){ logLine('  × 取込エラー: '+name+' — '+e.message,'e'); IMP.errors++; }
}

let DUPMODE='over';
function execStamp(rows){
  for(const r of rows.slice(0,10)) for(const c of r){
    const m=String(c).match(/実行日時[:：]\s*(\d{4}[-\/]\d{2}[-\/]\d{2}[ T]\d{2}:\d{2}(:\d{2})?)/);
    if(m) return m[1].replace(/\//g,'-');
  }
  return null;
}
function dupOK(day,slot,name,stamp){
  const d=ensureDay(day); const prev=d.src[slot];
  if(!prev) return true;
  if(DUPMODE==='skip'){ IMP.skipped++; logLine('  – 既取込のためスキップ: '+day+' '+slot,'w'); return false; }
  const ps=d.src[slot+'_stamp'];
  if(stamp&&ps&&stamp<ps){ IMP.skipped++;
    logLine('  – 既存(実行日時 '+ps+')より古い書き出しのため採用せず: '+day,'w'); return false; }
  return true;
}

/* --- 商品別RPPレポート --- */
function ingestItem(rows,name,fileDate){
  const t=tableFrom(rows,['コントロールカラム','商品管理番号','入札単価']);
  if(!t) throw new Error('ヘッダー行を検出できません');
  const stamp=execStamp(rows), byDate={};
  for(const r of t.rows){ const d=normDate(r['日付'])||fileDate; if(!d) continue;
    (byDate[d]=byDate[d]||[]).push(r); }
  for(const d in byDate){
    if(!dupOK(d,'item',name,stamp)) continue;
    const day=ensureDay(d);
    for(const c in day.items){ const it=day.items[c];
      it.ic=0;it.ia=0;it.is12=0;it.io12=0;it.is720=0;it.io720=0;it.bid=null; }
    for(const r of byDate[d]){
      const code=String(r['商品管理番号']||'').trim(); if(!code) continue;
      const it=day.items[code]=day.items[code]||blankItem();
      it.ic+=toNum(r['クリック数(合計)']); it.ia+=toNum(r['実績額(合計)']);
      it.is12+=toNum(r['売上金額(合計12時間)']); it.io12+=toNum(r['売上件数(合計12時間)']);
      it.is720+=toNum(r['売上金額(合計720時間)']); it.io720+=toNum(r['売上件数(合計720時間)']);
      const b=toNum(r['入札単価']); if(b) it.bid=b;
    }
    day.src.item=name; day.src.item_stamp=stamp; IMP.item++; IMP.dates.add(d);
    logLine('  ✓ 商品別 '+d+' ('+byDate[d].length+'行'+(stamp?' / 実行日時 '+stamp:'')+')','s');
  }
}
/* --- キーワード別RPPレポート --- */
function ingestKw(rows,name,fileDate){
  const t=tableFrom(rows,['コントロールカラム','キーワード']);
  if(!t) throw new Error('ヘッダー行を検出できません');
  const stamp=execStamp(rows), byDate={};
  for(const r of t.rows){ const d=normDate(r['日付'])||fileDate; if(!d) continue;
    (byDate[d]=byDate[d]||[]).push(r); }
  for(const d in byDate){
    if(!dupOK(d,'kw',name,stamp)) continue;
    const day=ensureDay(d);
    for(const c in day.items){ const it=day.items[c];
      it.kc=0;it.ka=0;it.ks12=0;it.ko12=0;it.ks720=0;it.ko720=0;it.kwn=0; }
    for(const r of byDate[d]){
      const code=String(r['商品管理番号']||'').trim(); if(!code) continue;
      const it=day.items[code]=day.items[code]||blankItem();
      it.kc+=toNum(r['クリック数(合計)']); it.ka+=toNum(r['実績額(合計)']);
      it.ks12+=toNum(r['売上金額(合計12時間)']); it.ko12+=toNum(r['売上件数(合計12時間)']);
      it.ks720+=toNum(r['売上金額(合計720時間)']); it.ko720+=toNum(r['売上件数(合計720時間)']);
      it.kwn++;
    }
    day.src.kw=name; day.src.kw_stamp=stamp; IMP.kw++; IMP.dates.add(d);
    logLine('  ✓ KW別 '+d+' ('+byDate[d].length+'行)','s');
  }
}
/* --- RPP全体日次レポート（照合用） --- */
function ingestDaily(rows,name,fileDate){
  const t=tableFrom(rows,['日付','クリック数(合計)']);
  if(!t) throw new Error('ヘッダー行を検出できません');
  const stamp=execStamp(rows);
  for(const r of t.rows){
    const d=normDate(r['日付'])||fileDate; if(!d) continue;
    if(!dupOK(d,'daily',name,stamp)) continue;
    const day=ensureDay(d);
    day.total={ clicks:toNum(r['クリック数(合計)']), cost:toNum(r['実績額(合計)']),
      sales720:toNum(r['売上金額(合計720時間)']), orders720:toNum(r['売上件数(合計720時間)']),
      disc:r['割引後実績額'] };
    day.src.daily=name; day.src.daily_stamp=stamp; IMP.daily++; IMP.dates.add(d);
  }
  logLine('  ✓ 全体日次 '+name.replace(/^.*[\/\\]/,''),'s');
}
/* --- 商品売上データ（商品名補完） --- */
function ingestSales(rows,name,fileDate){
  const t=tableFrom(rows,['商品管理番号','売上件数']);
  if(!t) throw new Error('ヘッダー行を検出できません');
  let d=fileDate;
  if(!d) for(const r of rows.slice(0,12)){ const j=r.join(' '); const n=normDate(j);
    if(n&&/表示期間|期間/.test(j)){ d=n; break; } }
  if(!d){ logLine('  ? 日付が特定できずスキップ: '+name,'w'); IMP.skipped++; return; }
  const m=DB.sales[d]={};
  for(const r of t.rows){
    const code=String(r['商品管理番号']||'').trim(); if(!code) continue;
    const nm=r['商品名']||''; if(nm) DB.names[code]=nm;
    m[code]={ name:nm, price:toNum(r['平均単価']), qty:toNum(r['売上点数']),
              amount:toNum(r['売上']), orders:toNum(r['売上件数']) };
  }
  IMP.sales++; logLine('  ✓ 商品売上 '+d+' ('+t.rows.length+'商品)','s');
}
/* --- CPC設定表（rpp_item_keyword）：広告区分の確定判定 --- */
function ingestCpcSet(rows,name,fileDate){
  const t=tableFrom(rows,['コントロールカラム','商品管理番号','商品CPC']);
  if(!t) throw new Error('ヘッダー行を検出できません');
  const agg={};
  for(const r of t.rows){
    const code=String(r['商品管理番号']||'').trim(); if(!code) continue;
    const o=agg[code]=agg[code]||{itemCpc:null,kwCount:0,maxKwCpc:0,price:0,date:fileDate||null};
    const ic=toNum(r['商品CPC']); if(ic) o.itemCpc=ic;
    const p=toNum(r['価格']); if(p) o.price=p;
    const kw=String(r['キーワード']||'').trim();
    const kc=toNum(r['キーワードCPC'])||toNum(r['目安CPC']);
    if(kw){ o.kwCount++; if(kc>o.maxKwCpc) o.maxKwCpc=kc; }
    const nm=r['商品名']||''; if(nm) DB.names[code]=nm;
  }
  Object.keys(agg).forEach(c=>DB.cpcSet[c]=agg[c]);
  IMP.cpcset++;
  logLine('  ✓ CPC設定表 '+(fileDate||'')+'（'+Object.keys(agg).length+'商品／広告区分を確定判定に使用）','s');
}

/* --- イベント日程テキスト（例：5/9 20:00 ～ 5/16 1:59, お買い物マラソン） --- */
function ingestEvents(text,name){
  const yM=text.match(/(20\d{2})\s*年/); const year=yM?+yM[1]:new Date().getFullYear();
  let n=0;
  text.split(/\r?\n/).forEach(line=>{
    const m=line.match(/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})\s*[～~\-]\s*(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})/);
    if(!m) return;
    const type=/スーパー\s*SALE/i.test(line)?'supersale':/マラソン/.test(line)?'marathon':'other';
    const p=x=>String(x).padStart(2,'0');
    const from=year+'-'+p(m[1])+'-'+p(m[2]), to=year+'-'+p(m[5])+'-'+p(m[6]);
    const fromTime=p(m[3])+':'+m[4], toTime=p(m[7])+':'+m[8];
    if(DB.events.some(e=>e.from===from&&e.to===to&&e.type===type)) return;
    DB.events.push({type,from,fromTime,to,toTime,memo:''});
    n++;
  });
  if(n){ IMP.events+=n; logLine('  ✓ イベント日程 '+n+'件を登録','s'); }
  else { logLine('  ? イベント行を検出できません: '+name,'w'); IMP.skipped++; }
}

/* --- XLSX：注文時間帯 or 当日時間別記録 --- */
async function ingestXlsx(name, ab){
  const sheets=await readXlsx(ab);
  for(const sh of sheets){ if(tryHourlyOrders(name,sh)) return; }
  for(const sh of sheets){ if(tryWatchLog(name,sh)) return; }
  logLine('  ? 想定した表が見つかりません: '+name,'w'); IMP.skipped++;
}
function tryHourlyOrders(name,sh){
  const g=sh.grid;
  let hi=-1,ci=-1,ni=-1;
  for(let i=0;i<Math.min(g.length,20);i++){
    const r=g[i]||[];
    const h=r.findIndex(c=>String(c||'').trim()==='時間');
    const n=r.findIndex(c=>/^(件数|全体件数|注文件数)$/.test(String(c||'').trim()));
    if(h>=0&&n>=0){ hi=i; ci=h; ni=n; break; }
  }
  if(hi<0) return false;
  const counts=new Array(24).fill(0); let any=false;
  for(let i=hi+1;i<g.length;i++){
    const r=g[i]||[]; const hv=String(r[ci]||'').trim();
    if(!/^\d+$/.test(hv)) continue;
    const h=+hv; if(h<0||h>23) continue;
    counts[h]=toNum(r[ni]); any=true;
  }
  if(!any) return false;
  const total=counts.reduce((a,b)=>a+b,0);
  DB.hourly={counts,total,label:name.replace(/^.*[\/\\]/,'')+' / '+sh.name};
  IMP.hourly++; logLine('  ✓ 注文時間帯 '+sh.name+' (合計'+num(total)+'件)','s');
  return true;
}
/** 当日時間別記録：横持ち（行＝日付、列＝時間ブロック×[実績額/cl数/平均CPC]）
 *  実績額セルがグレー塗り＝予算上限到達として読み取る。
 *  取込は「入力層」として分離してあり、将来の画像取込も applyObs() に流し込めば同じ形になる。 */
function tryWatchLog(name,sh){
  const g=sh.grid, F=sh.fills||[];
  let sub=-1;
  for(let i=0;i<Math.min(g.length,12);i++){
    const r=g[i]||[];
    if(r.some(c=>String(c||'').replace(/\s/g,'')==='実績額')){ sub=i; break; }
  }
  if(sub<0) return false;
  const head=g[sub]||[], top=g[sub-1]||[];
  const blocks=[];
  head.forEach((c,ci)=>{
    if(String(c||'').replace(/\s/g,'')!=='実績額') return;
    let label='';
    for(let k=ci;k>=0;k--){ const v=String(top[k]||'').trim(); if(v){ label=v; break; } }
    blocks.push({ci, label, clk:-1, cpc:-1});
  });
  if(!blocks.length) return false;
  blocks.forEach((b,bi)=>{
    const end=bi+1<blocks.length?blocks[bi+1].ci:head.length;
    for(let k=b.ci+1;k<end;k++){
      const v=String(head[k]||'').replace(/\s/g,'');
      if(/^(cl数|クリック数?|クリック)$/.test(v)) b.clk=k;
      else if(/^(平均CPC|CPC)$/.test(v)) b.cpc=k;
    }
    b.hour=labelToHour(b.label);
  });
  let dcol=0,best=-1;
  for(let c=0;c<blocks[0].ci;c++){
    let n=0;
    for(let i=sub+1;i<g.length;i++){ const v=(g[i]||[])[c];
      if(v!=null&&v!==''&&(excelDate(v)||normDate(String(v)))) n++; }
    if(n>best){ best=n; dcol=c; }
  }
  if(best<=0) return false;
  let added=0, capped=0, fin=0;
  for(let i=sub+1;i<g.length;i++){
    const row=g[i]||[], fr=F[i]||[];
    const raw=row[dcol]; if(raw==null||raw==='') continue;
    const d=excelDate(raw)||normDate(String(raw)); if(!d) continue;
    for(const b of blocks){
      const cost=toNum(row[b.ci]);
      if(!cost) continue;                       // 未入力は「未観測」。0にはしない
      const clicks=b.clk>=0?toNum(row[b.clk]):0;
      let cpc=b.cpc>=0?toNum(row[b.cpc]):0;
      if(!cpc&&clicks>0) cpc=cost/clicks;
      const cap=isGreyFill(fr[b.ci]); if(cap) capped++;
      if(b.hour>=23.5){ fin++; }
      applyObs({date:d, hour:b.hour, cost, clicks, cpc:cpc||null,
                budget:null, capped:cap, note:b.label, src:'xlsx'});
      added++;
    }
  }
  if(!added) return false;
  IMP.watch++;
  logLine('  ✓ 当日時間別記録 '+sh.name+'（'+added+'件／時間ブロック '
    +blocks.map(b=>b.label+'→'+slotOf(b.hour).label).join('・')
    +'／予算上限到達（グレー）'+capped+'件／日次締め'+fin+'件）','s');
  return true;
}
/** 観測を1件保存する共通入口。手入力・XLSX・将来の画像取込はすべてここを通す。 */
function applyObs(o){
  const sl=slotOf(o.hour);
  const rec={ date:o.date, slot:sl.key, slotLabel:sl.label, hour:o.hour,
    time:o.time||fmtHour(o.hour),
    clicks:o.clicks||0, cost:o.cost||0, cpc:o.cpc|| (o.clicks>0?o.cost/o.clicks:null),
    budget:o.budget!=null?o.budget:null, capped:!!o.capped,
    note:o.note||'', src:o.src||'manual', ts:Date.parse(o.date+'T00:00:00')+o.hour*3600000 };
  DB.obs=DB.obs.filter(x=>!(x.date===rec.date && x.slot===rec.slot && x.src===rec.src));
  DB.obs.push(rec);
  return rec;
}
/** "9時半頃" → 9.5 ／ "19時頃" → 19 ／ "0時" → 24（その日の締め） */
function labelToHour(s){
  s=String(s||'');
  const m=s.match(/(\d{1,2})\s*時/);
  let h=m?+m[1]:NaN;
  if(!isFinite(h)){ const m2=s.match(/(\d{1,2})[:：](\d{2})/); if(m2) return +m2[1]+(+m2[2])/60; return 12; }
  if(/半/.test(s)) h+=0.5;
  if(h===0) h=24;   // 0時＝その日の最終値
  return h;
}

async function ingestAll(fileList){
  Object.keys(IMP).forEach(k=>{ if(k!=='dates') IMP[k]=0; });
  IMP.dates=new Set();
  DUPMODE = $('#dupSkip').classList.contains('on') ? 'skip':'over';
  logLine('── 取込開始 ('+fileList.length+'件) ──');
  for(const f of fileList){
    IMP.files++;
    logLine('▸ '+(f.webkitRelativePath||f.name));
    try{ const ab=await f.arrayBuffer(); await ingestFile(f.name,new Uint8Array(ab)); }
    catch(e){ logLine('  × '+e.message,'e'); IMP.errors++; }
  }
  logLine('── 完了：商品別'+IMP.item+' / KW別'+IMP.kw+' / 全体'+IMP.daily+' / 売上'+IMP.sales
    +' / CPC設定'+IMP.cpcset+' / 当日記録'+IMP.watch+' / 時間帯'+IMP.hourly
    +' / イベント'+IMP.events+' / スキップ'+IMP.skipped+' / エラー'+IMP.errors+' ──','s');
  await saveAll();
  rebuild(); renderAll();
  toast('取込完了：'+IMP.dates.size+'日分を更新しました');
}

/* =========================================================================
   正規化・集計
   20円側 = 商品別レポート − KW別レポート（実データで検証済み）
   ========================================================================= */
let AGG={dates:[], day:{}, itemKind:{}, warn:[], missing:[], months:{}};

function attrKeys(){ return ATTR==='12'
  ? {is:'is12',io:'io12',ks:'ks12',ko:'ko12'}
  : {is:'is720',io:'io720',ks:'ks720',ko:'ko720'}; }

function rebuild(){
  const K=attrKeys();
  AGG={dates:[], day:{}, itemKind:{}, warn:[], missing:[], months:{}};
  AGG.dates=Object.keys(DB.days).filter(d=>Object.keys(DB.days[d].items).length).sort();

  /* 広告区分：CPC設定表があれば確定、無ければKWレポートへの出現で自動判定 */
  const kwSeen={}, adSeen={};
  for(const d of AGG.dates){ const it=DB.days[d].items;
    for(const c in it){ adSeen[c]=1; if(it[c].kwn>0||it[c].kc>0) kwSeen[c]=1; } }
  const codes=new Set([...Object.keys(adSeen), ...Object.keys(DB.names), ...Object.keys(DB.cpcSet)]);
  codes.forEach(c=>{
    const s=DB.cpcSet[c];
    if(s){ AGG.itemKind[c] = s.kwCount>0 ? 'kw' : (s.itemCpc>0 ? 'c20' : 'none'); return; }
    AGG.itemKind[c] = kwSeen[c] ? 'kw' : (adSeen[c] ? 'c20' : 'none');
  });

  for(const d of AGG.dates){
    const src=DB.days[d].items, items={};
    let T={c20c:0,c20a:0,c20s:0,c20o:0, kwc:0,kwa:0,kws:0,kwo:0, allc:0,alla:0,alls:0,allo:0,
           lowEffCost:0, zeroCost:0, n:0};
    for(const code in src){
      const r=src[code];
      const c20c=r.ic-r.kc, c20a=r.ia-r.ka, c20s=r[K.is]-r[K.ks], c20o=r[K.io]-r[K.ko];
      if(c20a<-0.5||c20c<-0.5)
        AGG.warn.push(d+' '+code+'：KW別の値が商品別を上回っています。列仕様をご確認ください（推測で補正はしていません）。');
      const o={ code, kind:AGG.itemKind[code]||'c20', bid:r.bid,
        c20c:Math.max(0,c20c), c20a:Math.max(0,c20a), c20s:Math.max(0,c20s), c20o:Math.max(0,c20o),
        kwc:r.kc, kwa:r.ka, kws:r[K.ks], kwo:r[K.ko],
        allc:r.ic, alla:r.ia, alls:r[K.is], allo:r[K.io] };
      o.roas20=roas(o.c20s,o.c20a); o.roasKw=roas(o.kws,o.kwa); o.roasAll=roas(o.alls,o.alla);
      o.cvr20=cvr(o.c20o,o.c20c); o.cvrKw=cvr(o.kwo,o.kwc);
      o.cpc20=o.c20c>0?o.c20a/o.c20c:NaN;
      items[code]=o;
      T.c20c+=o.c20c;T.c20a+=o.c20a;T.c20s+=o.c20s;T.c20o+=o.c20o;
      T.kwc+=o.kwc;T.kwa+=o.kwa;T.kws+=o.kws;T.kwo+=o.kwo;
      T.allc+=o.allc;T.alla+=o.alla;T.alls+=o.alls;T.allo+=o.allo;
      if(o.c20a>0){ T.n++;
        if(!isFinite(o.roas20)||o.roas20<CFG.lowEffRoas) T.lowEffCost+=o.c20a;
        if(o.c20s<=0) T.zeroCost+=o.c20a;
      }
    }
    T.roas20=roas(T.c20s,T.c20a); T.roasKw=roas(T.kws,T.kwa); T.roasAll=roas(T.alls,T.alla);
    T.cvr20=cvr(T.c20o,T.c20c); T.cvrKw=cvr(T.kwo,T.kwc); T.cvrAll=cvr(T.allo,T.allc);
    T.lowEffRatio = T.c20a>0 ? T.lowEffCost/T.c20a*100 : NaN;
    T.cpa20 = T.c20o>0 ? T.c20a/T.c20o : NaN;
    T.cpaKw = T.kwo>0 ? T.kwa/T.kwo : NaN;
    T.cpc20 = T.c20c>0 ? T.c20a/T.c20c : NaN;
    AGG.day[d]={date:d, items, ...T, tag:DB.tags[d]||null, reported:DB.days[d].total||null,
                dtype:dayType(d)};
  }

  /* 欠損日：取込済みの最初〜最後の間で、データが無い日 */
  if(AGG.dates.length){
    const a=AGG.dates[0], b=AGG.dates[AGG.dates.length-1];
    for(let d=a; d<=b; d=addDays(d,1)) if(!AGG.day[d]) AGG.missing.push(d);
  }
}

/* 商品名（CPC設定表 → 売上データ の順で補完） */
function itemName(code){ return DB.names[code]||''; }
