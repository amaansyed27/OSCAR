// Resume the bounded follow-up acceptance profile after an output-limit interruption.
const desktop=require('./desktop-driver.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('.oscar/completion');let app;
(async()=>{
 const dir=fs.readdirSync(out).filter(n=>/^followup-\d+$/.test(n)).sort().at(-1);assert(dir);
 app=await desktop.launch({env:{...process.env,OSCAR_DATA_DIR:path.join(out,dir)}});
 const page=await app.firstWindow();await page.locator('html[data-theme]').waitFor();
 const api=(n,a)=>page.evaluate(([n,a])=>window.oscar[n](a),[n,a]);
 const before=await api('history');const user=before.filter(m=>m.role==='user'&&m.status==='failed').at(-1);assert.equal(user.status,'failed');
 await api('registerModel',{provider:'openrouter',model:'nvidia/nemotron-3.5-super-vl:free',output:4096});
 await api('send',{text:user.content,retryId:user.id});
 const after=await api('history');assert.equal(after.filter(m=>m.role==='user').length,before.filter(m=>m.role==='user').length);
 const answer=after.filter(m=>m.role==='assistant').at(-1);assert.equal(answer.status,'complete');
 const details=await api('responseDetails',answer.id);
 assert(details.sources.some(s=>new URL(s.url).hostname==='go.dev'));
 assert(details.sources.some(s=>new URL(s.url).hostname==='doc.rust-lang.org'));
 const receipt={passed:true,retrySameUser:true,answer:answer.content,details,diagnostics:await api('diagnostics')};
 fs.writeFileSync(path.join(out,'research-retry.json'),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({passed:true,sources:details.sources.map(s=>s.url)}));
})().catch(e=>{console.error(String(e));process.exitCode=1}).finally(async()=>{if(app)await app.close()});
