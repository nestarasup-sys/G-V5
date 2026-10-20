export type VideoCanvasLayerCacheStats = Readonly<{
  hits:number
  misses:number
  evictions:number
  entries:number
  bytes:number
  maxBytes:number
}>

type Entry={canvas:HTMLCanvasElement;bytes:number}

/** Surface-local LRU of already rasterized 1920×1080 visual layers. */
export class VideoCanvasLayerCache {
  private readonly entries=new Map<string,Entry>()
  private bytes=0
  private hits=0
  private misses=0
  private evictions=0

  constructor(readonly maxBytes=96*1024*1024){
    if(!Number.isSafeInteger(maxBytes)||maxBytes<16*1024*1024)throw new Error('Orçamento do cache de layers inválido.')
  }

  get(key:string):HTMLCanvasElement|undefined{
    const entry=this.entries.get(key)
    if(!entry){this.misses++;return undefined}
    this.entries.delete(key);this.entries.set(key,entry);this.hits++
    return entry.canvas
  }

  create(key:string,width:number,height:number,draw:(context:CanvasRenderingContext2D)=>void|Promise<void>):Promise<HTMLCanvasElement>{
    if(!key||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw new Error('Layer cache inválido.')
    const existing=this.get(key)
    if(existing)return Promise.resolve(existing)
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
    const context=canvas.getContext('2d',{alpha:true})
    if(!context)throw new Error('Canvas de layer indisponível.')
    return Promise.resolve(draw(context)).then(()=>{
      const bytes=width*height*4
      if(bytes>this.maxBytes)return canvas
      const old=this.entries.get(key)
      if(old){this.entries.delete(key);this.bytes-=old.bytes}
      this.entries.set(key,{canvas,bytes});this.bytes+=bytes
      while(this.bytes>this.maxBytes&&this.entries.size>1){
        const oldestKey=this.entries.keys().next().value
        if(!oldestKey)break
        const oldest=this.entries.get(oldestKey)
        this.entries.delete(oldestKey)
        if(oldest)this.bytes-=oldest.bytes
        this.evictions++
      }
      return canvas
    })
  }

  clear(){this.entries.clear();this.bytes=0}

  stats():VideoCanvasLayerCacheStats{
    return{hits:this.hits,misses:this.misses,evictions:this.evictions,entries:this.entries.size,bytes:this.bytes,maxBytes:this.maxBytes}
  }
}
