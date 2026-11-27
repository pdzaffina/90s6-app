import {strict as assert} from 'node:assert';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');

const root=resolve(import.meta.dirname,'..');
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript'};
const server=createServer(async(request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');
  const path=resolve(root,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));
  if(!path.startsWith(root+'/')){response.writeHead(404).end();return}
  try{
    const contents=await readFile(path);
    response.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'});
    response.end(contents);
  }catch{response.writeHead(404).end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
const id='7b204dee-dd77-4215-a77a-cf951b36d5ff';
const watch='489edd77-dd77-4215-a77a-cf951b36d5ff';
const owner='6b04c1cc-62f6-428a-a4b7-a1db107bb3ba';
const report={version:1,summary:{text:'A regulatory filing was collected.',sources:[1]},
  developments:[{kind:'verified_fact',text:'A new filing appeared.',sources:[1]}],implications:[],
  risks:[{text:'Information is limited.',category:'financial_stability',severity:'high',direction:'unknown',confidence:'low',sources:[1]}],
  opportunities:[],recommendations:[],confidence:'low',limitations:['Only filing metadata was available.']};
const fixture={
  sentinel_watches:[{id:watch,owner_id:owner,active:true,category:'Suppliers',relationship_type:'supplier',name:'Fixture company'}],
  sentinel_scan_runs:[{id,watch_id:watch,created_at:new Date().toISOString(),status:'complete',assessment:JSON.stringify(report),
    evidence:[{url:'https://example.com/filing',title:'Supporting filing',source:'Test source',new_development:true}]},
  {id:'1b204dee-dd77-4215-a77a-cf951b36d5f1',watch_id:watch,created_at:new Date().toISOString(),status:'running',stage:'assessment',
    error:'A fallback provider was used.',evidence:[{url:'https://example.com/news',title:'Working evidence'}]}],
};
try{
  for(const viewport of [{width:1366,height:850},{width:390,height:844}]){
    const page=await browser.newPage({viewport});
    const errors=[];
    page.on('pageerror',e=>errors.push(e));
    await page.route('https://cdn.jsdelivr.net/**',route=>route.abort());
    await page.route('**/shared/app.js*',route=>route.fulfill({contentType:'text/javascript',body:`
      const fixtures=${JSON.stringify(fixture)};
      window.App={activeTenantId:'test-org', onSession(fn){void fn({user:{id:${JSON.stringify(owner)}}},{})},
        sb:{rpc:async()=>({data:false,error:null}),from(table){
          const query={select(){return this},eq(){return this},order(){return this},limit(){return this},
            then(resolve){resolve({data:fixtures[table]||[],error:null})}};
          return query;
        }}};
    `}));
    await page.goto('http://127.0.0.1:'+server.address().port+'/news-watch/?section=assessments&assessment='+id);
    await page.getByText('A regulatory filing was collected.',{exact:false}).first().waitFor();
    assert.equal(await page.getByText('Financial stability · High · Unknown · Low confidence.',{exact:false}).count(),1);
    assert.equal(await page.getByRole('link',{name:'Source 1',exact:true}).first().getAttribute('href'),'#source-'+id+'-1');
    assert.equal(await page.getByText(/"version":1/).count(),0);
    await page.reload();
    await page.getByRole('link',{name:'Supporting filing'}).waitFor();
    await page.getByRole('button',{name:'Scan history'}).click();
    await page.getByText(/Generating assessment/).waitFor();
    assert.equal(await page.getByText('A fallback provider was used.').count(),0);
    assert.equal(await page.getByText(/No AI assessment available/).count(),0);
    await page.getByRole('button',{name:'Watchlist'}).click();
    await page.getByRole('button',{name:'Edit',exact:true}).first().click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('Sentinel desktop and mobile browser checks passed');
} finally {
  await browser.close();
  server.close();
}
