/* =========================================================================
   当日チェック（9:30 / 15:00 / 18:30 の逐次ナビ）
   ========================================================================= */
let DYSLOT='s0930';
function renderDay(){
  if(!$('#dyDate').value) $('#dyDate').value=ymd(new Date());
  const s=slotByKey(DYSLOT);
  $('#dyWin').innerHTML='この枠の許容範囲：'+fmtHour(s.from)+'〜'+fmtHour(s.to)+
    '。枠外の時刻でも記録できますが、判定信頼度が下がります。';
  if(!$('#dyTime').value) $('#dyTime').value=fmtHour(s.target);
  syncCpc(); renderDayToday(); renderDayCurve();
}
function syncCpc(){
  const c=toNum($('#dyCost').value), k=toNum($('#dyClicks').value);
  $('#dyCpc').value = k>0 ? (c/k).toFixed(1)+' 円' : '—';
}
function dayInput(){
  const tm=($('#dyTime').value||fmtHour(slotByKey(DYSLOT).target)).split(':');
  return { date:$('#dyDate').value||ymd(new Date()), slot:DYSLOT,
    hour:(+tm[0]||0)+(+tm[1]||0)/60,
    clicks:toNum($('#dyClicks').value), cost:toNum($('#dyCost').value),
    budget:toNum($('#dyBudget').value),
    capped:$('#dyCapped').classList.contains('on'),
    missing:$('#dyMissing').classList.contains('on'),
    backfill:$('#dyBackfill').classList.contains('on') };
}
function runDay(save){
  const inp=dayInput();
  const host=$('#dyResult'); host.innerHTML='';

  if(inp.missing){
    const kind=$('#dyMissKind').value;
    host.appendChild(noteBox('この枠は<b>未観測</b>として記録します（'+(kind==='plan'?'予定された未観測':'記録忘れ')+'）。'+
      '<b>0としては扱いません。</b>この枠は比較の母数から除外され、他の枠のデータはそのまま使われます。'));
    if(save){
      DB.obs=DB.obs.filter(x=>!(x.date===inp.date&&x.slot===inp.slot&&x.src==='manual'));
      DB.obs.push({date:inp.date, slot:inp.slot, slotLabel:slotByKey(inp.slot).label, hour:inp.hour,
        time:$('#dyTime').value||'', clicks:null, cost:null, cpc:null, budget:null,
        capped:false, missing:true, missKind:kind, note:'', src:'manual',
        ts:Date.parse(inp.date+'T00:00:00')+inp.hour*3600000});
      saveAll(); renderDayToday(); renderDayCurve(); toast('未観測として記録しました');
    }
    return;
  }
  if(inp.slot==='close'){
    host.appendChild(noteBox('日次締めの記録です。判定は行わず、<b>その日の最終実績額</b>として時刻枠の消化水準の学習に使います。'));
    if(save){
      applyObs({date:inp.date, hour:inp.hour, cost:inp.cost, clicks:inp.clicks,
        budget:inp.budget, capped:inp.capped, time:$('#dyTime').value, src:'manual'});
      saveAll(); renderDayToday(); renderDayCurve(); renderDash(); toast('日次締めを記録しました');
    }
    return;
  }

  const R=navigate(inp);

  if(inp.backfill) host.appendChild(noteBox(
    '<b>後日まとめて入力モードです。</b>この数値は日付どおりに保存され、消化カーブの学習にそのまま使われます。'+
    '下の判定は<b>参考表示</b>で、<b>提案・実行履歴には記録しません</b>。'+
    'その場で判断していない提案を履歴に混ぜると、「どの判断が20円ROASの防衛に効いたか」の検証が濁るためです。','blue'));

  /* --- 最重要の指示を最も目立たせる --- */
  const cls = R.action==='stop'?'bad':R.action==='keep'?'alert':R.over?'warn':'ok';
  const bar=el('div','risk '+cls);
  const L=el('div'); L.style.minWidth='240px';
  L.appendChild(el('div','lvl', R.action==='add'||R.action==='over' ? yen(R.addYen)+' 追加' :
                                R.action==='stop' ? '意図的停止' : '追加しない'));
  L.appendChild(el('div','score', R.actionText));
  const cw=el('div'); cw.style.marginTop='8px'; cw.appendChild(confChip(R.conf));
  L.appendChild(cw);
  bar.appendChild(L);
  const W=el('div','why');
  const hd=el('div'); hd.innerHTML='<b>判断理由</b>'; W.appendChild(hd);
  W.appendChild(ul(R.reasons.concat([R.confWhy])));
  bar.appendChild(W);
  host.appendChild(bar);

  /* --- 提案の表示項目（仕様書10章） --- */
  const g=el('div','grid g4'); g.style.marginTop='12px';
  g.appendChild(tile('現在時刻 / 枠', ($('#dyTime').value||'')+'（'+R.slot.label+'）',
    inWindow(inp.hour)?'許容範囲内':'<b style="color:var(--warn)">枠外のため信頼度を下げています</b>'));
  g.appendChild(tile('現在の設定予算', yen(inp.budget), '実績額 '+yen(inp.cost)+(inp.capped?'／<b>上限到達で停止中</b>':'')));
  g.appendChild(tile('本日の推奨上限', yen(R.cap), dtLabel(dayType(inp.date))+(R.over?'／<b style="color:var(--warn)">超過提案あり</b>':'')));
  g.appendChild(tile('推奨追加額', yen(R.addYen), '変更後の設定予算 '+yen(R.newBudget),
    R.addYen>0?(R.over?'warn':'ok'):'grey'));
  host.appendChild(g);

  const g2=el('div','grid g4'); g2.style.marginTop='10px';
  g2.appendChild(tile('実績額 通常比', isFinite(R.costRatio)?R.costRatio.toFixed(2)+'倍':'—',
    '同条件の水準 '+yen(R.nrm.cost)+'（'+R.nrm.share.label+'）', R.paceCls));
  g2.appendChild(tile('クリック 通常比', isFinite(R.clickRatio)?R.clickRatio.toFixed(2)+'倍':'—',
    isFinite(R.nrm.clicks)?('同条件の水準 '+num(R.nrm.clicks)+'回'):'比較データなし',
    isFinite(R.clickRatio)&&R.clickRatio>=+CFG.clickBad?'bad':isFinite(R.clickRatio)&&R.clickRatio>=+CFG.clickWarn?'alert':null));
  g2.appendChild(tile('平均CPC（自動算出）', isFinite(R.cpc)?R.cpc.toFixed(1)+'円':'—',
    (isFinite(R.cpcRatio)?'通常比 '+R.cpcRatio.toFixed(2)+'倍／':'')+'<b>20円未満は正常</b>'));
  g2.appendChild(tile('着地見込み実績額', isFinite(R.landing)?yen(R.landing):'—',
    '進捗 '+pct(R.nrm.share.pct,0)+' から算出。<b>推定</b>。当日ROAS/CVRは不使用',
    isFinite(R.landing)&&R.landing>R.cap?'bad':null));
  host.appendChild(g2);

  const nx=R.nextSlot;
  host.appendChild(noteBox('次回の確認は <b>'+(nx?nx.label:'日次締め（0時）')+'</b> です。'+
    (nx?'その時点の実績額でもう一度再計算します。ここで決めた額は固定ではありません。':'翌朝、前日確定データを取り込むと正式プランに更新されます。')));

  if(save){
    applyObs({date:inp.date, hour:inp.hour, cost:inp.cost, clicks:inp.clicks,
      budget:inp.budget, capped:inp.capped, time:$('#dyTime').value, src:'manual'});
    if(inp.backfill){
      saveAll(); renderDayToday(); renderDayCurve(); renderDash();
      toast('観測だけを保存しました（提案は記録していません）');
      return;
    }
    DB.props.push({ts:Date.now(), date:inp.date, slot:inp.slot, slotLabel:R.slot.label,
      time:$('#dyTime').value||'', cap:R.cap, cost:inp.cost, clicks:inp.clicks,
      curBudget:inp.budget, addYen:R.addYen, newBudget:R.newBudget,
      action:R.action, actionText:R.actionText, over:R.over, conf:R.conf,
      costRatio:isFinite(R.costRatio)?+R.costRatio.toFixed(2):null,
      reason:R.reasons.map(x=>x.replace(/<[^>]+>/g,'')).join(' / '),
      doneKind:'', doneAdd:null, doneBudget:null, doneTime:'', memo:''});
    saveAll(); renderDayToday(); renderDayCurve(); renderHist(); renderDash();
    toast('観測と提案を記録しました。履歴タブで実際の行動を記録してください');
  }
}
function renderDayToday(){
  const host=$('#dyToday'); const d=$('#dyDate').value||ymd(new Date());
  const rows=SLOTS.map(s=>{
    const o=DB.obs.filter(x=>x.date===d&&x.slot===s.key).sort((a,b)=>b.ts-a.ts)[0];
    const pr=DB.props.filter(x=>x.date===d&&x.slot===s.key).sort((a,b)=>b.ts-a.ts)[0];
    return {slot:s.label, key:s.key, o, pr,
      time:o?o.time:'', cost:o&&!o.missing?o.cost:null, clicks:o&&!o.missing?o.clicks:null,
      cpc:o&&!o.missing&&o.cpc?o.cpc:null, budget:o?o.budget:null,
      capped:o?o.capped:false, missing:o?!!o.missing:null,
      act:pr?pr.actionText:''};
  });
  buildTable(host,[
    {t:'枠',k:'slot',sort:false},
    {t:'確認時刻',k:'time',sort:false,f:r=>r.o?(r.time||'—'):el('span','small muted','未記録')},
    {t:'累計実績額',k:'cost',num:1,sort:false,f:r=>r.missing?el('span','tag t-grey','未観測'):(r.cost!=null?yen(r.cost):'—')},
    {t:'累計クリック',k:'clicks',num:1,sort:false,f:r=>r.clicks!=null?num(r.clicks):'—'},
    {t:'平均CPC',k:'cpc',num:1,sort:false,f:r=>r.cpc?(+r.cpc).toFixed(1)+'円':'—'},
    {t:'設定予算',k:'budget',num:1,sort:false,f:r=>r.budget!=null?yen(r.budget):'—'},
    {t:'上限到達',k:'capped',sort:false,f:r=>r.capped?el('span','tag t-grey','停止中'):el('span','small muted','—')},
    {t:'提案',k:'act',cls:'name',sort:false},
    {t:'',k:'_',sort:false,f:r=>{ if(!r.o) return '';
      const b=el('button','btn ghost sm','削除');
      b.onclick=()=>{ DB.obs=DB.obs.filter(x=>!(x.date===d&&x.slot===r.key));
        saveAll(); renderDayToday(); renderDayCurve(); }; return b; }}
  ], rows, {});
  const fin=dayFinal(d);
  host.appendChild(el('div','small muted','その日の最終実績額：'+(isFinite(fin)?yen(fin):'未確定（翌日レポート取込または日次締めの記録で確定します）')));
}
function renderDayCurve(){
  const host=$('#dyCurve'); host.innerHTML='';
  const types=['normal','five','sale','saleFive','saleLast'];
  const rows=[];
  SLOTS.filter(s=>s.key!=='close').forEach(s=>{
    const r={slot:s.label, key:s.key};
    const any=slotShare(s.key,null);
    r.medHour=any.medHour; r.src=any.srcNote||'';
    types.forEach(t=>{ const sh=slotShare(s.key,t); r[t]=sh.pct; r[t+'_ok']=sh.ok; });
    rows.push(r);
  });
  buildTable(host,[
    {t:'枠',k:'slot',sort:false},
    {t:'記録の実時刻（中央値）',k:'medHour',sort:false,
      f:r=>isFinite(r.medHour)?(fmtHour(r.medHour)+(r.src?'（'+r.src+'）':'')):'—',
      color:r=>isFinite(r.medHour)&&Math.abs(r.medHour-slotByKey(r.key).target)>0.25?'warn':null,
      title:'その枠の判定に使っている記録が、実際には何時のものか'},
    ...types.map(t=>({t:dtLabel(t),k:t,num:1,sort:false,
      f:r=>pct(r[t],1)+(r[t+'_ok']?'':'（既定）'),
      color:r=>r[t+'_ok']?null:'grey'}))
  ], rows, {});

  // 蓄積状況
  const st=slotStatus();
  const wrap=el('div'); wrap.style.marginTop='14px';
  wrap.appendChild(el('h3','','記録の蓄積状況'));
  const w2=el('div'); wrap.appendChild(w2);
  buildTable(w2,[
    {t:'枠',k:'label',sort:false},
    {t:'記録',k:'total',num:1,sort:false,f:r=>num(r.total)+'件'},
    {t:'水準に使える記録',k:'clean',num:1,sort:false,f:r=>num(r.clean)+'日',
      color:r=>r.clean>=+CFG.minSamples?'ok':'warn'},
    {t:'上限到達で除外',k:'capped',num:1,sort:false,f:r=>r.capped?num(r.capped)+'件':'—'},
    {t:'実時刻(中央値)',k:'medHour',sort:false,f:r=>isFinite(r.medHour)?fmtHour(r.medHour):'—'},
    {t:'出所',k:'note',sort:false,f:r=>r.note||'—'},
    {t:'状態',k:'need',sort:false,f:r=>{
      if(r.clean>=+CFG.minSamples) return el('span','tag t-ok','実績から学習中');
      return el('span','tag t-warn','あと'+r.need+'日で実績ベースへ');}}
  ], st, {});
  const strict=String(CFG.capExclude)!=='end';
  wrap.appendChild(noteBox(
    '<b>18:30枠は「19時頃」の記録を基準に使っています。</b>実時刻が枠の中心から離れている場合は上の表に橙で表示します。'+
    '<b>15:00枠は今後の記録待ちです。</b>記録が'+CFG.minSamples+'日たまると、既定の配分率から自動で実績ベースに切り替わります。'+
    '<br><b>予算上限に到達した日の扱い：'+(strict
      ?'一度でも上限に到達した日は丸ごと除外（精度優先）'
      :'最後まで停止していた日だけ除外（サンプル優先）')+'</b>'+
    '。学習しているのは「その時刻までに<u>その日の最終額</u>の何%を消化したか」です。途中で予算が切れた日は、<b>切れた時刻がその枠より前なら観測値そのものが</b>、<b>後なら最終額が</b>抑えられるため、進捗率は過小にも過大にもぶれます。精度優先では、こうした日を丸ごと除外して「最後まで止まらずに回った日」だけで水準を作ります。設定タブで変更できます。'+
    '<br>その日の最終額は<b>翌朝に取り込む日次レポートから取得</b>するため、0時の記録は必須ではありません。必要な記録は9:30・15:00・18:30の3枠だけです。'+
    '<br>未観測は0として扱わず、母数から外します。','blue'));
  const need=st.filter(x=>x.need>0);
  if(need.length) wrap.appendChild(noteBox(
    '実績ベースに切り替わるまで：'+need.map(x=>'<b>'+x.label+' あと'+x.need+'日</b>').join('　')+
    '　（対象は「その日一度も予算上限に到達しなかった日」）。'+
    '<br>信頼度を「高」にするには<b>同じ日タイプで'+CFG.minSamples+'日</b>必要です。上限到達日でも記録自体は提案・実行履歴に残り、後からの検証に使えます。'));
  host.appendChild(wrap);

  const n=new Set(DB.obs.filter(o=>!o.missing).map(o=>o.date)).size;
  const miss=DB.obs.filter(o=>o.missing).length;
  host.appendChild(el('div','small muted',
    '当日記録 '+n+'日分から算出（未観測 '+miss+'件は母数から除外）。値は「その枠までに、その日の最終実績額の何%を消化したか」の中央値です。'));
}

/* =========================================================================
   4か月カレンダー（仕様書14章）
   ========================================================================= */
let C4SEL=null, C4MANUAL=false;
function renderCal4(){
  const bi=$('#c4Base');
  if(!C4MANUAL){
    const want=AGG.dates.length?AGG.dates[AGG.dates.length-1]:ymd(new Date());
    if(bi.value!==want) bi.value=want;
  } else if(!bi.value) bi.value=AGG.dates.length?AGG.dates[AGG.dates.length-1]:ymd(new Date());
  const base=bi.value, cutDay=parseDate(base).getDate();
  const nMon=Math.max(1,+CFG.calMonths), months=[];
  const by=parseDate(base).getFullYear(), bm=parseDate(base).getMonth();
  for(let i=nMon-1;i>=0;i--){ const d=new Date(by,bm-i,1);
    months.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')); }
  $('#c4Note').innerHTML='各月とも <b>1日〜'+cutDay+'日</b> でそろえて比率を算出'
    +(AGG.missing.length?'／欠損 '+AGG.missing.length+'日は母数から除外':'');

  const G=$('#c4Grid'); G.innerHTML='';
  months.forEach(ym=>{
    const [y,m]=ym.split('-').map(Number);
    const last=new Date(y,m,0).getDate(), cut=Math.min(cutDay,last);
    const inR=[]; let denom=0, miss=0;
    for(let d=1;d<=cut;d++){
      const ds=ym+'-'+String(d).padStart(2,'0'), D=AGG.day[ds];
      if(D){ denom+=D.alla; inR.push(D.alla); }
      else if(AGG.dates.length&&ds>=AGG.dates[0]&&ds<=AGG.dates[AGG.dates.length-1]) miss++;
    }
    const rt=inR.map(v=>denom>0?v/denom*100:0).sort((a,b)=>b-a);
    const q1=rt.length?rt[Math.max(0,Math.ceil(rt.length*(+CFG.calRatio1/100))-1)]:Infinity;
    const q2=rt.length?rt[Math.max(0,Math.ceil(rt.length*(+CFG.calRatio2/100))-1)]:Infinity;

    const box=el('div','mbox');
    box.appendChild(el('h4',null,y+'/'+String(m).padStart(2,'0')));
    const sub=el('div','msub');
    sub.innerHTML='1〜'+cut+'日の計実績額 <b>'+yen(denom)+'</b>（'+inR.length+'日'
      +(miss?'／<span style="color:var(--bad)">欠損'+miss+'日</span>':'')+'）';
    box.appendChild(sub);
    const dw=el('div','c4'); DOWJ.forEach((x,i)=>dw.appendChild(el('div','dw'+(i===0?' sun':i===6?' sat':''),x)));
    box.appendChild(dw);
    const g=el('div','c4'); g.style.marginTop='3px';
    for(let i=0;i<new Date(y,m-1,1).getDay();i++) g.appendChild(el('div','c4c void'));
    for(let d=1;d<=last;d++){
      const ds=ym+'-'+String(d).padStart(2,'0'), D=AGG.day[ds];
      const c=el('div','c4c'); c.appendChild(el('div','d',String(d)));
      if(!D){ c.classList.add('void');
        if(AGG.dates.length&&ds>=AGG.dates[0]&&ds<=AGG.dates[AGG.dates.length-1])
          c.appendChild(el('div','miss','欠損'));
        g.appendChild(c); continue; }
      const r20=D.roas20;
      const cl=!isFinite(r20)?'':(r20<+CFG.calRed?'red':(r20<=+CFG.calGreen?'org':'grn'));
      if(cl) c.classList.add(cl);
      const rs=el('div','rs',pct(r20,0));
      rs.style.color=cl==='red'?'var(--bad)':cl==='org'?'var(--warn)':'var(--ok)';
      c.appendChild(rs);
      const l1=el('div','kv'); l1.innerHTML='20<br><b class="sum20">'+num(D.c20a)+'</b>'; c.appendChild(l1);
      const l2=el('div','kv'); l2.innerHTML='KW<br><b style="color:#9aa3b0">'+num(D.kwa)+'</b>'; c.appendChild(l2);
      const sc=D.alla>+CFG.calSpendRed?'sumRed':D.alla>+CFG.calSpendOrg?'sumOrg':'sum20';
      const l3=el('div','kv'); l3.innerHTML='計<br><b class="'+sc+'">'+num(D.alla)+'</b>'; c.appendChild(l3);
      if(d<=cut&&denom>0){ const v=D.alla/denom*100;
        c.appendChild(el('div','rt '+(v>=q1?'rtRed':v>=q2?'rtOrg':'rtBlk'), v.toFixed(1)+'%'));
      } else c.appendChild(el('div','rt rtBlk','—'));
      const dt=dayType(ds);
      if(dt!=='normal'){ const e=el('div','ev');
        const ev=eventOf(ds);
        e.textContent = dt==='saleLast'?'終': dt==='five'?'5': (ev&&ev.type==='supersale')?'SS':'M';
        c.appendChild(e); }
      if(DB.tags[ds]==='burst') c.style.boxShadow='inset 0 0 0 2px var(--bad)';
      if(DB.tags[ds]==='restrain') c.style.boxShadow='inset 0 0 0 2px var(--blue)';
      if(C4SEL===ds) c.style.outline='3px solid var(--blue)';
      c.onclick=()=>{ C4SEL=ds; renderCal4(); renderC4Detail(ds); };
      g.appendChild(c);
    }
    box.appendChild(g); G.appendChild(box);
  });
  if(C4SEL) renderC4Detail(C4SEL);
}
function renderC4Detail(ds){
  const host=$('#c4Detail'); host.innerHTML='';
  const D=AGG.day[ds];
  if(!D){ host.appendChild(el('div','small muted','データがありません（欠損日）。')); return; }
  const h=el('h3'); h.innerHTML=ds+'（'+DOWJ[dow(ds)]+'）　'; host.appendChild(h);
  h.appendChild(dtypeChip(ds));
  const g=el('div','grid g4'); g.style.marginTop='10px';
  g.appendChild(tile('20円ROAS',pct(D.roas20,0),'実績額 '+yen(D.c20a)+'／売上 '+yen(D.c20s),roasCls(D.roas20)));
  g.appendChild(tile('20円CVR',pct(D.cvr20,2),'クリック '+num(D.c20c)+'／平均CPC '+(isFinite(D.cpc20)?D.cpc20.toFixed(1)+'円':'—')));
  g.appendChild(tile('［参考］KW ROAS',pct(D.roasKw,0),'実績額 '+yen(D.kwa)));
  g.appendChild(tile('［参考］RPP全体ROAS',pct(D.roasAll,0),'実績額 '+yen(D.alla)));
  host.appendChild(g);

  const b=baseType(ds,'c20a');
  const info=el('div','reason'); info.style.marginTop='10px';
  const mul=isFinite(b.v)&&b.v>0?D.c20a/b.v:NaN;
  info.innerHTML='本日の環境：<b>'+dayEnvText(ds)+'</b>／推奨上限 <b>'+yen(dayCap(ds))+'</b><br>'+
    '20円実績額は同条件の中央値 '+yen(b.v)+'（'+b.label+'）の <b>'+(isFinite(mul)?mul.toFixed(2)+'倍':'—')+'</b>'+
    (D.reported?'<br><span class="small muted">全体日次レポート照合：実績額 '+yen(D.reported.cost)+
      '（商品別合計 '+yen(D.alla)+'）'+(Math.abs(D.reported.cost-D.alla)<1?' ✓一致':' ⚠差異あり')+'</span>':'');
  host.appendChild(info);

  const obs=DB.obs.filter(o=>o.date===ds).sort((a,b)=>a.ts-b.ts);
  if(obs.length){
    const w=el('div'); w.style.marginTop='12px';
    w.appendChild(el('h3','','この日の当日観測'));
    const t=el('div'); w.appendChild(t);
    buildTable(t,[
      {t:'枠',k:'slotLabel',sort:false},{t:'時刻',k:'time',sort:false},
      {t:'実績額',k:'cost',num:1,sort:false,f:x=>x.missing?el('span','tag t-grey','未観測'):yen(x.cost)},
      {t:'クリック',k:'clicks',num:1,sort:false,f:x=>x.clicks?num(x.clicks):'—'},
      {t:'平均CPC',k:'cpc',num:1,sort:false,f:x=>x.cpc?(+x.cpc).toFixed(1)+'円':'—'},
      {t:'上限到達',k:'capped',sort:false,f:x=>x.capped?el('span','tag t-grey','停止中'):el('span','small muted','—')},
      {t:'進捗',k:'p',num:1,sort:false,f:x=>D.alla>0&&x.cost?pct(x.cost/D.alla*100,1):'—'}
    ], obs, {});
    host.appendChild(w);
  }
  const props=DB.props.filter(p=>p.date===ds);
  if(props.length){
    const w=el('div'); w.style.marginTop='12px';
    w.appendChild(el('h3','','この日の提案と実行'));
    const t=el('div'); w.appendChild(t);
    buildTable(t,[
      {t:'枠',k:'slotLabel',sort:false},{t:'提案',k:'actionText',cls:'name',sort:false},
      {t:'実行',k:'doneKind',sort:false,f:x=>doneChip(x)},
      {t:'信頼度',k:'conf',sort:false}
    ], props, {});
    host.appendChild(w);
  }

  const tagRow=el('div','row'); tagRow.style.marginTop='12px';
  tagRow.appendChild(el('span','small','この日のタグ：'));
  [['','なし'],['burst','暴走日'],['restrain','予算抑制日'],['normal','通常日']].forEach(([v,l])=>{
    const p=el('span','pill'+((DB.tags[ds]||'')===v?' on':''),l);
    p.onclick=()=>{ if(v) DB.tags[ds]=v; else delete DB.tags[ds];
      saveAll(); rebuild(); renderCal4(); renderC4Detail(ds); renderDash(); };
    tagRow.appendChild(p); });
  host.appendChild(tagRow);
  const memo=el('div','row'); memo.style.marginTop='8px';
  const mi=el('input'); mi.type='text'; mi.placeholder='この日のメモ'; mi.style.flex='1'; mi.value=DB.notes[ds]||'';
  mi.onchange=()=>{ DB.notes[ds]=mi.value; saveAll(); };
  memo.appendChild(mi); host.appendChild(memo);

  const rows=Object.values(D.items).filter(i=>i.alla>0).map(i=>({...i,name:itemName(i.code)}));
  const h2=el('h3'); h2.innerHTML='この日の商品別内訳 <span class="hint">参考表示です。Phase 1では商品単位の制御は行いません</span>';
  host.appendChild(h2);
  const w2=el('div'); host.appendChild(w2);
  buildTable(w2,[
    {t:'商品管理番号',k:'code'},{t:'商品名',k:'name',cls:'name'},
    {t:'区分',k:'kind',f:r=>kindChip(r.kind)},
    {t:'20円実績額',k:'c20a',num:1,f:r=>yen(r.c20a)},
    {t:'20円売上',k:'c20s',num:1,f:r=>yen(r.c20s)},
    {t:'20円ROAS',k:'roas20',num:1,f:r=>pct(r.roas20,0),color:r=>roasCls(r.roas20)},
    {t:'20円CPC',k:'cpc20',num:1,f:r=>isFinite(r.cpc20)?r.cpc20.toFixed(1)+'円':'—'},
    {t:'［参考］KW実績額',k:'kwa',num:1,f:r=>yen(r.kwa)},
    {t:'［参考］KW ROAS',k:'roasKw',num:1,f:r=>pct(r.roasKw,0)}
  ], rows, {sort:{k:'c20a',dir:-1},limit:300});
}
function doneChip(x){
  if(!x.doneKind) return el('span','small muted','未記録');
  const M={same:['提案どおり','t-ok'],other:['別金額','t-warn'],none:['何もしなかった','t-grey']};
  const m=M[x.doneKind]||[x.doneKind,'t-grey'];
  const s=el('span','tag '+m[1],m[0]+(x.doneKind==='other'&&x.doneAdd!=null?'（'+yen(x.doneAdd)+'）':''));
  return s;
}
