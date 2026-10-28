// Shared by the battle table and spectator table. Coordinates always come from the live layout.
export const CARD_FLIGHT_MS=680;
export const reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;
export function pause(ms,signal){return new Promise(resolve=>{if(signal?.aborted)return resolve();const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();},timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});});}
export async function cardFlight(element,from,to,{layer=document.querySelector('#flight-layer'),delay=0,cardSize=null,signal}={}){
  if(!element||!from||!to||reducedMotion()||signal?.aborted)return;
  await pause(delay,signal);if(signal?.aborted)return;
  const width=cardSize?.width||from.width,height=cardSize?.height||from.height;
  if(!width||!height)return;
  const startX=from.left+from.width/2,startY=from.top+from.height/2,dx=to.left+to.width/2-startX,dy=to.top+to.height/2-startY;
  const sx=from.width/width,sy=from.height/height,tx=to.width/width,ty=to.height/height,lift=Math.min(54,Math.max(20,Math.abs(dx)*.055+Math.abs(dy)*.035)),tilt=dx>=0?7:-7;
  element.classList.add('flying-card');Object.assign(element.style,{left:(startX-width/2)+'px',top:(startY-height/2)+'px',width:width+'px',height:height+'px',visibility:'visible'});layer.append(element);
  const animation=element.animate([
    {transform:`translate3d(0,0,0) scale(${sx},${sy}) rotate(0deg)`,opacity:1,filter:'brightness(1)'},
    {transform:`translate3d(${dx*.38}px,${dy*.34-lift}px,0) scale(${Math.min(1.12,(sx+tx)/2+.05)},${Math.min(1.12,(sy+ty)/2+.05)}) rotate(${tilt}deg)`,offset:.42,opacity:1,filter:'brightness(1.18) saturate(1.12)'},
    {transform:`translate3d(${dx*.78}px,${dy*.82}px,0) scale(${tx*1.04},${ty*1.04}) rotate(${-tilt*.25}deg)`,offset:.74,opacity:1,filter:'brightness(1.12)'},
    {transform:`translate3d(${dx}px,${dy}px,0) scale(${tx},${ty}) rotate(0deg)`,opacity:0,filter:'blur(7px) brightness(1.15)'}
  ],{duration:CARD_FLIGHT_MS,easing:'cubic-bezier(.18,.72,.28,1)',fill:'forwards'});
  const cancel=()=>animation.cancel();signal?.addEventListener('abort',cancel,{once:true});
  try{await animation.finished.catch(()=>{});}finally{signal?.removeEventListener('abort',cancel);element.remove();}
}
export async function cardInto(element,from,destination,options={}){
  if(!destination||reducedMotion()||options.signal?.aborted)return;
  const old={opacity:destination.style.opacity,filter:destination.style.filter,transform:destination.style.transform,visibility:destination.style.visibility};
  const to=destination.getBoundingClientRect();Object.assign(destination.style,{visibility:'visible',opacity:'0',filter:'blur(8px)',transform:'scale(.84)'});
  const arrival=destination.animate([{opacity:0,filter:'blur(8px)',transform:'scale(.84)'},{opacity:1,filter:'blur(1px)',transform:'scale(1.045)',offset:.72},{opacity:1,filter:'blur(0)',transform:'scale(1)'}],{duration:260,delay:(options.delay||0)+420,easing:'cubic-bezier(.2,.72,.25,1)',fill:'both'});
  const cancel=()=>arrival.cancel();options.signal?.addEventListener('abort',cancel,{once:true});
  try{await Promise.all([cardFlight(element,from,to,options),arrival.finished.catch(()=>{})]);}finally{Object.assign(destination.style,old);arrival.cancel();options.signal?.removeEventListener('abort',cancel);}
}
