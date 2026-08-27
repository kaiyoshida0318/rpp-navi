/* =========================================================================
   日タイプとイベント（開始日時・終了日時を保持）
   ========================================================================= */
const DT={normal:'通常日', five:'5の倍数', sale:'セールのみ', saleFive:'セール＋5の倍数', saleLast:'セール最終日'};
const EVNAME={marathon:'お買い物マラソン', supersale:'スーパーSALE', other:'販促'};
function dtLabel(k){ return DT[k]||k; }

/** その日にかかっているイベント（開始日時〜終了日時） */
function eventOf(date){
  let best=null;
  for(const e of DB.events||[]){
    if(!e.from||!e.to) continue;
    if(date<e.from||date>e.to) continue;
    const rank={supersale:3,marathon:2,other:1}[e.type]||0;
    if(!best||rank>({supersale:3,marathon:2,other:1}[best.type]||0)) best=e;
  }
  return best;
}
function isSaleLast(date){ const e=eventOf(date); return !!e && date===e.to; }
/** 日タイプ。セール最終日は他条件より優先（仕様書4章） */
function dayType(date){
  const ev=eventOf(date);
  if(ev && date===ev.to) return 'saleLast';
  const five=parseDate(date).getDate()%5===0;
  if(ev&&five) return 'saleFive';
  if(ev) return 'sale';
  if(five) return 'five';
  return 'normal';
}
/** 本日の推奨上限（絶対上限ではない） */
function dayCap(date){
  return +({normal:CFG.capNormal, five:CFG.capFive, sale:CFG.capSale,
            saleFive:CFG.capSaleFive, saleLast:CFG.capSaleLast}[dayType(date)]);
}
function dayEnvText(date){
  const t=dayType(date), e=eventOf(date);
  let s=dtLabel(t);
  if(e) s+='（'+(EVNAME[e.type]||e.type)+' '+e.from+' '+(e.fromTime||'')+' 〜 '+e.to+' '+(e.toTime||'')+'）';
  return s;
}

/* =========================================================================
   時刻枠（9:30 / 15:00 / 18:30）
   ========================================================================= */
const SLOTS=[
  {key:'s0930', label:'9:30', target:9.5,  from:9.0,  to:10.0},
  {key:'s1500', label:'15:00',target:15.0, from:14.5, to:15.5},
  {key:'s1830', label:'18:30',target:18.5, from:18.0, to:19.0},
  {key:'close', label:'日次締め', target:24, from:23.0, to:24.99}
];
function slotOf(hour){
  for(const s of SLOTS) if(hour>=s.from&&hour<=s.to) return s;
  // 枠外は最も近い枠へ寄せる（信頼度は判定側で下げる）
  let best=SLOTS[0], bd=1e9;
  for(const s of SLOTS){ const d=Math.abs(hour-s.target); if(d<bd){bd=d;best=s;} }
  return best;
}
function slotByKey(k){ return SLOTS.find(s=>s.key===k)||SLOTS[0]; }
function inWindow(hour){ return SLOTS.some(s=>hour>=s.from&&hour<=s.to); }
function fmtHour(h){ const hh=Math.floor(h), mm=Math.round((h-hh)*60);
  return String(hh>=24?0:hh).padStart(2,'0')+':'+String(mm).padStart(2,'0'); }
function nextSlot(key){ const i=SLOTS.findIndex(s=>s.key===key); return i>=0&&i<3?SLOTS[i+1]:null; }

/* =========================================================================
   ベースライン（同日タイプ優先・欠損は母数から除外）
   ========================================================================= */
function isNormalDay(d){ return DB.tags[d]!=='burst'; }
/** 条件を段階的に緩める：同一複合条件 → 同一セール種別 → 販促日全般 → 全日 */
function ladder(t){
  if(t==='normal') return [['normal','通常日',3],['__all__','全日タイプ',1]];
  if(t==='five')   return [['five','5の倍数',3],['__all__','全日タイプ',1]];
  if(t==='saleFive')return [['saleFive','セール＋5の倍数',3],['sale','セールのみ',2],['__sale__','販促日全般',2],['__all__','全日タイプ',1]];
  if(t==='sale')   return [['sale','セールのみ',3],['__sale__','販促日全般',2],['__all__','全日タイプ',1]];
  if(t==='saleLast')return [['saleLast','セール最終日',3],['__sale__','販促日全般',2],['__all__','全日タイプ',1]];
  return [['__all__','全日タイプ',1]];
}
function matchT(d,w){
  const t=dayType(d);
  if(w==='__all__') return true;
  if(w==='__sale__') return t==='sale'||t==='saleFive'||t==='saleLast';
  return t===w;
}
const CONF={3:'高',2:'中',1:'低'};
/** 同日タイプ優先の中央値。{v,n,used,conf,label} */
function baseType(date, field){
  const L=ladder(dayType(date));
  for(let i=0;i<L.length;i++){
    const [w,nm,cf]=L[i], pool=[];
    for(const d of AGG.dates){
      if(d>=date) continue;
      if(!isNormalDay(d)) continue;
      if(!matchT(d,w)) continue;
      const v=AGG.day[d][field]; if(isFinite(v)) pool.push(v);
    }
    if(pool.length>=+CFG.minSamples || (i===L.length-1&&pool.length)){
      return {v:median(pool), n:pool.length, used:w, conf:CONF[cf],
              label:nm+' '+pool.length+'日'+(i>0?'（条件を緩めて比較）':'')};
    }
  }
  return {v:NaN,n:0,used:null,conf:'低',label:'比較データ不足'};
}
function rangeDays(f,t){ return AGG.dates.filter(d=>d>=f&&d<=t); }
function lastN(date,n){ return AGG.dates.filter(d=>d<date).slice(-n); }
function prevDay(date){ return AGG.dates.filter(d=>d<date).slice(-1)[0]; }

/* =========================================================================
   朝の判定（前日確定データ・警戒基準v1）
   ========================================================================= */
function morningPlan(today){
  const prev=prevDay(today);
  const cap=dayCap(today), t=dayType(today);
  const out={today, prev, cap, dtype:t, unit:+CFG.unit, reasons:[]};
  if(!prev){
    out.level='none'; out.levelName='—';
    out.start=round5(cap*(+CFG.startNormal/100));
    out.reasons.push('前日の確定データがありません。前日20円ROASが分からないため、通常開始として推奨上限の'+CFG.startNormal+'%を暫定の開始予算にします。');
    out.planTotal=cap;
    return out;
  }
  const P=AGG.day[prev];
  out.prevCost=P.c20a; out.prevRoas=P.roas20; out.prevCvr=P.cvr20;
  out.prevKwRoas=P.roasKw; out.prevAllRoas=P.roasAll; out.prevCpc=P.cpc20;

  const hitCost = P.c20a>=+CFG.warnCost;
  const hitRoas = isFinite(P.roas20) && P.roas20<+CFG.warnRoas;
  const warn = hitCost||hitRoas;
  out.level = warn?'warn':'ok';
  out.levelName = warn?'強警戒':'通常開始';
  out.hitCost=hitCost; out.hitRoas=hitRoas;

  if(hitCost) out.reasons.push(`前日の<b>20円実績額 ${yen(P.c20a)}</b> が警戒基準 ${yen(CFG.warnCost)} 以上です。`);
  if(hitRoas) out.reasons.push(`前日の<b>20円ROAS ${pct(P.roas20,0)}</b> が警戒基準 ${CFG.warnRoas}% を下回っています。`);
  if(!warn) out.reasons.push(`前日の20円実績額 ${yen(P.c20a)}（基準 ${yen(CFG.warnCost)} 未満）、20円ROAS ${pct(P.roas20,0)}（基準 ${CFG.warnRoas}% 以上）。どちらの警戒条件にも当たりません。`);

  const b=baseType(today,'c20a');
  out.base=b;
  if(isFinite(b.v)) out.reasons.push(`本日は<b>${dayEnvText(today)}</b>。同条件の20円実績額の中央値は ${yen(b.v)}（${b.label}）。推奨上限は <b>${yen(cap)}</b>。`);
  else out.reasons.push(`本日は<b>${dayEnvText(today)}</b>。推奨上限は <b>${yen(cap)}</b>（同条件の過去データが不足しています）。`);

  out.planTotal = warn ? Math.round(cap*(+CFG.cutRate/100)) : cap;
  out.start = round5(cap*((warn?+CFG.startWarn:+CFG.startNormal)/100));
  out.reasons.push(warn
    ? `強警戒のため、本日の想定総額を推奨上限の ${CFG.cutRate}%（${yen(out.planTotal)}）に絞り、開始予算は <b>${yen(out.start)}</b>（上限の${CFG.startWarn}%）とします。朝に1日分を入れず、9:30・15:00・18:30で逐次判断します。`
    : `開始予算は <b>${yen(out.start)}</b>（推奨上限の${CFG.startNormal}%）。朝に1日分を固定せず、9:30・15:00・18:30で再判定します。`);
  out.reasons.push(`目標は<b>20円ROAS ${CFG.goalRoas}%以上</b>（防衛目標 ${CFG.defRoas}%以上）。KW ROASやRPP全体ROASは参考値であり、判定には使いません。`);
  if(!warn) out.reasons.push('前日が正常でも突発的な暴走は起こります。<b>9:30のチェックは省略しないでください。</b>');
  if(t==='saleLast') out.reasons.push('セール最終日は午前中で終了することが多いため、推奨上限は他条件より優先して '+yen(cap)+' を適用しています。');
  return out;
}

/* =========================================================================
   当日の消化水準（同時刻枠・同日タイプ／欠損は母数から除外）
   ========================================================================= */
function obsOf(date,slot){ return DB.obs.filter(o=>o.date===date&&o.slot===slot).sort((a,b)=>b.ts-a.ts)[0]||null; }
function dayFinal(d){
  const D=AGG.day[d]; if(D&&D.alla>0) return D.alla;
  const c=obsOf(d,'close'); return c?c.cost:NaN;
}
/** 予算上限に到達した日は「通常の消化」ではないので水準から除外する。
 *  day … 一度でも上限到達した日を丸ごと除外（精度優先・既定）
 *  end … その日の最後の観測が上限到達だった日だけ除外（サンプル優先） */
function cappedDays(){
  const key=DB.obs.length+'|'+CFG.capExclude;
  if(cappedDays._k!==key){
    const s=new Set();
    if(String(CFG.capExclude)==='end'){
      const byDate={}; DB.obs.forEach(o=>{ (byDate[o.date]=byDate[o.date]||[]).push(o); });
      for(const d in byDate){
        const last=byDate[d].filter(o=>!o.missing).sort((a,b)=>b.hour-a.hour)[0];
        if(last&&last.capped) s.add(d);
      }
    } else {
      DB.obs.forEach(o=>{ if(o.capped) s.add(o.date); });
    }
    cappedDays._c=s; cappedDays._k=key;
  }
  return cappedDays._c;
}
/** slotにおける「その日の最終実績額に対する進捗%」を条件別に学習 */
function slotShare(slotKey, wantType){
  const CAP=cappedDays(), L=ladder(wantType||'normal');
  const collect=w=>{
    const out=[], hrs=[], notes={};
    const byDate={}; DB.obs.forEach(o=>{ (byDate[o.date]=byDate[o.date]||[]).push(o); });
    for(const d in byDate){
      if(CAP.has(d)||!isNormalDay(d)) continue;
      if(w&&!matchT(d,w)) continue;
      const fin=dayFinal(d); if(!isFinite(fin)||fin<=0) continue;
      const o=byDate[d].find(x=>x.slot===slotKey&&!x.missing); if(!o||!(o.cost>0)) continue;
      const r=o.cost/fin*100; if(r>0&&r<=140) { out.push(r); hrs.push(o.hour);
        if(o.note) notes[o.note]=(notes[o.note]||0)+1; }
    }
    return {v:out, hrs, notes};
  };
  const wrap=(p,cf,nm,extra)=>({ok:true, pct:median(p.v), n:p.v.length, conf:CONF[cf]||cf,
    label:nm+' '+p.v.length+'日'+(extra||''), medHour:median(p.hrs),
    srcNote:Object.keys(p.notes).sort((a,b)=>p.notes[b]-p.notes[a])[0]||''});
  for(let i=0;i<L.length;i++){
    const [w,nm,cf]=L[i], p=collect(w);
    if(p.v.length>=+CFG.minSamples) return wrap(p,cf,nm);
  }
  const p=collect(null);
  if(p.v.length) return wrap(p,'低','全日タイプ','（記録が少ないため信頼度低）');
  const def={s0930:+CFG.share930, s1500:+CFG.share1500, s1830:+CFG.share1830, close:100}[slotKey];
  return {ok:false, pct:def, n:0, conf:'低', medHour:NaN, srcNote:'',
    label:'当日記録が無いため既定の配分率 '+def+'% を使用'};
}
/** 各枠の記録の蓄積状況（信頼度「高」まであと何日か） */
function slotStatus(){
  const CAP=cappedDays();
  return SLOTS.filter(s=>s.key!=='close').map(s=>{
    const all=DB.obs.filter(o=>o.slot===s.key&&!o.missing&&o.cost>0);
    const clean=all.filter(o=>!CAP.has(o.date)&&isNormalDay(o.date)&&isFinite(dayFinal(o.date))&&dayFinal(o.date)>0);
    const byT={};
    clean.forEach(o=>{ const t=dayType(o.date); byT[t]=(byT[t]||0)+1; });
    const hrs=clean.map(o=>o.hour);
    return {slot:s, key:s.key, label:s.label, total:all.length, clean:clean.length,
      capped:all.length-clean.length, byT, medHour:median(hrs),
      need:Math.max(0,+CFG.minSamples-clean.length),
      note:(()=>{ const c={}; clean.forEach(o=>{ if(o.note) c[o.note]=(c[o.note]||0)+1; });
        return Object.keys(c).sort((a,b)=>c[b]-c[a])[0]||''; })()};
  });
}
/** slotにおける実績額・クリックの通常水準 */
function slotNorm(slotKey, wantType, planTotal){
  const sh=slotShare(slotKey,wantType);
  const bt=baseType_forFinal(wantType);
  const ref = isFinite(bt.v)? bt.v : planTotal;
  const CAP=cappedDays();
  // クリックは同条件の最終クリック数×進捗で近似
  const fc=[];
  AGG.dates.forEach(d=>{ if(CAP.has(d)||!isNormalDay(d)) return;
    if(wantType&&dayType(d)!==wantType) return;
    if(AGG.day[d].allc>0) fc.push(AGG.day[d].allc); });
  const fcAll=AGG.dates.filter(d=>!CAP.has(d)&&isNormalDay(d)&&AGG.day[d].allc>0).map(d=>AGG.day[d].allc);
  const clicksFinal=median(fc.length>=+CFG.minSamples?fc:fcAll);
  return {cost:ref*sh.pct/100, clicks:clicksFinal*sh.pct/100,
          share:sh, refFinal:ref, refLabel:bt.label, conf:sh.conf, learned:sh.ok};
}
function baseType_forFinal(wantType){
  const L=ladder(wantType||'normal'), CAP=cappedDays();
  for(let i=0;i<L.length;i++){
    const [w,nm,cf]=L[i], p=[];
    AGG.dates.forEach(d=>{ if(CAP.has(d)||!isNormalDay(d)) return;
      if(!matchT(d,w)) return; if(AGG.day[d].alla>0) p.push(AGG.day[d].alla); });
    if(p.length>=+CFG.minSamples) return {v:median(p),n:p.length,conf:CONF[cf],label:nm+' '+p.length+'日'};
  }
  const p=AGG.dates.filter(d=>!CAP.has(d)&&isNormalDay(d)&&AGG.day[d].alla>0).map(d=>AGG.day[d].alla);
  return {v:median(p), n:p.length, conf:'低', label:'全日タイプ '+p.length+'日'};
}
/** 夜(18:30以降)の需要シェア。0なら注文時間帯データから算出 */
function nightShare(){
  if(+CFG.nightShare>0) return {v:+CFG.nightShare, src:'設定値'};
  if(DB.hourly&&DB.hourly.total>0){
    const c=DB.hourly.counts;
    const night=c.slice(19).reduce((a,b)=>a+b,0)+c[18]*0.5;
    return {v:night/DB.hourly.total*100, src:'注文時間帯データ（全注文の分布・RPPのCVRではありません）'};
  }
  return {v:40, src:'既定値'};
}

/* =========================================================================
   当日の逐次判定（9:30 / 15:00 / 18:30）
   ========================================================================= */
const ACT={ keep:'追加しない', add:'追加する', stop:'18:30まで意図的停止', reopen:'夜の再投入', over:'上限超過提案' };
function navigate(inp){
  // inp:{date,slot,hour,cost,clicks,budget,capped}
  const M=morningPlan(inp.date);
  const t=dayType(inp.date), cap=M.cap;
  const slot=slotByKey(inp.slot);
  const planTotal=M.planTotal;
  const nrm=slotNorm(inp.slot,t,planTotal);
  const cpc=inp.clicks>0?inp.cost/inp.clicks:NaN;

  const costRatio = nrm.cost>0 ? inp.cost/nrm.cost : NaN;
  const clickRatio= nrm.clicks>0&&inp.clicks>0 ? inp.clicks/nrm.clicks : NaN;
  const cpcNorm = nrm.clicks>0 ? nrm.cost/nrm.clicks : NaN;
  const cpcRatio = isFinite(cpc)&&isFinite(cpcNorm)&&cpcNorm>0 ? cpc/cpcNorm : NaN;

  let paceLabel,paceCls;
  if(!isFinite(costRatio)){paceLabel='比較不可';paceCls='grey';}
  else if(costRatio>=+CFG.paceBad){paceLabel='異常に速い';paceCls='bad';}
  else if(costRatio>=+CFG.paceWarn){paceLabel='やや速い';paceCls='alert';}
  else if(costRatio<+CFG.paceSlow){paceLabel='遅い（余力あり）';paceCls='ok';}
  else {paceLabel='ほぼ通常どおり';paceCls='ok';}

  // 仕様書9章：主指標は「実績額進捗倍率」と「クリック進捗倍率」の<b>両方</b>。
  // クリックだけが急増する形（安いクリックが大量に出て売れない）は20円暴走の典型なので、
  // 実績額が閾値未満でも見逃さない。CPCは補助指標で、単独では警告しない。
  const clickHot = isFinite(clickRatio)&&clickRatio>=+CFG.clickBad;
  const clickWarm= isFinite(clickRatio)&&clickRatio>=+CFG.clickWarn;
  const costFast = isFinite(costRatio)&&costRatio>=+CFG.paceWarn;
  const costVery = isFinite(costRatio)&&costRatio>=+CFG.paceBad;
  const fast = costFast || clickHot;
  const veryFast = costVery || (costFast&&clickWarm) || (clickHot&&costFast);
  const slow = isFinite(costRatio)&&costRatio<+CFG.paceSlow && !clickWarm;
  const warnDay = M.level==='warn';

  // 着地見込み（当日のROAS/CVRは一切使わない、純粋な消化推計）
  const landing = nrm.share.pct>0 ? inp.cost/(nrm.share.pct/100) : NaN;

  // 次スロットまでに必要な設定予算
  const nx=nextSlot(inp.slot);
  const shNow=nrm.share.pct;
  const shNext = nx? slotShare(nx.key,t).pct : 100;
  const ns=nightShare();

  let target, action, actionText, over=false;
  const reasons=[];
  reasons.push(`本日は<b>${dayEnvText(inp.date)}</b>／推奨上限 <b>${yen(cap)}</b>／朝の判定 <b>${M.levelName}</b>`
    + (M.prev?`（前日${M.prev}の20円ROAS ${pct(M.prevRoas,0)}・20円実績額 ${yen(M.prevCost)}）`:''));
  reasons.push(`${slot.label}時点：実績額 ${yen(inp.cost)}／クリック ${num(inp.clicks)}回／設定予算 ${yen(inp.budget)}`
    + (inp.capped?'／<b>予算上限に到達して停止中</b>':''));
  reasons.push(`同条件の水準は ${yen(nrm.cost)}（${nrm.refLabel}の最終額 ${yen(nrm.refFinal)} × ${slot.label}までの進捗 ${pct(shNow,0)}／${nrm.share.label}）`
    + ` → <b>実績額 通常比 ${isFinite(costRatio)?costRatio.toFixed(2)+'倍':'—'}（${paceLabel}）</b>`);
  if(nrm.share.ok && nrm.share.srcNote && isFinite(nrm.share.medHour)
     && Math.abs(nrm.share.medHour-slot.target)>0.25)
    reasons.push(`※この枠の進捗率は<b>「${nrm.share.srcNote}」の記録（実時刻の中央値 ${fmtHour(nrm.share.medHour)}）</b>から求めています。${slot.label}ちょうどの記録が貯まると自動で置き換わります。`);
  if(!nrm.share.ok)
    reasons.push(`※${slot.label}枠の記録がまだ ${CFG.minSamples}日に達していないため、既定の配分率で暫定判定しています。記録が貯まると自動で実績ベースに切り替わります。`);
  if(isFinite(clickRatio))
    reasons.push(`クリック 通常比 <b>${clickRatio.toFixed(2)}倍</b>${clickHot?'（異常に多い）':clickWarm?'（やや多い）':''}。実績額とクリックの<b>増え方の組み合わせ</b>で見ています。`);
  if(isFinite(cpc))
    reasons.push(`平均CPC ${cpc.toFixed(1)}円（実績額÷クリック数で自動算出`+(isFinite(cpcRatio)?`／通常比 ${cpcRatio.toFixed(2)}倍`:'')+`）。<b>全体20円は上限20円であり、20円未満は正常です。CPC単独では警告しません。</b>`);
  if(isFinite(landing))
    reasons.push(`このペースが続いた場合の<b>着地見込み実績額 ${yen(landing)}</b>（推定）。当日のROAS・CVRは使っていません。`);

  if(inp.slot==='s1830'){
    // 夜の最終投入
    const nightNeed = planTotal*(ns.v/100);
    target = inp.cost + nightNeed;
    const confOK = String(CFG.overNeedConf)!=='1' || nrm.conf!=='低';
    if(!warnDay && slow && isFinite(M.prevRoas) && M.prevRoas>=+CFG.goalRoas && target>cap && confOK){
      const maxOver=cap*(+CFG.overRate/100);
      target=Math.min(target,maxOver); over=true;
    } else {
      if(!warnDay && slow && isFinite(M.prevRoas) && M.prevRoas>=+CFG.goalRoas && target>cap && !confOK)
        reasons.push(`好調のため推奨上限を超える余地はありますが、<b>この枠の比較の土台がまだ弱い（信頼度 ${nrm.conf}）ため、超過提案は行いません。</b>推奨上限 ${yen(cap)} までにとどめます。`);
      target=Math.min(target,cap);
    }
    if(warnDay && veryFast){ target=Math.min(target, inp.cost + planTotal*(ns.v/100)*0.5);
      reasons.push('強警戒かつ消化が速いため、夜の投入も半分に抑えます。'); }
    reasons.push(`夜(18:30以降)の需要シェアは <b>${pct(ns.v,1)}</b>（${ns.src}）。本日の想定総額 ${yen(planTotal)} に対する夜の想定消化は ${yen(planTotal*ns.v/100)} です。`);
    if(inp.capped) reasons.push('予算切れで停止中です。<b>夜の販売機会を落とさないため、ここで再投入します。</b>');
  } else if(warnDay && veryFast){
    // 意図的停止
    target = inp.budget;
    reasons.push('強警戒の日に'+(costVery?'実績額':'クリック数と実績額')+'が想定を大きく上回っています。ここで追加すると、暴走にそのまま予算を供給することになります。');
    reasons.push(`<b>18:30まで意図的に予算切れ・停止を継続</b>してください。これは失敗ではなく、20円ROASを防衛目標 ${CFG.defRoas}% 以上へ着地させるための正式な打ち手です。`);
  } else if(warnDay && fast){
    target = inp.budget;
    reasons.push(costFast
      ? '強警戒かつ実績額の伸びがやや速いため、追加せず予算切れを許容します。'
      : `強警戒の日に<b>クリック数が通常比 ${clickRatio.toFixed(2)}倍</b>と急増しています。実績額の伸びが閾値未満でも、安いクリックが大量に出ている状態は20円広告の暴走の典型です。追加せず予算切れを許容します。`);
    reasons.push('18:30にあらためて判断します。');
  } else if(!warnDay && veryFast){
    target = inp.budget;
    reasons.push('朝の判定は通常ですが、'+(costVery?'実績額':'クリック数と実績額')+'が想定を大きく上回っています。<b>前日が正常でも突発的な暴走は起こります。</b>ここでは追加せず、18:30にあらためて判断します。');
  } else {
    const need = planTotal*(shNext-shNow)/100;
    target = Math.min(cap, inp.cost + need);
    if(warnDay) reasons.push(`強警戒のため本日の想定総額を ${yen(planTotal)}（推奨上限の${CFG.cutRate}%）に絞っています。`);
    reasons.push(`次の確認 ${nx?nx.label:'日次締め'} までの想定消化は ${yen(need)}（進捗 ${pct(shNow,0)} → ${pct(shNext,0)}）。設定予算をここまで届かせておけば、意図せぬ予算切れを防げます。`);
  }

  let addYen = Math.max(0, round5(target-(inp.budget||0)));
  let newBudget = (inp.budget||0)+addYen;
  if(inp.slot!=='s1830' && (veryFast || (warnDay&&fast))) { addYen=0; newBudget=inp.budget||0; }

  if(inp.capped && inp.slot!=='s1830'){
    if(addYen<=0){
      reasons.push(warnDay
        ? '<b>すでに予算上限に到達して停止中です。この停止を18:30まで継続してください。</b>予算切れは失敗ではなく、意図した打ち手として記録します。'
        : '予算上限に到達して停止中ですが、消化が想定を上回っているため、ここでの再開はおすすめしません。18:30にあらためて判断します。');
    } else {
      reasons.push('予算上限に到達して停止中です。消化ペースは想定内のため、意図せぬ機会損失を防ぐ範囲で再開します。');
    }
  }

  if(addYen<=0){
    const stop = inp.slot!=='s1830' && (inp.capped || veryFast || (warnDay&&fast));
    action = stop ? 'stop' : 'keep';
    actionText = action==='stop' ? '18:30まで意図的停止（追加しない）' : '追加しない';
  } else {
    action = over?'over':'add';
    actionText = yen(addYen)+' 追加（設定予算を '+yen(newBudget)+' へ変更）';
    if(over) actionText='【上限超過提案】'+actionText;
  }
  if(over) reasons.push(`<b>推奨上限 ${yen(cap)} を超える提案です。</b>理由：前日の20円ROASが ${pct(M.prevRoas,0)} と理想目標 ${CFG.goalRoas}% を上回り、本日の消化も通常比 ${costRatio.toFixed(2)}倍 と余力があるためです。超過は上限の ${CFG.overRate}% までに留めています。`);

  // 判定信頼度
  const conf = nrm.conf;
  const confWhy = nrm.learned
    ? `${slot.label}枠の過去記録 ${nrm.share.n}日（${nrm.share.label}）にもとづく比較です。`
    : `${slot.label}枠の過去記録が ${CFG.minSamples}日に満たないため、既定の配分率で暫定判定しています。記録が貯まると自動で実績ベースに切り替わります。`;

  return {morning:M, slot, cap, planTotal, nrm, costRatio, clickRatio, cpc, cpcRatio,
          paceLabel, paceCls, landing, target, addYen, newBudget, action, actionText,
          over, conf, confWhy, reasons, nextSlot:nx, warnDay};
}

/* =========================================================================
   前日18:30時点の「翌日の仮プラン」
   ========================================================================= */
function tomorrowDraft(today){
  const tm=addDays(today,1), cap=dayCap(tm), t=dayType(tm);
  const notes=[];
  notes.push(`翌日 ${tm}（${DOWJ[dow(tm)]}）は <b>${dayEnvText(tm)}</b>。推奨上限は <b>${yen(cap)}</b>。`);
  if(t==='saleLast') notes.push('セール最終日は午前中に終わることが多いため、上限は他条件より優先して70,000円系の値を使います。');
  if(t==='saleFive') notes.push('セールと5の倍数が重なるため、上限は最も大きい区分になります。');
  notes.push(`暫定の開始予算は <b>${yen(round5(cap*(+CFG.startNormal/100)))}</b>（通常開始の場合）／<b>${yen(round5(cap*(+CFG.startWarn/100)))}</b>（強警戒の場合）。`);
  notes.push('<b>本日の最終20円ROASはまだ確定していないため、翌日の正式な危険度は断定しません。</b>翌朝に前日確定データを取り込んだ時点で、開始予算を確定します。');
  return {date:tm, cap, dtype:t, notes};
}

/* =========================================================================
   バックテスト（初期基準v1の再検証）
   ========================================================================= */
function backtest(from,to,thCost,thRoas){
  const days=rangeDays(from,to);
  const rows=[];
  for(let i=0;i<days.length;i++){
    const d=days[i], prev=prevDay(d);
    if(!prev) continue;
    // 前日が「暦の前日」でない（欠損をまたぐ）場合は比較母数から除外
    const gap=Math.round((parseDate(d)-parseDate(prev))/86400000);
    if(gap!==1) { rows.push({d, skip:true, gap, dtype:dtLabel(dayType(d))}); continue; }
    const P=AGG.day[prev], D=AGG.day[d];
    const hitCost=P.c20a>=thCost, hitRoas=isFinite(P.roas20)&&P.roas20<thRoas;
    const warn=hitCost||hitRoas;
    rows.push({d, prev, skip:false, warn, hitCost, hitRoas,
      prevCost:P.c20a, prevRoas:P.roas20, roas20:D.roas20, c20a:D.c20a,
      dtype:dtLabel(dayType(d)), tag:DB.tags[d]||null});
  }
  const use=rows.filter(r=>!r.skip&&isFinite(r.roas20));
  const cap=(lim)=>{ const t=use.filter(r=>r.roas20<lim);
    return {hit:t.filter(r=>r.warn).length, n:t.length}; };
  const norm=use.filter(r=>r.roas20>=+CFG.defRoas);
  const warned=use.filter(r=>r.warn);
  return {rows, use:use.length, skipped:rows.filter(r=>r.skip).length,
    c300:cap(+CFG.defRoas), c200:cap(+CFG.badRoas), c100:cap(100),
    fp:{hit:norm.filter(r=>r.warn).length, n:norm.length},
    prec:{hit:warned.filter(r=>r.roas20<+CFG.defRoas).length, n:warned.length}};
}
