const {chromium}=require('playwright');
const path=require('path'); const P=f=>path.resolve(__dirname,'../data/ascii/'+f);
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1560,height:1100}});
  p.on('dialog',d=>d.accept());
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+path.resolve(__dirname,'../index.html'));
  await p.waitForTimeout(400);
  await p.setInputFiles('#file',[P('rppdata.zip'),P('watchlog.xlsx'),P('orderhour.xlsx'),P('events.txt')]);
  await p.waitForFunction(()=>document.querySelector('#log').textContent.includes('── 完了'),{timeout:600000});
  await p.waitForTimeout(3000);
  const cases=[
    ['強警戒/クリック急増/上限到達', '2026-05-03','s1500',41000,2100,35000,true],
    ['強警戒/クリック通常/上限到達', '2026-05-03','s1500',30000,1200,35000,true],
    ['強警戒/実績額異常',           '2026-05-03','s0930',30000,1400,20000,false],
    ['強警戒/想定内',               '2026-05-03','s0930',9000,450,20000,false],
    ['強警戒/18:30/上限到達',       '2026-05-03','s1830',33000,1600,33000,true],
    ['通常/想定内/9:30',            '2026-05-20','s0930',12000,600,30000,false],
    ['通常/実績額異常/15:00',       '2026-05-20','s1500',60000,3000,60000,false],
    ['通常/好調で遅い/18:30',       '2026-05-20','s1830',25000,1200,30000,false],
  ];
  await p.click('#tabs button[data-tab="day"]');
  for(const [nm,d,slot,cost,clicks,budget,capped] of cases){
    await p.fill('#dyDate',d);
    await p.click(`#dySlot button[data-slot="${slot}"]`); await p.waitForTimeout(150);
    await p.fill('#dyCost',String(cost)); await p.fill('#dyClicks',String(clicks)); await p.fill('#dyBudget',String(budget));
    const on=await p.evaluate(()=>document.querySelector('#dyCapped').classList.contains('on'));
    if(on!==capped) await p.click('#dyCapped');
    await p.click('#dyRun'); await p.waitForTimeout(450);
    const lvl=(await p.textContent('#dyResult .lvl')).trim();
    const sc=(await p.textContent('#dyResult .score')).trim();
    console.log(nm.padEnd(28),'→',lvl.padEnd(12),'|',sc);
  }
  console.log('errors:',errs.length?errs.join(';'):'なし');
  await b.close();
})();
