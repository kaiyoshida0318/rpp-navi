<script>
"use strict";
/* =========================================================================
   楽天RPP 暴走検知・予算運用支援ツール
   - 外部ライブラリ・外部通信なし（ZIP/XLSXは自前実装、CP932はTextDecoder）
   - データはブラウザ内(IndexedDB/localStorage)に保存。外部送信は一切しない。
   ========================================================================= */

/* ---------------- utils ---------------- */
const $  = (s,r)=> (r||document).querySelector(s);
const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));
const el = (t,c,x)=>{const e=document.createElement(t); if(c)e.className=c; if(x!=null)e.textContent=x; return e;};
const yen = n=> (n==null||!isFinite(n))?'—':'¥'+Math.round(n).toLocaleString('ja-JP');
const num = n=> (n==null||!isFinite(n))?'—':Math.round(n).toLocaleString('ja-JP');
const pct = (n,d)=> (n==null||!isFinite(n))?'—':n.toFixed(d==null?1:d)+'%';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const toNum = v=>{ if(v==null) return 0; const s=String(v).replace(/[,¥￥\s%]/g,'').replace(/^-$/,'0');
  const n=parseFloat(s); return isFinite(n)?n:0; };
function median(a){ const b=a.filter(x=>isFinite(x)).slice().sort((x,y)=>x-y); if(!b.length) return NaN;
  const m=b.length>>1; return b.length%2?b[m]:(b[m-1]+b[m])/2; }
function mean(a){ const b=a.filter(x=>isFinite(x)); return b.length? b.reduce((s,x)=>s+x,0)/b.length : NaN; }
function ymd(d){ if(typeof d==='string') return d; const p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function parseDate(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function addDays(s,n){ const d=parseDate(s); d.setDate(d.getDate()+n); return ymd(d); }
function dow(s){ return parseDate(s).getDay(); }
const DOWJ=['日','月','火','水','木','金','土'];
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(t._t);
  t._t=setTimeout(()=>t.classList.remove('on'),2200); }
function roas(sales,cost){ return cost>0 ? sales/cost*100 : NaN; }
function cvr(orders,clicks){ return clicks>0 ? orders/clicks*100 : NaN; }

/* ---------------- ZIP (no library) ----------------
   central directory を読み、deflate は DecompressionStream('deflate-raw') で展開 */
async function inflateRaw(buf){
  if(typeof DecompressionStream==='undefined') throw new Error('このブラウザはZIP展開に非対応です（Chrome/Edge推奨）');
  const ds=new DecompressionStream('deflate-raw');
  const st=new Blob([buf]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(st).arrayBuffer());
}
function u16(v,o){return v.getUint16(o,true);} function u32(v,o){return v.getUint32(o,true);}
async function unzip(ab){
  const u=new Uint8Array(ab), v=new DataView(ab);
  let eo=-1;
  for(let i=u.length-22;i>=0 && i>u.length-66000;i--){ if(u32(v,i)===0x06054b50){eo=i;break;} }
  if(eo<0) throw new Error('ZIP形式ではありません');
  let cnt=u16(v,eo+10), cdo=u32(v,eo+16);
  // ZIP64
  if(cnt===0xffff || cdo===0xffffffff){
    for(let i=eo-20;i>=0;i--){ if(u32(v,i)===0x07064b50){ const off=Number(v.getBigUint64(i+8,true));
      if(u32(v,off)===0x06064b50){ cnt=Number(v.getBigUint64(off+32,true)); cdo=Number(v.getBigUint64(off+48,true)); } break; } }
  }
  const out=[]; let p=cdo;
  for(let i=0;i<cnt && p+46<=u.length;i++){
    if(u32(v,p)!==0x02014b50) break;
    const flag=u16(v,p+8), method=u16(v,p+10), csize=u32(v,p+20), usize=u32(v,p+24);
    const nl=u16(v,p+28), xl=u16(v,p+30), cl=u16(v,p+32);
    let lho=u32(v,p+42);
    const nameB=u.slice(p+46,p+46+nl);
    const name=(flag&0x800)? new TextDecoder('utf-8').decode(nameB) : safeDecode(nameB);
    // ZIP64 extra
    let cs=csize, us=usize;
    if(cs===0xffffffff||us===0xffffffff||lho===0xffffffff){
      let q=p+46+nl, end=q+xl;
      while(q+4<=end){ const id=u16(v,q), sz=u16(v,q+2); let r=q+4;
        if(id===0x0001){ if(us===0xffffffff){us=Number(v.getBigUint64(r,true));r+=8;}
          if(cs===0xffffffff){cs=Number(v.getBigUint64(r,true));r+=8;}
          if(lho===0xffffffff){lho=Number(v.getBigUint64(r,true));} }
        q+=4+sz; }
    }
    out.push({name,method,cs,us,lho});
    p+=46+nl+xl+cl;
  }
  const files=[];
  for(const f of out){
    if(f.name.endsWith('/')||/(^|\/)__MACOSX\//.test(f.name)||/(^|\/)\._/.test(f.name)) continue;
    const lv=new DataView(ab,f.lho);
    if(u32(lv,0)!==0x04034b50) continue;
    const nl=u16(lv,26), xl=u16(lv,28);
    const start=f.lho+30+nl+xl;
    const raw=u.slice(start,start+f.cs);
    let data;
    if(f.method===0) data=raw;
    else if(f.method===8) data=await inflateRaw(raw);
    else { console.warn('未対応の圧縮方式',f.method,f.name); continue; }
    files.push({name:f.name,data});
  }
  return files;
}

/* ---------------- 文字コード判定 ---------------- */
function safeDecode(bytes){
  if(bytes.length>=3 && bytes[0]===0xEF&&bytes[1]===0xBB&&bytes[2]===0xBF)
    return new TextDecoder('utf-8').decode(bytes.slice(3));
  try{ return new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch(e){ try{ return new TextDecoder('shift_jis').decode(bytes); }
            catch(e2){ return new TextDecoder('utf-8').decode(bytes); } }
}

/* ---------------- CSV ---------------- */
function parseCSV(text, delim){
  text=text.replace(/^﻿/,'');
  if(!delim){ const head=text.slice(0,4000);
    delim=( (head.split('\t').length-1) > (head.split(',').length-1) ) ? '\t' : ','; }
  const rows=[]; let row=[], f='', q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
    else if(c==='"') q=true;
    else if(c===delim){ row.push(f); f=''; }
    else if(c==='\r'){}
    else if(c==='\n'){ row.push(f); rows.push(row); row=[]; f=''; }
    else f+=c;
  }
  if(f!==''||row.length){ row.push(f); rows.push(row); }
  return rows;
}
/** 楽天CSVはヘッダーが1行目とは限らない。keysの語を含む行をヘッダーとして自動検出 */
function tableFrom(rows, keys){
  let hi=-1;
  for(let i=0;i<Math.min(rows.length,40);i++){
    const r=rows[i]; if(!r) continue;
    const set=r.map(x=>String(x).trim());
    if(keys.every(k=> set.some(c=>c===k || c.indexOf(k)===0))){ hi=i; break; }
  }
  if(hi<0) return null;
  const hdr=rows[hi].map(x=>String(x).trim());
  const out=[];
  for(let i=hi+1;i<rows.length;i++){
    const r=rows[i]; if(!r||r.every(c=>String(c).trim()==='')) continue;
    const o={}; for(let j=0;j<hdr.length;j++) o[hdr[j]]=r[j]!==undefined?String(r[j]).trim():'';
    out.push(o);
  }
  return {header:hdr, rows:out};
}
/** "2026年07月01日～2026年07月01日" / "2026/07/01" / "20260701" → YYYY-MM-DD */
function normDate(s){
  if(!s) return null; s=String(s);
  let m=s.match(/(\d{4})[年\/\-\.](\d{1,2})[月\/\-\.](\d{1,2})/);
  if(m) return m[1]+'-'+String(+m[2]).padStart(2,'0')+'-'+String(+m[3]).padStart(2,'0');
  m=s.match(/(20\d{2})(\d{2})(\d{2})/);
  if(m) return m[1]+'-'+m[2]+'-'+m[3];
  return null;
}

/* ---------------- XLSX (no library) ---------------- */
function colToIdx(ref){ const m=ref.match(/^([A-Z]+)/); if(!m) return 0; let n=0;
  for(const ch of m[1]) n=n*26+(ch.charCodeAt(0)-64); return n-1; }
/* 名前空間接頭辞（x: など）に依存せずタグを取得する */
const tags=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
async function readXlsx(ab){
  const files=await unzip(ab);
  const get=n=>files.find(f=>f.name===n||f.name.endsWith('/'+n));
  const dec=f=> f? new TextDecoder('utf-8').decode(f.data):'';
  const P=new DOMParser();
  // shared strings（ふりがな rPh は除外）
  let ss=[];
  const sf=get('xl/sharedStrings.xml');
  if(sf){ const d=P.parseFromString(dec(sf),'application/xml');
    ss=tags(d,'si').map(si=> tags(si,'t')
      .filter(t=>!(t.parentNode&&/rPh$/.test(t.parentNode.nodeName)))
      .map(t=>t.textContent).join('')); }
  // styles：cellXfs の fillId → fills の patternFill を引く
  let xfFill=[], fillDef=[];
  const st=get('xl/styles.xml');
  if(st){
    const d=P.parseFromString(dec(st),'application/xml');
    const fillsNode=tags(d,'fills')[0];
    if(fillsNode) tags(fillsNode,'fill').forEach(f=>{
      const pf=tags(f,'patternFill')[0];
      if(!pf){ fillDef.push(null); return; }
      const fg=tags(pf,'fgColor')[0];
      fillDef.push({pattern:pf.getAttribute('patternType')||'none',
        rgb:fg?fg.getAttribute('rgb'):null,
        theme:fg&&fg.getAttribute('theme')!=null?+fg.getAttribute('theme'):null,
        tint:fg&&fg.getAttribute('tint')!=null?+fg.getAttribute('tint'):0});
    });
    const cx=tags(d,'cellXfs')[0];
    if(cx) tags(cx,'xf').forEach(x=>xfFill.push(+(x.getAttribute('fillId')||0)));
  }
  const fillOf=sIdx=>{ if(sIdx==null) return null;
    const fid=xfFill[sIdx]; if(fid==null) return null; return fillDef[fid]||null; };
  // workbook sheet names
  const wb=get('xl/workbook.xml'); const names=[];
  if(wb){ const d=P.parseFromString(dec(wb),'application/xml');
    tags(d,'sheet').forEach(x=>names.push(x.getAttribute('name'))); }
  const sheets=[];
  const sheetFiles=files.filter(f=>/xl\/worksheets\/sheet\d+\.xml$/.test(f.name))
    .sort((a,b)=>(+a.name.match(/sheet(\d+)/)[1])-(+b.name.match(/sheet(\d+)/)[1]));
  sheetFiles.forEach((f,i)=>{
    const d=P.parseFromString(dec(f),'application/xml');
    const grid=[], fills=[];
    tags(d,'row').forEach(r=>{
      const ri=(+r.getAttribute('r')||grid.length+1)-1;
      const arr=grid[ri]=grid[ri]||[], far=fills[ri]=fills[ri]||[];
      tags(r,'c').forEach(c=>{
        const ci=colToIdx(c.getAttribute('r')||'A1'); const t=c.getAttribute('t');
        let v='';
        if(t==='inlineStr'){ const is=tags(c,'t'); v=is.length?is[0].textContent:''; }
        else { const vn=tags(c,'v'); v=vn.length?vn[0].textContent:'';
               if(t==='s') v=ss[+v]!==undefined?ss[+v]:''; }
        arr[ci]=v;
        const sA=c.getAttribute('s');
        far[ci]=fillOf(sA!=null?+sA:null);
      });
    });
    sheets.push({name:names[i]||('Sheet'+(i+1)), grid, fills});
  });
  return sheets;
}
/** セルの塗りが「グレー」か。当日時間別記録の予算上限到達セルの判定に使う。
 *  ヘッダーの薄いグレー（tint -0.05程度）や白は除外する。 */
function isGreyFill(f){
  if(!f || f.pattern!=='solid') return false;
  if(f.rgb){
    const c=String(f.rgb).slice(-6);
    const r=parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16);
    if(![r,g,b].every(x=>isFinite(x))) return false;
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
    return (mx-mn)<=20 && mx<246 && mx>55;
  }
  if(f.theme!=null) return (f.tint||0) <= -0.14;
  return false;
}
/** Excelのシリアル値 → YYYY-MM-DD */
function excelDate(v){
  const n=Number(v); if(!isFinite(n)||n<20000||n>80000) return null;
  const ms=Date.UTC(1899,11,30)+Math.round(n)*86400000;
  const d=new Date(ms);
  const p=x=>String(x).padStart(2,'0');
  return d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate());
}

/* ---------------- storage ---------------- */
const DBNAME='rpp_tool_v1';
const Store={
  mem:null,
  async open(){ return new Promise((res,rej)=>{ try{
      const rq=indexedDB.open(DBNAME,1);
      rq.onupgradeneeded=()=>{ rq.result.createObjectStore('kv'); };
      rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error);
    }catch(e){ rej(e); } }); },
  async get(k){
    try{ const db=await this.open(); return await new Promise((res,rej)=>{
      const t=db.transaction('kv','readonly').objectStore('kv').get(k);
      t.onsuccess=()=>res(t.result); t.onerror=()=>rej(t.error); });
    }catch(e){ try{ const s=localStorage.getItem(DBNAME+':'+k); return s?JSON.parse(s):undefined; }catch(e2){ return undefined; } }
  },
  async set(k,v){
    try{ const db=await this.open(); return await new Promise((res,rej)=>{
      const t=db.transaction('kv','readwrite').objectStore('kv').put(v,k);
      t.onsuccess=()=>res(true); t.onerror=()=>rej(t.error); });
    }catch(e){ try{ localStorage.setItem(DBNAME+':'+k,JSON.stringify(v)); return true; }catch(e2){
      toast('保存に失敗しました。JSON書出でバックアップしてください'); return false; } }
  }
};

/* ---------------- 設定（すべて画面から変更可能） ---------------- */
const CFG_DEF={
  /* 目標（20円広告ROAS） */
  goalRoas:   {v:400, g:'goal', n:'20円ROAS 理想目標(%)', d:'本ツールの対象は<b>全体CPC上限20円広告</b>です。KW ROASやRPP全体ROASは参考表示のみ。'},
  defRoas:    {v:300, g:'goal', n:'20円ROAS 防衛目標(%)', d:'暴走傾向を検知した日でも、この水準への着地を守ることを目標にします。'},
  badRoas:    {v:200, g:'goal', n:'20円ROAS 危険水準(%)', d:'これを下回った日は明確な失敗として扱います。'},

  /* 朝の警戒基準 v1 */
  warnCost:   {v:30000,g:'morn', n:'強警戒：前日の20円実績額(円)以上', d:'初期基準v1。5〜8月データで検証した値であり、<b>固定値ではありません</b>。変更したらバックテストで再検証してください。'},
  warnRoas:   {v:225, g:'morn', n:'強警戒：前日の20円ROAS(%)未満', d:'上の実績額条件と<b>OR</b>で判定します。'},
  startNormal:{v:45,  g:'morn', n:'開始予算：通常日の推奨上限に対する割合(%)', d:'朝に1日分を固定投入せず、9:30以降で再判定する前提の初期額。'},
  startWarn:  {v:30,  g:'morn', n:'開始予算：強警戒時の割合(%)', d:''},
  unit:       {v:5000,g:'morn', n:'予算の刻み(円)', d:'提案額はこの単位に丸めます。'},

  /* 日タイプ別の推奨上限 */
  capNormal:  {v:70000, g:'cap', n:'通常日の推奨上限(円)', d:'絶対上限ではありません。好調時は理由付きで超過提案します。'},
  capFive:    {v:90000, g:'cap', n:'5の倍数の推奨上限(円)', d:''},
  capSale:    {v:90000, g:'cap', n:'セールのみの推奨上限(円)', d:''},
  capSaleFive:{v:120000,g:'cap', n:'セール＋5の倍数の推奨上限(円)', d:''},
  capSaleLast:{v:70000, g:'cap', n:'セール最終日の推奨上限(円)', d:'最終日は午前中に終わることが多いため、他条件より<b>優先</b>して適用します。'},
  overRate:   {v:120, g:'cap', n:'上限超過提案の上限(%)', d:'好調と判断した場合に限り、推奨上限のこの割合まで超過提案を許します。理由の表示は必須です。'},

  /* 当日の逐次判定 */
  slotTol:    {v:0,   g:'day', n:'時刻枠の判定（0=既定枠を使う）', d:'既定枠は 9:00〜10:00／14:30〜15:30／18:00〜19:00。枠外の記録は最も近い枠に寄せ、信頼度を下げます。'},
  paceWarn:   {v:1.20,g:'day', n:'やや速いとみなす実績額の通常比', d:'同じ時刻枠・同じ日タイプの過去中央値との比。'},
  paceBad:    {v:1.50,g:'day', n:'異常に速いとみなす実績額の通常比', d:''},
  paceSlow:   {v:0.80,g:'day', n:'遅い（余力あり）とみなす通常比', d:''},
  clickWarn:  {v:1.30,g:'day', n:'やや多いとみなすクリックの通常比', d:'実績額と組み合わせて見ます。単独では警告しません。'},
  clickBad:   {v:1.60,g:'day', n:'異常に多いとみなすクリックの通常比', d:''},
  cutRate:    {v:60,  g:'day', n:'強警戒時の当日想定総額（推奨上限に対する%）', d:'強警戒の日は推奨上限そのものを絞って運転します。'},
  minSamples: {v:3,   g:'day', n:'同条件比較に必要な最低日数', d:'これ未満なら条件を緩め、<b>判定信頼度</b>を下げます。'},
  capExclude: {v:'day', g:'day', n:'予算上限に到達した日の扱い',
    d:'消化カーブは「その時刻までに、その日の最終額の何%を消化したか」で学習します。途中で予算が切れた日は、<b>切れた時刻がその枠より前なら観測値そのものが</b>、<b>後なら最終額が</b>抑えられるため、進捗率が過小にも過大にもぶれます（同梱データの18:30枠では56.8%〜85.4%とばらつきました）。<b>精度優先＝その日を丸ごと除外し、最後まで止まらずに回った日だけで水準を作る</b>。',
    opts:[['day','一度でも上限到達した日は除外（精度優先・推奨）'],['end','最後まで停止していた日だけ除外（サンプル優先）']]},
  overNeedConf:{v:1,  g:'day', n:'上限超過提案に高い信頼度を要求する',
    d:'推奨上限を超える提案は、比較の土台がしっかりしているときだけ出します。1=信頼度「低」のときは超過提案をしない。',
    opts:[['1','信頼度が低いときは超過提案しない（推奨）'],['0','信頼度に関わらず提案する']]},
  share930:   {v:25,  g:'day', n:'既定の消化配分：9:30までの累計(%)', d:'当日記録が貯まるまでの暫定値。記録が増えると実績から学習した値に切り替わります。'},
  share1500:  {v:55,  g:'day', n:'既定の消化配分：15:00までの累計(%)', d:''},
  share1830:  {v:72,  g:'day', n:'既定の消化配分：18:30までの累計(%)', d:''},
  nightShare: {v:0,   g:'day', n:'夜(18:30以降)の需要シェア(%)　0=注文時間帯データから自動', d:'注文時間帯データは全注文の分布であり、RPPの時間別CVRではありません。夜間需要の代理指標としてのみ使います。'},

  /* 4か月カレンダー */
  calRed:     {v:100, g:'cal', n:'赤にする20円ROAS(%)未満', d:'仕様書14章の固定表示条件。'},
  calGreen:   {v:300, g:'cal', n:'緑にする20円ROAS(%)超', d:'これ以下かつ赤基準以上は橙。'},
  calSpendOrg:{v:70000, g:'cal', n:'計実績額を橙にする金額(円)超', d:''},
  calSpendRed:{v:100000,g:'cal', n:'計実績額を赤にする金額(円)超', d:''},
  calRatio1:  {v:10,  g:'cal', n:'比率を赤にする月内上位(%)', d:''},
  calRatio2:  {v:20,  g:'cal', n:'比率を橙にする月内上位(%)', d:''},
  calMonths:  {v:4,   g:'cal', n:'表示する月数', d:''}
};
let CFG={}; Object.keys(CFG_DEF).forEach(k=>CFG[k]=CFG_DEF[k].v);

/* ---------------- 状態 ---------------- */
const DB={
  days:{},        // 'YYYY-MM-DD' -> {items:{}, total:{}, src:{}}
  sales:{},
  names:{},
  cpcSet:{},
  tags:{},        // 'YYYY-MM-DD' -> 'burst'|'restrain'|'normal'
  notes:{},
  events:[],      // [{type:'marathon'|'supersale'|'other', from,fromTime, to,toTime, memo}]
  obs:[],         // 当日観測 [{date,slot,time,hour,clicks,cost,budget,capped,note,src,missing}]
  props:[],       // 提案と実行 [{ts,date,slot,time, cap,curBudget,addYen,newBudget,action,reason,conf,
                  //              doneKind,doneAdd,doneBudget,doneTime,memo}]
  hourly:null,
  alloc:null,
  holidays:{}     // 'YYYY-MM-DD' -> '予定休' 等（予定された未観測）
};
let ATTR='720';

async function saveAll(){ await Store.set('cfg',CFG); await Store.set('db',DB); }
async function loadAll(){
  const c=await Store.get('cfg'); if(c) Object.keys(CFG).forEach(k=>{ if(c[k]!==undefined) CFG[k]=c[k]; });
  const d=await Store.get('db');
  if(d){ Object.keys(DB).forEach(k=>{ if(d[k]!==undefined) DB[k]=d[k]; }); }
}
const round5=(v,u)=>{ u=u||+CFG.unit; return Math.round(v/u)*u; };
const floor5=(v,u)=>{ u=u||+CFG.unit; return Math.floor(v/u)*u; };
const ceil5 =(v,u)=>{ u=u||+CFG.unit; return Math.ceil(v/u)*u; };
