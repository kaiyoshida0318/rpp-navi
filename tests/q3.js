const {chromium}=require('playwright');
const path=require('path'); const P=f=>path.resolve(__dirname,'../data/ascii/'+f);
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage();
  p.on('pageerror',e=>console.log('ERR',e.message));
  await p.goto('file://'+path.resolve(__dirname,'../index.html'));
  await p.waitForTimeout(400);
  await p.setInputFiles('#file',[P('rppdata.zip'),P('watchlog.xlsx'),P('orderhour.xlsx'),P('events.txt')]);
  await p.waitForFunction(()=>document.querySelector('#log').textContent.includes('── 完了'),{timeout:600000});
  await p.waitForTimeout(2500);
  // 上限到達日の18:30記録が「どちら向きにずれるか」を実データで確認
  console.log(await p.evaluate(()=>{
    const out=[];
    const byDate={}; DB.obs.forEach(o=>{ (byDate[o.date]=byDate[o.date]||[]).push(o); });
    for(const d of Object.keys(byDate).sort()){
      const o=byDate[d].find(x=>x.slot==='s1830'); if(!o||!o.cost) continue;
      const fin=dayFinal(d);
      out.push(d+'  18:30='+String(o.cost).padStart(6)+(o.capped?'[停止]':'      ')
        +'  最終='+String(fin).padStart(6)+'  比率='+(o.cost/fin*100).toFixed(1)+'%');
    }
    return out.join('\n');
  }));
  // 超過提案の抑制を確実に踏むケース
  await p.evaluate(()=>{ CFG.capNormal=30000; saveAll(); rebuild(); renderAll(); });
  await p.waitForTimeout(800);
  await p.click('#tabs button[data-tab="day"]');
  await p.fill('#dyDate','2026-08-13');   // 通常日／前日8/12 の20円ROAS を確認
  console.log('\n8/13の前日情報:', await p.evaluate(()=>{
    const M=morningPlan('2026-08-13');
    return M.levelName+' 前日ROAS='+Math.round(M.prevRoas)+'% cap='+M.cap+' planTotal='+M.planTotal;}));
  await p.click('#dySlot button[data-slot="s1830"]'); await p.waitForTimeout(200);
  await p.fill('#dyClicks','900'); await p.fill('#dyCost','20000'); await p.fill('#dyBudget','25000');
  await p.click('#dyRun'); await p.waitForTimeout(600);
  const txt=await p.textContent('#dyResult');
  console.log('判定:',(await p.textContent('#dyResult .lvl')).trim(),'|',(await p.textContent('#dyResult .score')).trim());
  console.log('  超過抑制の説明文:', /超過提案は行いません/.test(txt)?'あり ✓':'なし');
  console.log('  【上限超過提案】タグ:', /上限超過提案/.test(txt)?'出ている':'出ていない ✓');
  // 信頼度を高くしたら超過提案が出るか（overNeedConf の効き確認）
  await p.evaluate(()=>{ CFG.overNeedConf='0'; saveAll(); rebuild(); renderAll(); });
  await p.waitForTimeout(600);
  await p.click('#dyRun'); await p.waitForTimeout(600);
  const t2=await p.textContent('#dyResult');
  console.log('  overNeedConf=0 にすると:', /上限超過提案/.test(t2)?'超過提案が出る ✓':'出ない');
  await b.close();
})();
