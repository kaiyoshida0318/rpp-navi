const {chromium}=require('playwright');
const path=require('path'); const P=f=>path.resolve(__dirname,'../data/ascii/'+f);
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+path.resolve(__dirname,'../index.html'));
  await p.waitForTimeout(400);
  await p.setInputFiles('#file',[P('rppdata.zip'),P('watchlog.xlsx'),P('events.txt')]);
  await p.waitForFunction(()=>document.querySelector('#log').textContent.includes('── 完了'),{timeout:600000});
  await p.waitForTimeout(2500);
  const before=await p.evaluate(()=>({obs:DB.obs.length,props:DB.props.length}));
  await p.click('#tabs button[data-tab="day"]');
  // 通常入力（提案も記録）
  await p.fill('#dyDate','2026-08-22');
  await p.click('#dySlot button[data-slot="s1500"]'); await p.waitForTimeout(150);
  await p.fill('#dyClicks','1800'); await p.fill('#dyCost','38000'); await p.fill('#dyBudget','50000');
  await p.click('#dySave'); await p.waitForTimeout(600);
  const mid=await p.evaluate(()=>({obs:DB.obs.length,props:DB.props.length}));
  // 後日まとめて入力（提案は記録しない）
  await p.click('#dyBackfill'); await p.waitForTimeout(150);
  console.log('保存ボタン文言:', (await p.textContent('#dySave')).trim());
  await p.fill('#dyDate','2026-08-16');
  await p.fill('#dyClicks','1500'); await p.fill('#dyCost','30000'); await p.fill('#dyBudget','45000');
  await p.click('#dyRun'); await p.waitForTimeout(500);
  console.log('後日入力の注記:', /後日まとめて入力モード/.test(await p.textContent('#dyResult'))?'あり ✓':'なし');
  await p.click('#dySave'); await p.waitForTimeout(700);
  const after=await p.evaluate(()=>({obs:DB.obs.length,props:DB.props.length}));
  console.log('取込直後   :',JSON.stringify(before));
  console.log('通常入力後 :',JSON.stringify(mid),'→ obs+1 props+1 期待');
  console.log('後日入力後 :',JSON.stringify(after),'→ obs+1 props+0 期待');
  console.log(mid.obs===before.obs+1&&mid.props===before.props+1?'✓ 通常入力OK':'✗ 通常入力NG');
  console.log(after.obs===mid.obs+1&&after.props===mid.props?'✓ 後日入力OK（提案は記録されない）':'✗ 後日入力NG');
  // 学習に反映されているか
  console.log('15:00の使える日数:', await p.evaluate(()=>slotStatus().find(s=>s.key==='s1500').clean));
  console.log('errors:',errs.length?errs.join(';'):'なし');
  await b.close();
})();
