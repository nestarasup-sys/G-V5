import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { compileVideoScene, evaluateVideoSceneFrame, type VideoSceneFrame } from '../../../../shared/videoSceneIR'
import { videoCharacterTrackColor, type VideoCharacterState } from '../../../../shared/studio'
import { VIDEO_STAGE_HEIGHT, VIDEO_STAGE_WIDTH, videoStageCssTransform } from '../../../../shared/videoStageGeometry'
import { defaultVideoTransform } from '../../../../shared/videoMedia'
import { VideoCharacterFrameRenderer } from './videoCharacterFrameRenderer'
import { VideoStudioDomElement } from './VideoStudioDomElement'
import { VideoExportMediaFramePool } from './videoExportMediaFramePool'
import './VideoStudioEditor.css'

function jobIdFromHash(): string {
  const query=window.location.hash.includes('?')?window.location.hash.slice(window.location.hash.indexOf('?')+1):''
  const value=new URLSearchParams(query).get('jobId')??''
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Oracle recebeu jobId inválido.')
  return value
}
function errorMessage(reason:unknown){return reason instanceof Error?reason.message:String(reason)}
async function painted(){await new Promise<void>(r=>requestAnimationFrame(()=>r()));await new Promise<void>(r=>requestAnimationFrame(()=>r()))}

type OracleState={scene:VideoSceneFrame;characters:ReadonlyMap<string,VideoCharacterState>;videoDataUrls:ReadonlyMap<string,string>}

function bitmapDataUrl(bitmap:CanvasImageSource):string{
  const width='width' in bitmap?Number(bitmap.width):0
  const height='height' in bitmap?Number(bitmap.height):0
  if(!width||!height)throw new Error('Frame do oracle de vídeo está vazio.')
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
  const context=canvas.getContext('2d');if(!context)throw new Error('Canvas auxiliar do oracle indisponível.')
  context.drawImage(bitmap,0,0,width,height)
  return canvas.toDataURL('image/png')
}

export function VideoPreviewOraclePage(){
  const [state,setState]=useState<OracleState|null>(null)
  const bootstrapRef=useRef<Awaited<ReturnType<typeof window.desktop.prepareVideoExportSurface>>|null>(null)

  useEffect(()=>{
    let disposed=false
    let renderer:VideoCharacterFrameRenderer|null=null
    let mediaPool:VideoExportMediaFramePool|null=null
    let unsubscribe:(()=>void)|null=null
    let jobId=''
    const bootstrap=(async()=>{
      jobId=jobIdFromHash()
      const data=await window.desktop.prepareVideoExportSurface(jobId)
      bootstrapRef.current=data
      await document.fonts.ready
      if(disposed) throw new DOMException('Oracle descartado.','AbortError')
      renderer=new VideoCharacterFrameRenderer(data.characters,data.characterAssets)
      mediaPool=new VideoExportMediaFramePool(jobId)
      return {data,program:compileVideoScene(data.snapshot,data.renderVariant)}
    })()

    unsubscribe=window.desktop.onVideoExportSurfaceRender((request)=>{
      void (async()=>{
        try{
          const runtime=await bootstrap
          const scene=evaluateVideoSceneFrame(runtime.program,request.frame)
          const [characters,videoFrames]=await Promise.all([renderer!.renderFrame(scene),mediaPool!.framesForScene(scene)])
          const videoDataUrls=new Map([...videoFrames.entries()].map(([clipId,frame])=>[clipId,bitmapDataUrl(frame)]))
          if(disposed) throw new DOMException('Oracle descartado.','AbortError')
          flushSync(()=>setState({scene,characters,videoDataUrls}))
          await painted()
          if(!disposed) window.desktop.reportVideoExportSurfaceFrame({requestId:request.requestId,frame:request.frame})
        }catch(reason){
          if(!disposed) window.desktop.reportVideoExportSurfaceFrame({requestId:request.requestId,frame:request.frame,error:errorMessage(reason)})
        }
      })()
    })
    void bootstrap.then(()=>{if(!disposed)window.desktop.reportVideoExportSurfaceReady({jobId})}).catch(reason=>{
      if(!disposed)window.desktop.reportVideoExportSurfaceReady({jobId:jobId||'invalid',error:errorMessage(reason)})
    })
    return()=>{disposed=true;unsubscribe?.();renderer?.clear();mediaPool?.dispose()}
  },[])

  const data=bootstrapRef.current
  const scene=state?.scene
  return <div
    className="video-studio-scene-canvas"
    style={{position:'fixed',inset:0,width:VIDEO_STAGE_WIDTH,height:VIDEO_STAGE_HEIGHT,maxHeight:'none',aspectRatio:'auto',border:0,borderRadius:0,boxShadow:'none',backgroundColor:scene?.background.color??'#000',overflow:'hidden'}}
  >
    {scene?.background.assetDataUrl&&<img
      className="video-studio-canvas-background"
      src={scene.background.assetDataUrl}
      alt=""
      style={videoStageCssTransform(scene.background.x,scene.background.y,scene.background.width,scene.background.height,scene.background.rotation)}
    />}
    {scene?.layers.map((layer)=>{
      if(layer.type==='video'){
        const source=state?.videoDataUrls.get(layer.clipId)
        if(!source)return null
        const transform=layer.transform??defaultVideoTransform
        return <div key={layer.clipId} className="video-studio-video-composition" style={{...videoStageCssTransform(transform.x,transform.y,transform.width,transform.height,transform.rotation),zIndex:layer.zOrder,pointerEvents:'none'}}>
          <img src={source} alt="" style={{width:'100%',height:'100%',objectFit:'contain',display:'block'}}/>
        </div>
      }
      let element=layer.element
      let imageDataUrl=layer.assetDataUrl
      if(element.kind==='character'){
        const rendered=state?.characters.get(element.id)
        if(rendered){element=rendered.element;imageDataUrl=rendered.imageDataUrl}
      }
      const studio=data?.snapshot.studio
      const asset=element.assetId?studio?.assets.find(item=>item.id===element.assetId):undefined
      const speaker=element.speakerCharacterId?studio?.elements.find(item=>item.id===element.speakerCharacterId&&item.kind==='character'):undefined
      const speakerName=speaker?.text||element.speakerName
      const speakerColor=videoCharacterTrackColor(element.speakerCharacterId??element.id,speaker?.timelineColor??element.speakerColor)
      return <VideoStudioDomElement key={layer.clipId??element.id} element={element} imageDataUrl={imageDataUrl} assetName={asset?.name} speakerName={speakerName} speakerColor={speakerColor}/>
    })}
  </div>
}
