const {chromium}=require('playwright');
const path=require('path'); const P=f=>path.resolve(__dirname,'../data/ascii/'+f);
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1560,height:1200}});
  const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  p.on('dialog',d=>d.accept());
  await p.goto('file://'+path.resolve(__dirname,'../index.html'));
  await p.waitForTimeout(500);
  await p.setInputFiles('#file',[P('rppdata.zip'),P('watchlog.xlsx'),P('orderhour.xlsx'),P('events.txt')]);
  await p.waitForFunction(()=>document.querySelector('#log').textContent.includes('── 完了'),{timeout:600000});
  await p.waitForTimeout(3000);
  const log=await p.textContent('#log');
  console.log('=== 取込 ===');
  console.log(log.split('\n').filter(l=>/イベント日程|当日時間別|注文時間帯|完了/.test(l)).join('\n'));

  const r=await p.evaluate(()=>({
    days:AGG.dates.length, first:AGG.dates[0], last:AGG.dates[AGG.dates.length-1],
    missing:AGG.missing, warn:AGG.warn.length, obs:DB.obs.length, events:DB.events.length,
    ev:DB.events.map(e=>e.type+' '+e.from+' '+e.fromTime+'〜'+e.to+' '+e.toTime),
    dtypes:AGG.dates.reduce((a,d)=>{const t=dtLabel(dayType(d));a[t]=(a[t]||0)+1;return a;},{}),
    caps:['2026-08-04','2026-08-05','2026-08-11','2026-08-12','2026-08-25']
      .map(d=>d+'='+dtLabel(dayType(d))+'/'+dayCap(d))
  }));
  console.log('\n=== 集計 ===');
  console.log('日数',r.days,r.first,'〜',r.last,'／欠損',JSON.stringify(r.missing),'／警告',r.warn);
  console.log('当日観測',r.obs,'件／イベント',r.events,'件');
  r.ev.forEach(x=>console.log('  ',x));
  console.log('日タイプ内訳',JSON.stringify(r.dtypes));
  console.log('上限確認',r.caps.join(' | '));

  // カレンダー突合（5月画像）
  const cal=await p.evaluate(()=>['2026-05-01','2026-05-02','2026-05-10','2026-05-24','2026-05-31']
    .map(d=>({d,roas:Math.round(AGG.day[d].roas20),c20:AGG.day[d].c20a,kw:AGG.day[d].kwa,al:AGG.day[d].alla})));
  const exp={'2026-05-01':[213,41256,30014,71270],'2026-05-02':[83,114302,34052,148354],
             '2026-05-10':[894,27168,70804,97972],'2026-05-24':[515,27198,50649,77847],
             '2026-05-31':[185,72672,46469,119141]};
  console.log('\n=== 5月カレンダー画像との突合 ===');
  cal.forEach(x=>{const e=exp[x.d];
    console.log(' ',(x.roas===e[0]&&x.c20===e[1]&&x.kw===e[2]&&x.al===e[3])?'✓':'✗',
      x.d,x.roas+'%',x.c20,x.kw,x.al);});

  console.log('\n=== 画面 ===');
  for(const t of ['dash','day','cal4','ev','hist','bt','load','cfg']){
    await p.click(`#tabs button[data-tab="${t}"]`); await p.waitForTimeout(250);
    console.log(' ',t, await p.isVisible('#p-'+t)?'OK':'NG');
  }
  // ダッシュボード（8/27＝マラソン最終日）
  await p.click('#tabs button[data-tab="dash"]');
  await p.fill('#dgDate','2026-08-27'); await p.waitForTimeout(900);
  console.log('\n[8/27] 判定:',(await p.textContent('#dgMain .lvl')).trim(),
    '／環境:',(await p.textContent('#dgEnv')).replace(/\s+/g,' ').trim());
  console.log('タイル:',await p.locator('#dgTiles .tile .vl').allTextContents());
  await p.fill('#dgDate','2026-05-03'); await p.waitForTimeout(900);
  console.log('[5/3 (前日5/2 ROAS83%)] 判定:',(await p.textContent('#dgMain .lvl')).trim(),
    'タイル:',await p.locator('#dgTiles .tile .vl').allTextContents());

  // 当日チェック 3枠
  await p.click('#tabs button[data-tab="day"]');
  await p.fill('#dyDate','2026-08-26');
  for(const [slot,cost,clicks,budget] of [['s0930',25558,1545,40000],['s1500',48000,2600,40000],['s1830',66277,3621,50000]]){
    await p.click(`#dySlot button[data-slot="${slot}"]`); await p.waitForTimeout(200);
    await p.fill('#dyClicks',String(clicks)); await p.fill('#dyCost',String(cost)); await p.fill('#dyBudget',String(budget));
    await p.click('#dyRun'); await p.waitForTimeout(600);
    console.log(slot,'→',(await p.textContent('#dyResult .lvl')).trim(),
      '|',(await p.textContent('#dyResult .score')).trim(),
      '|',(await p.locator('#dyResult .tag').first().textContent()).trim());
  }
  await p.click('#dySave'); await p.waitForTimeout(800);
  console.log('提案記録:',await p.evaluate(()=>DB.props.length),'件／観測:',await p.evaluate(()=>DB.obs.filter(o=>o.src==='manual').length));

  // 未観測
  await p.click('#dyMissing'); await p.click('#dyRun'); await p.waitForTimeout(300);
  await p.click('#dySave'); await p.waitForTimeout(500);
  console.log('未観測記録:',await p.evaluate(()=>DB.obs.filter(o=>o.missing).length),'件');
  await p.click('#dyMissing');

  // カレンダー
  await p.click('#tabs button[data-tab="cal4"]'); await p.waitForTimeout(900);
  console.log('\n月ボックス:',await p.locator('#c4Grid .mbox').count(),
    '／セル:',await p.locator('#c4Grid .c4c:not(.void)').count(),
    '／欠損:',await p.locator('#c4Grid .miss').count());
  const c=await p.evaluate(()=>Array.from(document.querySelectorAll('#c4Grid .mbox')).map(m=>
    m.querySelector('h4').textContent+' '+m.querySelector('.msub').textContent.replace(/\s+/g,' ')));
  c.forEach(x=>console.log('  ',x));

  // バックテスト
  await p.click('#tabs button[data-tab="bt"]');
  await p.click('#btRun'); await p.waitForTimeout(4000);
  console.log('\nBTタイル:',await p.locator('#btTiles .tile .vl').allTextContents());
  console.log('BT行:',await p.locator('#btTable tbody tr').count(),'／スイープ行:',await p.locator('#btSweep tbody tr').count());

  // 履歴
  await p.click('#tabs button[data-tab="hist"]'); await p.waitForTimeout(600);
  console.log('履歴タイル:',await p.locator('#hsTiles .tile .vl').allTextContents());
  const sel=p.locator('#hsTable tbody tr').first().locator('select');
  if(await sel.count()){ await sel.selectOption('same'); await p.waitForTimeout(600);
    console.log('実行記録後:',await p.evaluate(()=>JSON.stringify(DB.props.map(x=>x.doneKind)))); }

  await p.reload(); await p.waitForTimeout(2500);
  console.log('\nリロード後:',await p.evaluate(()=>JSON.stringify(
    {days:AGG.dates.length,obs:DB.obs.length,props:DB.props.length,events:DB.events.length})));
  console.log('エラー:',errs.length?errs.slice(0,8).join('\n'):'なし');
  await b.close();
})();
