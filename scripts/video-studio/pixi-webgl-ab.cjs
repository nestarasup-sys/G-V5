'use strict'
const { app,BrowserWindow }=require('electron')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const { pathToFileURL }=require('node:url')

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('force-device-scale-factor','1')

app.whenReady().then(async()=>{
  const gpuInfo=await app.getGPUInfo('basic').catch(()=>null)
  const gpuFeatures=app.getGPUFeatureStatus()
  const gpuText=JSON.stringify({gpuInfo,gpuFeatures}).toLowerCase()
  const softwareGpu=/swiftshader|software|llvmpipe|microsoft basic render/.test(gpuText)
  if(gpuFeatures.webgl!=='enabled'||softwareGpu){
    console.log(JSON.stringify({ok:true,supported:false,reason:'Hosted runner has no eligible hardware WebGL path',gpuFeatures,gpuInfo},null,2))
    app.exit(0);return
  }
  const entry=require.resolve('pixi.js')
  const pixiUrl=pathToFileURL(entry).href
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-pixi-ab-'))
  const html=path.join(root,'bench.html')
  fs.writeFileSync(html,`<!doctype html><html><body><script type="module">
import {Application,Container,Graphics} from ${JSON.stringify(pixiUrl)};
const width=960,height=540,frames=12,objects=48;
function canvasBench(){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true});
  const started=performance.now();let checksum=0;
  for(let frame=0;frame<frames;frame++){
    ctx.fillStyle='#203040';ctx.fillRect(0,0,width,height);
    for(let i=0;i<objects;i++){
      ctx.save();ctx.translate((i%8)*120+60+Math.sin((frame+i)/9)*18,Math.floor(i/8)*67+34);
      ctx.rotate((frame+i)*0.005);ctx.fillStyle=i%2?'#b05cff':'#36d8d0';ctx.fillRect(-35,-22,70,44);ctx.restore();
    }
    const pixels=ctx.getImageData(0,0,width,height).data;checksum=(checksum+pixels[(frame*7919)%pixels.length])>>>0;
  }
  return{elapsedMs:performance.now()-started,checksum};
}
async function pixiBench(){
  const app=new Application();await app.init({width,height,backgroundColor:0x203040,preference:'webgl',autoStart:false,antialias:false,resolution:1});
  const root=new Container();app.stage.addChild(root);const graphics=[];
  for(let i=0;i<objects;i++){const g=new Graphics().rect(-35,-22,70,44).fill(i%2?0xb05cff:0x36d8d0);g.x=(i%8)*120+60;g.y=Math.floor(i/8)*67+34;root.addChild(g);graphics.push(g);}
  app.renderer.render(app.stage);app.renderer.extract.pixels(app.stage);
  const started=performance.now();let checksum=0;
  for(let frame=0;frame<frames;frame++){
    for(let i=0;i<objects;i++){graphics[i].x=(i%8)*120+60+Math.sin((frame+i)/9)*18;graphics[i].rotation=(frame+i)*0.005;}
    app.renderer.render(app.stage);
    const result=app.renderer.extract.pixels(app.stage);checksum=(checksum+result.pixels[(frame*7919)%result.pixels.length])>>>0;
  }
  const elapsedMs=performance.now()-started;app.destroy(true,{children:true});
  return{elapsedMs,checksum};
}
function median(values){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];}
window.__resultPromise=(async()=>{
  const canvasSamples=[],pixiSamples=[];
  for(let round=0;round<2;round++){
    if(round%2===0){canvasSamples.push(canvasBench());pixiSamples.push(await pixiBench());}
    else{pixiSamples.push(await pixiBench());canvasSamples.push(canvasBench());}
  }
  const canvasMedianMs=median(canvasSamples.map(x=>x.elapsedMs));
  const pixiMedianMs=median(pixiSamples.map(x=>x.elapsedMs));
  return{ok:true,width,height,frames,objects,rounds:2,canvasSamples,pixiSamples,canvasMedianMs,pixiMedianMs,speedup:canvasMedianMs/pixiMedianMs};
})();
</script></body></html>`)
  const win=new BrowserWindow({show:false,width:960,height:540,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
  try{
    await win.loadFile(html)
    const result=await Promise.race([
      win.webContents.executeJavaScript('(async()=>{while(!window.__resultPromise)await new Promise(r=>setTimeout(r,10));return await window.__resultPromise})()',true),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Pixi A/B excedeu 75 segundos.')),75000)),
    ])
    if(!result?.ok||!Number.isFinite(result.pixiMedianMs)||result.pixiMedianMs<=0)throw new Error('Pixi benchmark did not return valid timing.')
    console.log(JSON.stringify({...result,supported:true,machine:{platform:process.platform,release:os.release(),cpu:os.cpus()[0]?.model??'unknown',logicalCpuCount:os.cpus().length,totalMemoryBytes:os.totalmem()},gpuInfo,gpuFeatures},null,2))
  }finally{
    if(!win.isDestroyed())win.destroy()
    fs.rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:100})
    app.exit(0)
  }
}).catch(error=>{console.error(error.stack||error.message);process.exitCode=1;app.exit(1)})
