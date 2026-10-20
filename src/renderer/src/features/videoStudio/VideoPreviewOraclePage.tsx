import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { compileVideoScene, evaluateVideoSceneFrame, type VideoSceneFrame } from '../../../../shared/videoSceneIR'
import { videoCharacterTrackColor, type VideoCharacterState } from '../../../../shared/studio'
import { VIDEO_STAGE_HEIGHT, VIDEO_STAGE_WIDTH, videoStageCssTransform } from '../../../../shared/videoStageGeometry'
import { VideoCharacterFrameRenderer } from './videoCharacterFrameRenderer'
import { VideoStudioDomElement } from './VideoStudioDomElement'
import { VideoStudioClipPreview } from './VideoClipPreview'
import './VideoStudioEditor.css'

function jobIdFromHash(): string {
  const query=window.location.hash.includes('?')?window.location.hash.slice(window.location.hash.indexOf('?')+1):''
  const value=new URLSearchParams(query).get('jobId')??''
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Oracle recebeu jobId inválido.')
  return value
}
function errorMessage(reason:unknown){return reason instanceof Error?reason.message:String(reason)}
async function painted(){await new Promise<void>(r=>requestAnimationFrame(()=>r()));await new Promise<void>(r=>requestAnimationFrame(()=>r()))}

type OracleState={scene:VideoSceneFrame;characters:ReadonlyMap<string,VideoCharacterState>}
type PendingOracleFrame={requestId:string;frame:number;waitingVideoClips:Set<string>;reported:boolean}

export function VideoPreviewOraclePage(){
  const [state,setState]=useState<OracleState|null>(null)
  const bootstrapRef=useRef<Awaited<ReturnType<typeof window.desktop.prepareVideoExportSurface>>|null>(null)
  const pendingFrameRef=useRef<PendingOracleFrame|null>(null)
  const onVideoFramePresented=useCallback((frame:number,clipId:string)=>{
    const pending=pendingFrameRef.current
    if(!pending||pending.reported||pending.frame!==frame||!pending.waitingVideoClips.has(clipId))return
    pending.waitingVideoClips.delete(clipId)
    if(pending.waitingVideoClips.size!==0)return
    pending.reported=true
    window.desktop.reportVideoExportSurfaceFrame({requestId:pending.requestId,frame:pending.frame})
  },[])
  const onVideoPlaybackError=useCallback((message:string)=>{
    const pending=pendingFrameRef.current
    if(!pending||pending.reported)return
    pending.reported=true
    window.desktop.reportVideoExportSurfaceFrame({requestId:pending.requestId,frame:pending.frame,error:message})
  },[])

  useEffect(()=>{
    let disposed=false
    let renderer:VideoCharacterFrameRenderer|null=null
    let unsubscribe:(()=>void)|null=null
    let jobId=''
    const bootstrap=(async()=>{
      jobId=jobIdFromHash()
      const data=await window.desktop.prepareVideoExportSurface(jobId)
      bootstrapRef.current=data
      await document.fonts.ready
      if(disposed) throw new DOMException('Oracle descartado.','AbortError')
      renderer=new VideoCharacterFrameRenderer(data.characters,data.characterAssets)
      return {data,program:compileVideoScene(data.snapshot,data.renderVariant)}
    })()

    unsubscribe=window.desktop.onVideoExportSurfaceRender((request)=>{
      void (async()=>{
        try{
          const runtime=await bootstrap
          const scene=evaluateVideoSceneFrame(runtime.program,request.frame)
          const characters=await renderer!.renderFrame(scene)
          if(disposed) throw new DOMException('Oracle descartado.','AbortError')
          pendingFrameRef.current={requestId:request.requestId,frame:request.frame,waitingVideoClips:new Set(scene.videos.map((video)=>video.clipId)),reported:false}
          flushSync(()=>setState({scene,characters}))
          await painted()
          const pending=pendingFrameRef.current
          if(!disposed&&pending&&pending.requestId===request.requestId&&pending.waitingVideoClips.size===0&&!pending.reported){
            pending.reported=true
            window.desktop.reportVideoExportSurfaceFrame({requestId:pending.requestId,frame:pending.frame})
          }
        }catch(reason){
          if(!disposed) window.desktop.reportVideoExportSurfaceFrame({requestId:request.requestId,frame:request.frame,error:errorMessage(reason)})
        }
      })()
    })
    void bootstrap.then(()=>{if(!disposed)window.desktop.reportVideoExportSurfaceReady({jobId})}).catch(reason=>{
      if(!disposed)window.desktop.reportVideoExportSurfaceReady({jobId:jobId||'invalid',error:errorMessage(reason)})
    })
    return()=>{disposed=true;unsubscribe?.();renderer?.clear();pendingFrameRef.current=null}
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
        const clip=data?.snapshot.timeline.videoClips?.find((item)=>item.id===layer.clipId)
        const asset=data?.snapshot.timeline.videoAssets?.find((item)=>item.id===layer.assetId)
        if(!data||!clip||!asset||!scene)return null
        return <VideoStudioClipPreview key={layer.clipId} studioId={data.snapshot.studio.id} asset={asset} clip={clip} playheadFrame={scene.frame} playing={false} onPlaybackError={onVideoPlaybackError} onFramePresented={onVideoFramePresented} selected={false} editable={false} onSelect={()=>{}} onBeginEdit={()=>{}} onTransform={()=>{}}/>
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
