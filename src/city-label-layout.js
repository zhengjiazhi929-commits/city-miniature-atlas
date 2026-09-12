// Keep the geographic anchor fixed; displace only its label when cities crowd.
// Stable ordering avoids labels jumping merely because another city is hovered.
export function layoutCityLabels(items,{width,height}){
  const placed=[],result=new Map(),margin=14,top=58,bottom=height-68;
  const overlaps=(a,b,gap=6)=>Math.abs(a.x-b.x)<(a.w+b.w)/2+gap&&Math.abs(a.y-b.y)<(a.h+b.h)/2+gap;
  for(const item of [...items].sort((a,b)=>a.y-b.y||a.id.localeCompare(b.id))){
    const candidates=[];
    for(const radius of [0,34,68,102,136])for(const [dx,dy]of radius===0?[[0,-28]]:[[0,-28-radius],[radius,-28],[-radius,-28],[radius,12],[-radius,12],[0,28+radius]]){
      const candidate={x:Math.max(margin+item.w/2,Math.min(width-margin-item.w/2,item.x+dx)),y:Math.max(top+item.h/2,Math.min(bottom-item.h/2,item.y+dy)),w:item.w,h:item.h};
      const collisions=placed.filter(p=>overlaps(candidate,p)).length;
      const distance=Math.hypot(candidate.x-item.x,candidate.y-(item.y-28));
      candidates.push({...candidate,score:collisions*10000+distance});
    }
    candidates.sort((a,b)=>a.score-b.score);const pick=candidates[0];placed.push(pick);result.set(item.id,pick);
  }
  return result;
}
