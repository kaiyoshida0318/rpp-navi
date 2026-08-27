/* =========================================================================
   イベント設定
   ========================================================================= */
function renderEv(){
  const rows=(DB.events||[]).map((e,i)=>({...e,i,
    label:EVNAME[e.type]||e.type,
    days:(e.from&&e.to)?Math.round((parseDate(e.to)-parseDate(e.from))/86400000)+1:0}));
  buildTable($('#evTable'),[
    {t:'種別',k:'label',f:r=>el('span','chip ev',r.label)},
    {t:'開始',k:'from',f:r=>r.from+' '+(r.fromTime||'')},
    {t:'終了（最終日）',k:'to',f:r=>r.to+' '+(r.toTime||'')},
    {t:'日数',k:'days',num:1},
    {t:'メモ',k:'memo',cls:'name',sort:false,f:r=>{
      const i=el('input'); i.type='text'; i.value=r.memo||''; i.style.width='100%'; i.style.fontSize='11px';
      i.onchange=()=>{ DB.events[r.i].memo=i.value; saveAll(); }; return i;}},
    {t:'',k:'_',sort:false,f:r=>{const b=el('button','btn ghost sm','削除');
      b.onclick=()=>{ DB.events.splice(r.i,1); saveAll(); rebuild(); renderAll(); }; return b;}}
  ], rows, {sort:{k:'from',dir:-1}});

  const caps=[['normal','capNormal'],['five','capFive'],['sale','capSale'],
              ['saleFive','capSaleFive'],['saleLast','capSaleLast']];
  buildTable($('#evCaps'),[
    {t:'日タイプ',k:'l',sort:false},
    {t:'推奨上限',k:'v',num:1,sort:false,f:r=>yen(CFG[r.k])},
    {t:'開始予算（通常）',k:'_a',num:1,sort:false,f:r=>yen(round5(CFG[r.k]*(+CFG.startNormal/100)))},
    {t:'開始予算（強警戒）',k:'_b',num:1,sort:false,f:r=>yen(round5(CFG[r.k]*(+CFG.startWarn/100)))},
    {t:'備考',k:'note',cls:'name',sort:false}
  ], caps.map(([t,k])=>({l:dtLabel(t),k,
    note:t==='saleLast'?'終了日時の日付。他条件より優先して適用します。':
         t==='saleFive'?'セール期間かつ5の倍数。最も大きい区分。':''})), {});

  const start=AGG.dates.length?addDays(AGG.dates[AGG.dates.length-1],1):ymd(new Date());
  const fc=[];
  for(let i=0;i<30;i++){ const d=addDays(start,i);
    fc.push({d, dow:DOWJ[dow(d)], t:dtLabel(dayType(d)), cap:dayCap(d),
      ev:(()=>{const e=eventOf(d); return e?(EVNAME[e.type]||e.type):'';})()}); }
  buildTable($('#evForecast'),[
    {t:'日付',k:'d',sort:false},{t:'曜日',k:'dow',sort:false},
    {t:'日タイプ',k:'t',sort:false,f:r=>dtypeChip(r.d)},
    {t:'イベント',k:'ev',sort:false},
    {t:'推奨上限',k:'cap',num:1,sort:false,f:r=>yen(r.cap)},
    {t:'開始予算（通常）',k:'_a',num:1,sort:false,f:r=>yen(round5(r.cap*(+CFG.startNormal/100)))}
  ], fc, {limit:30});
}

/* =========================================================================
   提案・実行履歴
   ========================================================================= */
let HSCOLS=null, HSROWS=null;
function renderHist(){
  const sel=$('#hsMonth'), cur=sel.value;
  const months=[...new Set(DB.props.map(p=>p.date.slice(0,7)))].sort().reverse();
  sel.innerHTML=''; const oA=el('option'); oA.value=''; oA.textContent='すべて'; sel.appendChild(oA);
  months.forEach(m=>{const o=el('option'); o.value=m; o.textContent=m; sel.appendChild(o);});
  if(cur&&months.includes(cur)) sel.value=cur;

  let rows=DB.props.slice();
  if(sel.value) rows=rows.filter(p=>p.date.slice(0,7)===sel.value);
  rows=rows.map(p=>{
    const nx=AGG.day[p.date];   // その日の確定20円ROAS（翌朝に判明）
    return {...p, roas20:nx?nx.roas20:NaN, c20a:nx?nx.c20a:NaN, dtype:dtLabel(dayType(p.date))};
  });

  const T=$('#hsTiles'); T.innerHTML='';
  const done=rows.filter(r=>r.doneKind);
  const withRoas=rows.filter(r=>isFinite(r.roas20));
  const defended=withRoas.filter(r=>r.roas20>=+CFG.defRoas);
  T.appendChild(tile('提案の記録',num(rows.length),'実行を記録済み '+done.length+'件'));
  T.appendChild(tile('提案どおり実行',num(done.filter(r=>r.doneKind==='same').length),
    '別金額 '+done.filter(r=>r.doneKind==='other').length+'件／何もしなかった '+done.filter(r=>r.doneKind==='none').length+'件'));
  T.appendChild(tile('防衛目標の達成',
    withRoas.length?pct(defended.length/withRoas.length*100,0):'—',
    '確定した '+withRoas.length+'日のうち20円ROAS '+CFG.defRoas+'%以上が '+defended.length+'日',
    withRoas.length&&defended.length/withRoas.length>=0.7?'ok':'warn'));
  T.appendChild(tile('意図的停止の提案',num(rows.filter(r=>r.action==='stop').length),
    '予算切れは失敗ではなく正式な打ち手です'));

  HSCOLS=[
    {t:'日付',k:'date',f:r=>r.date+'('+DOWJ[dow(r.date)]+')'},
    {t:'日タイプ',k:'dtype'},
    {t:'枠',k:'slotLabel'},
    {t:'提案時刻',k:'time'},
    {t:'推奨上限',k:'cap',num:1,f:r=>yen(r.cap)},
    {t:'その時の実績額',k:'cost',num:1,f:r=>yen(r.cost)},
    {t:'通常比',k:'costRatio',num:1,f:r=>r.costRatio!=null?r.costRatio.toFixed(2)+'倍':'—'},
    {t:'提案前の設定予算',k:'curBudget',num:1,f:r=>yen(r.curBudget)},
    {t:'推奨追加額',k:'addYen',num:1,f:r=>yen(r.addYen),color:r=>r.over?'warn':null},
    {t:'変更後の設定予算',k:'newBudget',num:1,f:r=>yen(r.newBudget)},
    {t:'提案',k:'actionText',cls:'name'},
    {t:'信頼度',k:'conf',f:r=>confChip(r.conf)},
    {t:'実行',k:'doneKind',sort:false,f:r=>doneSelect(r)},
    {t:'実際の追加額',k:'doneAdd',num:1,sort:false,f:r=>doneAmt(r)},
    {t:'メモ',k:'memo',cls:'name',sort:false,f:r=>{
      const i=el('input'); i.type='text'; i.value=r.memo||''; i.style.width='100%'; i.style.fontSize='11px';
      i.onchange=()=>{ const p=DB.props.find(x=>x.ts===r.ts); if(p){p.memo=i.value; saveAll();} }; return i;}},
    {t:'その日の確定20円ROAS',k:'roas20',num:1,f:r=>pct(r.roas20,0),color:r=>roasCls(r.roas20),
      title:'翌朝に前日確定データを取り込むと入ります'},
    {t:'',k:'_',sort:false,f:r=>{const b=el('button','btn ghost sm','削除');
      b.onclick=()=>{ DB.props=DB.props.filter(x=>x.ts!==r.ts); saveAll(); renderHist(); }; return b;}}
  ];
  HSROWS=rows;
  buildTable($('#hsTable'),HSCOLS,rows,{sort:{k:'ts',dir:-1},limit:500});

  // 行動別の翌日20円ROAS
  const g={};
  rows.filter(r=>isFinite(r.roas20)).forEach(r=>{
    const k=r.doneKind?({same:'提案どおり実行',other:'別金額を実行',none:'何もしなかった'}[r.doneKind]):'実行未記録';
    (g[k]=g[k]||[]).push(r); });
  const ev=Object.keys(g).map(k=>{
    const v=g[k], rs=v.map(x=>x.roas20);
    return {k, n:v.length, med:median(rs),
      def:v.filter(x=>x.roas20>=+CFG.defRoas).length/v.length*100,
      bad:v.filter(x=>x.roas20<+CFG.badRoas).length/v.length*100};
  });
  buildTable($('#hsEval'),[
    {t:'実際の行動',k:'k',sort:false},
    {t:'件数',k:'n',num:1,sort:false},
    {t:'その日の20円ROAS 中央値',k:'med',num:1,sort:false,f:r=>pct(r.med,0),color:r=>roasCls(r.med)},
    {t:'防衛目標('+CFG.defRoas+'%)達成率',k:'def',num:1,sort:false,f:r=>pct(r.def,0)},
    {t:'危険水準('+CFG.badRoas+'%)割れ',k:'bad',num:1,sort:false,f:r=>pct(r.bad,0),color:()=>'bad'}
  ], ev, {});
  $('#hsEval').appendChild(el('div','small muted',
    '記録が貯まるほど「どの判断・行動が20円ROAS'+CFG.defRoas+'%以上の防衛と売上確保に寄与したか」が見えるようになります。件数が少ないうちは参考程度にしてください。'));
}
function doneSelect(r){
  const s=el('select'); s.style.fontSize='11px'; s.style.padding='2px 4px';
  [['','未記録'],['same','提案どおり実行'],['other','別金額を実行'],['none','何もしなかった']]
    .forEach(([v,l])=>{const o=el('option'); o.value=v; o.textContent=l; s.appendChild(o);});
  s.value=r.doneKind||'';
  s.onchange=()=>{
    const p=DB.props.find(x=>x.ts===r.ts); if(!p) return;
    p.doneKind=s.value;
    p.doneTime=new Date().toTimeString().slice(0,5);
    if(s.value==='same'){ p.doneAdd=p.addYen; p.doneBudget=p.newBudget; }
    else if(s.value==='none'){ p.doneAdd=0; p.doneBudget=p.curBudget; }
    saveAll(); renderHist();
  };
  return s;
}
function doneAmt(r){
  if(r.doneKind!=='other') return r.doneAdd!=null?yen(r.doneAdd):'—';
  const i=el('input'); i.type='number'; i.step=CFG.unit; i.style.width='110px'; i.style.fontSize='11px';
  i.value=r.doneAdd!=null?r.doneAdd:'';
  i.onchange=()=>{ const p=DB.props.find(x=>x.ts===r.ts); if(!p) return;
    p.doneAdd=toNum(i.value); p.doneBudget=p.curBudget+p.doneAdd; saveAll(); renderHist(); };
  return i;
}

/* =========================================================================
   バックテスト
   ========================================================================= */
function renderBt(){
  if(AGG.dates.length){
    if(!$('#btFrom').value) $('#btFrom').value=AGG.dates[0];
    if(!$('#btTo').value) $('#btTo').value=AGG.dates[AGG.dates.length-1];
  }
  if(!$('#btCost').value) $('#btCost').value=CFG.warnCost;
  if(!$('#btRoas').value) $('#btRoas').value=CFG.warnRoas;
}
function runBt(){
  const thC=toNum($('#btCost').value), thR=toNum($('#btRoas').value);
  const R=backtest($('#btFrom').value,$('#btTo').value,thC,thR);
  const T=$('#btTiles'); T.innerHTML='';
  const p=(o)=>o.n?pct(o.hit/o.n*100,0):'—';
  T.appendChild(tile('20円ROAS<'+CFG.defRoas+'% の捕捉率', p(R.c300),
    R.c300.n+'日中 '+R.c300.hit+'日を前日に警戒', R.c300.n&&R.c300.hit/R.c300.n>=0.7?'ok':'warn'));
  T.appendChild(tile('20円ROAS<'+CFG.badRoas+'% の捕捉率', p(R.c200),
    R.c200.n+'日中 '+R.c200.hit+'日', R.c200.n&&R.c200.hit/R.c200.n>=0.8?'ok':'warn'));
  T.appendChild(tile('20円ROAS<100% の捕捉率', p(R.c100),
    R.c100.n+'日中 '+R.c100.hit+'日', R.c100.n&&R.c100.hit/R.c100.n>=0.8?'ok':'warn'));
  T.appendChild(tile('正常日の誤警報率', p(R.fp),
    '20円ROAS '+CFG.defRoas+'%以上の '+R.fp.n+'日中 '+R.fp.hit+'日で警戒', R.fp.n&&R.fp.hit/R.fp.n<=0.2?'ok':'bad'));
  const g=el('div','grid g4'); g.style.margin='0 0 14px';
  g.appendChild(tile('警戒を出した翌日に実際に悪化', p(R.prec),
    '警戒 '+R.prec.n+'日のうち 20円ROAS<'+CFG.defRoas+'% が '+R.prec.hit+'日'));
  g.appendChild(tile('評価対象', num(R.use)+'日',
    '欠損をまたぐ '+R.skipped+'日は「前日」が存在しないため母数から除外'));
  g.appendChild(tile('現在の基準', yen(thC)+' / '+thR+'%',
    '前日20円実績額 ≥ '+yen(thC)+' <b>または</b> 前日20円ROAS &lt; '+thR+'%'));
  g.appendChild(tile('設定中の基準', yen(CFG.warnCost)+' / '+CFG.warnRoas+'%',
    thC===+CFG.warnCost&&thR===+CFG.warnRoas?'同じ値です':'「設定に反映」で切り替えられます'));
  T.parentNode.insertBefore(g,$('#btSweep').parentNode);

  // スイープ
  const costs=[20000,25000,30000,35000,40000,45000];
  const roass=[175,200,225,250,275,300];
  const sw=[];
  costs.forEach(c=>{ const row={c:yen(c)};
    roass.forEach(r=>{ const b=backtest($('#btFrom').value,$('#btTo').value,c,r);
      row['r'+r]= (b.c300.n?b.c300.hit/b.c300.n*100:0).toFixed(0)+'% / '+(b.fp.n?b.fp.hit/b.fp.n*100:0).toFixed(0)+'%';
      row['s'+r]= (b.c300.n?b.c300.hit/b.c300.n*100:0) - (b.fp.n?b.fp.hit/b.fp.n*100:0);
    });
    sw.push(row); });
  const best=Math.max(...sw.flatMap(r=>roass.map(x=>r['s'+x])));
  buildTable($('#btSweep'),[
    {t:'前日20円実績額 ≥',k:'c',sort:false},
    ...roass.map(r=>({t:'ROAS<'+r+'%',k:'r'+r,sort:false,
      color:x=>Math.abs(x['s'+r]-best)<0.01?'ok':null}))
  ], sw, {});
  $('#btSweep').appendChild(el('div','small muted',
    '各セルは「20円ROAS<'+CFG.defRoas+'%の捕捉率 / 正常日の誤警報率」です。'+
    '緑は（捕捉率−誤警報率）が最大の組み合わせ。捕捉率を上げると誤警報も増えるため、運用上どちらを重く見るかで選んでください。'));

  buildTable($('#btTable'),[
    {t:'日付',k:'d',f:r=>r.d+'('+DOWJ[dow(r.d)]+')'},
    {t:'日タイプ',k:'dtype'},
    {t:'前日',k:'prev',f:r=>r.skip?el('span','tag t-grey','欠損の翌日'):r.prev},
    {t:'前日20円実績額',k:'prevCost',num:1,f:r=>r.skip?'—':yen(r.prevCost),
      color:r=>!r.skip&&r.hitCost?'bad':null},
    {t:'前日20円ROAS',k:'prevRoas',num:1,f:r=>r.skip?'—':pct(r.prevRoas,0),
      color:r=>!r.skip&&r.hitRoas?'bad':null},
    {t:'前日に警戒',k:'warn',f:r=>r.skip?el('span','small muted','—'):
      el('span','tag '+(r.warn?'t-bad':'t-ok'),r.warn?'強警戒':'通常')},
    {t:'当日の20円ROAS',k:'roas20',num:1,f:r=>pct(r.roas20,0),color:r=>roasCls(r.roas20)},
    {t:'当日の20円実績額',k:'c20a',num:1,f:r=>yen(r.c20a)},
    {t:'結果',k:'_r',sort:false,f:r=>{
      if(r.skip) return el('span','small muted','対象外');
      const bad=isFinite(r.roas20)&&r.roas20<+CFG.defRoas;
      const v = bad&&r.warn?['検知','t-ok']: bad&&!r.warn?['見逃し','t-bad']:
                !bad&&r.warn?['誤警報','t-warn']:['—','t-grey'];
      return el('span','tag '+v[1],v[0]); }}
  ], R.rows, {sort:{k:'d',dir:1},limit:400});
  toast('再検証しました');
}

/* =========================================================================
   データ取込画面
   ========================================================================= */
function renderLoad(){
  const rows=AGG.dates.map(d=>{
    const D=AGG.day[d], s=DB.days[d].src||{};
    return {d, dtype:dtLabel(dayType(d)),
      item:s.item?'✓':'—', kw:s.kw?'✓':'—', daily:s.daily?'✓':'—',
      obs:DB.obs.filter(o=>o.date===d&&!o.missing).length,
      alla:D.alla, c20a:D.c20a, roas20:D.roas20,
      match:D.reported?(Math.abs(D.reported.cost-D.alla)<1?'一致':'差異 '+yen(D.reported.cost-D.alla)):'—'};
  });
  buildTable($('#loadTable'),[
    {t:'日付',k:'d',f:r=>r.d+'('+DOWJ[dow(r.d)]+')'},
    {t:'日タイプ',k:'dtype'},
    {t:'商品別',k:'item'},{t:'KW別',k:'kw'},{t:'全体日次',k:'daily'},
    {t:'当日観測',k:'obs',num:1,f:r=>r.obs?num(r.obs)+'件':'—'},
    {t:'20円実績額',k:'c20a',num:1,f:r=>yen(r.c20a)},
    {t:'20円ROAS',k:'roas20',num:1,f:r=>pct(r.roas20,0),color:r=>roasCls(r.roas20)},
    {t:'計実績額',k:'alla',num:1,f:r=>yen(r.alla)},
    {t:'全体日次との照合',k:'match'},
    {t:'',k:'_',sort:false,f:r=>{const b=el('button','btn ghost sm','削除');
      b.onclick=()=>{ if(!confirm(r.d+' のデータを削除しますか？')) return;
        delete DB.days[r.d]; delete DB.sales[r.d]; saveAll(); rebuild(); renderAll(); }; return b;}}
  ], rows, {sort:{k:'d',dir:-1}});

  const mb=$('#missBox'); mb.innerHTML='';
  if(!AGG.missing.length) mb.innerHTML='<div class="small muted">欠損はありません。</div>';
  else mb.appendChild(noteBox('取込済み期間（'+AGG.dates[0]+'〜'+AGG.dates[AGG.dates.length-1]+'）のうち <b>'+
    AGG.missing.length+'日</b> のデータがありません。<b>0としては扱わず</b>、比較・バックテストの母数から除外します。'+
    '<br>'+AGG.missing.map(d=>d+'('+DOWJ[dow(d)]+')').join('　')));
  const mo=DB.obs.filter(o=>o.missing);
  if(mo.length) mb.appendChild(noteBox('当日観測の未観測 <b>'+mo.length+'件</b>：'+
    mo.slice(0,12).map(o=>o.date+' '+o.slotLabel+'('+(o.missKind==='plan'?'予定':'記録忘れ')+')').join('　')
    +(mo.length>12?' ほか':''),'blue'));
  if(AGG.warn.length) mb.appendChild(noteBox('<b>整合性の警告</b>（推測での補正はしていません）<br>'+
    AGG.warn.slice(0,8).map(x=>'・'+x).join('<br>')+(AGG.warn.length>8?'<br>ほか'+(AGG.warn.length-8)+'件':'')));

  $('#dataRange').textContent = AGG.dates.length
    ? (AGG.dates[0]+' 〜 '+AGG.dates[AGG.dates.length-1]+'（'+AGG.dates.length+'日'
       +(AGG.missing.length?'／欠損'+AGG.missing.length+'日':'')+'）'
       +(DB.obs.length?' ／当日観測'+DB.obs.length+'件':'')
       +(DB.events.length?' ／イベント'+DB.events.length+'件':''))
    : 'データ未取込';
}

/* =========================================================================
   設定
   ========================================================================= */
function renderCfg(){
  const G={goal:'#cfg-goal',morn:'#cfg-morn',cap:'#cfg-cap',day:'#cfg-day',cal:'#cfg-cal'};
  Object.values(G).forEach(s=>$(s).innerHTML='');
  Object.keys(CFG_DEF).forEach(k=>{
    const D=CFG_DEF[k], host=$(G[D.g]); if(!host) return;
    const r=el('div','setrow');
    const nm=el('div'); nm.appendChild(el('div','nm',D.n));
    if(D.d){ const ds=el('div','ds'); ds.innerHTML=D.d; nm.appendChild(ds); }
    r.appendChild(nm);
    let inp;
    if(D.opts){ inp=el('select'); D.opts.forEach(([v,l])=>{const o=el('option'); o.value=v; o.textContent=l; inp.appendChild(o);}); inp.value=String(CFG[k]); }
    else { inp=el('input'); inp.type='number'; inp.step='any'; inp.value=CFG[k]; }
    inp.onchange=()=>{ CFG[k]=D.opts?inp.value:toNum(inp.value); saveAll(); rebuild(); renderAll(); toast('設定を更新しました'); };
    r.appendChild(inp);
    const d=el('div','small muted'); d.textContent='初期値 '+D.v; r.appendChild(d);
    host.appendChild(r);
  });
}

/* =========================================================================
   まとめ描画・イベント・起動
   ========================================================================= */
function renderAll(){
  renderLoad(); renderDash(); renderDay(); renderCal4();
  renderEv(); renderHist(); renderBt(); renderCfg();
}
function bind(){
  $('#tabs').onclick=e=>{ const b=e.target.closest('button'); if(!b) return;
    $$('#tabs button').forEach(x=>x.classList.toggle('on',x===b));
    $$('section.page').forEach(s=>s.classList.toggle('on',s.id==='p-'+b.dataset.tab)); };
  $('#attrSw').onclick=e=>{ const b=e.target.closest('button'); if(!b) return;
    $$('#attrSw button').forEach(x=>x.classList.toggle('on',x===b));
    ATTR=b.dataset.attr; rebuild(); renderAll(); toast('売上帰属を'+ATTR+'時間に切替えました'); };

  // 取込
  const drop=$('#drop'), fi=$('#file');
  $('#pick').onclick=()=>fi.click();
  fi.onchange=()=>{ if(fi.files.length) ingestAll(Array.from(fi.files)); fi.value=''; };
  ['dragenter','dragover'].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault(); drop.classList.add('hot');}));
  ['dragleave','drop'].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();
    if(ev==='drop'||e.relatedTarget===null) drop.classList.remove('hot');}));
  document.addEventListener('drop',async e=>{
    e.preventDefault(); drop.classList.remove('hot');
    const files=[], its=e.dataTransfer.items;
    if(its&&its.length&&its[0].webkitGetAsEntry){
      const walk=async en=> new Promise(res=>{
        if(en.isFile) en.file(f=>{files.push(f); res();});
        else if(en.isDirectory){ const rd=en.createReader();
          const read=()=>rd.readEntries(async es=>{ if(!es.length) return res();
            for(const x of es) await walk(x); read(); }); read(); }
        else res(); });
      const es=[]; for(const it of its){ const en=it.webkitGetAsEntry&&it.webkitGetAsEntry(); if(en) es.push(en); }
      for(const en of es) await walk(en);
    }
    if(!files.length) for(const f of e.dataTransfer.files) files.push(f);
    if(files.length) ingestAll(files);
  });
  $('#dupOver').onclick=()=>{ $('#dupOver').classList.add('on'); $('#dupSkip').classList.remove('on'); };
  $('#dupSkip').onclick=()=>{ $('#dupSkip').classList.add('on'); $('#dupOver').classList.remove('on'); };
  $('#btnWipe').onclick=async()=>{ if(!confirm('取込済みの全データ・観測・提案履歴を削除します。よろしいですか？')) return;
    DB.days={};DB.sales={};DB.names={};DB.cpcSet={};DB.tags={};DB.notes={};
    DB.obs=[];DB.props=[];DB.hourly=null;
    await saveAll(); rebuild(); renderAll(); toast('削除しました'); };

  // ダッシュボード
  $('#dgDate').onchange=renderDash;
  $('#dgLatest').onclick=()=>{ if(AGG.dates.length){ $('#dgDate').value=addDays(AGG.dates[AGG.dates.length-1],1); renderDash(); } };

  // 当日チェック
  $('#dySlot').onclick=e=>{ const b=e.target.closest('button'); if(!b) return;
    $$('#dySlot button').forEach(x=>x.classList.toggle('on',x===b));
    DYSLOT=b.dataset.slot; $('#dyTime').value=fmtHour(slotByKey(DYSLOT).target); renderDay(); };
  $('#dyDate').onchange=renderDay;
  ['#dyCost','#dyClicks'].forEach(s=>$(s).oninput=syncCpc);
  $('#dyNow').onclick=()=>{ const n=new Date();
    $('#dyTime').value=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
    $('#dyDate').value=ymd(n); };
  $('#dyCapped').onclick=()=>$('#dyCapped').classList.toggle('on');
  $('#dyMissing').onclick=()=>{ $('#dyMissing').classList.toggle('on');
    $('#dyMissKind').style.display=$('#dyMissing').classList.contains('on')?'':'none'; };
  $('#dyBackfill').onclick=()=>{ $('#dyBackfill').classList.toggle('on');
    $('#dySave').textContent = $('#dyBackfill').classList.contains('on')
      ? '観測だけ保存（提案は記録しない）' : '観測を保存して提案を記録'; };
  $('#dyRun').onclick=()=>runDay(false);
  $('#dySave').onclick=()=>runDay(true);

  // カレンダー
  $('#c4Base').onchange=()=>{ C4MANUAL=true; renderCal4(); };
  $('#c4Latest').onclick=()=>{ C4MANUAL=false; renderCal4(); };

  // イベント
  $('#evAdd').onclick=()=>{ const f=$('#evFrom').value, t=$('#evTo').value;
    if(!f||!t){ toast('開始日と終了日を入れてください'); return; }
    DB.events.push({type:$('#evType').value, from:f, fromTime:$('#evFromT').value||'20:00',
      to:t>=f?t:f, toTime:$('#evToT').value||'01:59', memo:$('#evMemo').value||''});
    $('#evMemo').value=''; saveAll(); rebuild(); renderAll(); toast('イベントを登録しました'); };

  // 履歴
  $('#hsMonth').onchange=renderHist;
  $('#hsCsv').onclick=()=>{ if(HSROWS) dlCSV('提案実行履歴.csv',HSCOLS.filter(c=>c.k!=='_'),HSROWS); };

  // バックテスト
  $('#btRun').onclick=runBt;
  $('#btReset').onclick=()=>{ $('#btCost').value=30000; $('#btRoas').value=225; runBt(); };
  $('#btApply').onclick=()=>{ CFG.warnCost=toNum($('#btCost').value); CFG.warnRoas=toNum($('#btRoas').value);
    saveAll(); rebuild(); renderAll(); toast('警戒基準を設定に反映しました'); };

  // 設定
  $('#cfgReset').onclick=()=>{ if(!confirm('すべての設定値を初期値に戻しますか？')) return;
    Object.keys(CFG_DEF).forEach(k=>CFG[k]=CFG_DEF[k].v); saveAll(); rebuild(); renderAll(); toast('初期値に戻しました'); };

  // 書出/読込
  $('#btnExport').onclick=()=>{
    const blob=new Blob([JSON.stringify({v:3,cfg:CFG,db:DB})],{type:'application/json'});
    const a=el('a'); a.href=URL.createObjectURL(blob);
    a.download='rpp_v3_backup_'+ymd(new Date())+'.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),3000); toast('JSONを書き出しました'); };
  $('#btnImport').onclick=()=>{
    const i=el('input'); i.type='file'; i.accept='.json';
    i.onchange=async()=>{ const f=i.files[0]; if(!f) return;
      try{ const j=JSON.parse(await f.text());
        if(j.cfg) Object.keys(CFG).forEach(k=>{ if(j.cfg[k]!==undefined) CFG[k]=j.cfg[k]; });
        if(j.db) Object.keys(DB).forEach(k=>{ if(j.db[k]!==undefined) DB[k]=j.db[k]; });
        await saveAll(); rebuild(); renderAll(); toast('復元しました');
      }catch(e){ alert('読込に失敗しました：'+e.message); } };
    i.click(); };
}
(async function boot(){
  bind();
  try{ await loadAll(); }catch(e){ console.warn(e); }
  rebuild(); renderAll();
  if(!AGG.dates.length){
    $$('#tabs button').forEach(x=>x.classList.toggle('on',x.dataset.tab==='load'));
    $$('section.page').forEach(s=>s.classList.toggle('on',s.id==='p-load'));
  }
})();
</script>
</body>
</html>
