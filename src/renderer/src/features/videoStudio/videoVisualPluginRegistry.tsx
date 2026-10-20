import type { ReactNode } from 'react'
import type { StudioElement, VideoCharacterState } from '../../../../shared/studio'
import type { VideoSceneFrame, VideoSceneLayer } from '../../../../shared/videoSceneIR'

export type VideoVisualPluginContext = Readonly<{
  frame?: VideoSceneFrame
  layer?: Extract<VideoSceneLayer,{type:'element'}>
  element: StudioElement
  imageDataUrl?: string
  characterState?: VideoCharacterState
}>

export type VideoVisualPlugin = Readonly<{
  id:string
  priority?:number
  matches:(context:VideoVisualPluginContext)=>boolean
  renderCanvas?:(context:VideoVisualPluginContext,canvas:CanvasRenderingContext2D)=>Promise<boolean>|boolean
  renderDom?:(context:VideoVisualPluginContext)=>ReactNode
}>

const plugins:VideoVisualPlugin[]=[]

export function registerVideoVisualPlugin(plugin:VideoVisualPlugin):()=>void{
  if(!plugin?.id||plugins.some((candidate)=>candidate.id===plugin.id)) throw new Error('Plugin visual duplicado ou inválido.')
  plugins.push(plugin)
  plugins.sort((a,b)=>(b.priority??0)-(a.priority??0)||a.id.localeCompare(b.id))
  return()=>{
    const index=plugins.findIndex((candidate)=>candidate.id===plugin.id)
    if(index>=0) plugins.splice(index,1)
  }
}

export function matchingVideoVisualPlugin(context:VideoVisualPluginContext):VideoVisualPlugin|undefined{
  return plugins.find((plugin)=>{
    try{return plugin.matches(context)}catch{return false}
  })
}

export function registeredVideoVisualPluginIds():string[]{
  return plugins.map((plugin)=>plugin.id)
}

/** Reserved synthetic extension used only by fixtures/gates; normal projects never create this assetId. */
export const VIDEO_EXTENSION_FIXTURE_ASSET_ID='@g-v5-fixture:extension-box'

registerVideoVisualPlugin({
  id:'fixture-extension-box',
  priority:1000,
  matches:({element})=>element.assetId===VIDEO_EXTENSION_FIXTURE_ASSET_ID,
  renderCanvas:({element},ctx)=>{
    const x=(50+element.x)/100*1920,y=(50+element.y)/100*1080
    const w=element.width/100*1920,h=element.height/100*1080
    ctx.save()
    ctx.translate(x,y)
    ctx.rotate(element.rotation*Math.PI/180)
    ctx.fillStyle='#ff3bd4'
    ctx.strokeStyle='#28e7ff'
    // Match CSS border-box: the 12px border is inside the element's declared size.
    ctx.lineWidth=12
    ctx.fillRect(-w/2+12,-h/2+12,Math.max(0,w-24),Math.max(0,h-24))
    ctx.strokeRect(-w/2+6,-h/2+6,Math.max(0,w-12),Math.max(0,h-12))
    ctx.restore()
    return true
  },
  renderDom:({element})=><div
    data-video-extension="fixture-box"
    style={{
      position:'absolute',left:`calc(50% + ${element.x}%)`,top:`calc(50% + ${element.y}%)`,
      width:`${element.width}%`,height:`${element.height}%`,
      transform:`translate(-50%,-50%) rotate(${element.rotation}deg)`,
      zIndex:Math.max(0,element.zIndex)+2,
      background:'#ff3bd4',border:'12px solid #28e7ff',boxSizing:'border-box',pointerEvents:'none'
    }}
  />
})
