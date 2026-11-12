/* Run against scripts/mirror/run.mjs. Reads live images only in browser memory. */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH);
(async()=>{
 const origin=process.env.WOKENET_MIRROR_ORIGIN||'http://127.0.0.1:5173';
 const browser=await chromium.launch({headless:true,channel:'msedge'}),report=[];
 try{
  for(const width of [390,640,900,1280]){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(origin+'/kitchen-cameras');
   await page.waitForSelector('.kc',{timeout:20000});await page.evaluate(()=>document.fonts.ready);
   const banner=page.getByRole('banner'),main=page.getByRole('main');
   assert(await banner.isVisible());assert(await main.isVisible());
   const layout=await page.evaluate(()=>{
    const banner=document.querySelector('[role="banner"]'),main=document.querySelector('[role="main"]'),root=document.querySelector('.kc');
    const box=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    return {viewport:innerWidth,document_width:document.documentElement.scrollWidth,banner:box(banner),main:box(main),player:box(root),
     font:getComputedStyle(root).fontFamily,header_overflow:banner.scrollWidth>banner.clientWidth+1};
   });
   assert(layout.document_width<=width,JSON.stringify(layout));assert(!layout.header_overflow,JSON.stringify(layout));
   assert(layout.main.bottom<=901,JSON.stringify(layout));
   assert(layout.player.right<=width+1,JSON.stringify(layout));assert.match(layout.font,/BerkeleyMono/);
   if(width<1280){
    const toggle=page.getByRole('button',{name:'Open navigation',exact:true});assert(await toggle.isVisible());
    await toggle.click();const menu=page.getByRole('navigation',{name:'Mobile',exact:true});assert(await menu.isVisible());
    const camera=menu.getByRole('link',{name:'Kitchen cameras',exact:true});assert.equal(await camera.getAttribute('aria-current'),'page');
    await camera.click();assert(await menu.isHidden());
    await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    await menu.getByRole('link',{name:'Kitchen cameras',exact:true}).focus();await page.keyboard.press('Escape');
    assert(await menu.isHidden());assert.equal(await page.locator('#navigation-toggle').evaluate(el=>el===document.activeElement),true);
   }else{
    const nav=page.getByRole('navigation',{name:'Primary',exact:true});assert(await nav.isVisible());
    assert.equal(await nav.getByRole('link',{name:'Kitchen cameras',exact:true}).getAttribute('aria-current'),'page');
    assert(await page.locator('#navigation-toggle').isHidden());
   }
   assert.deepEqual(errors,[]);report.push({width,passed:true,...layout,camera_images_exported:false});await context.close();
  }
  console.log(JSON.stringify({passed:true,fixture:'assembled read-only local Wokenet mirror',checks:report},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exit(1)});
