// Conservative occupied corridors for the same source roads as city fabric.
// This changes only model placement; no road point, road mesh or terrain moves.
export const HANGZHOU_OVERVIEW_ROAD_WIDTHS=Object.freeze({motorway:250,trunk:210,primary:155});
export function sourceRoadExclusions({data,projection,widths=HANGZHOU_OVERVIEW_ROAD_WIDTHS,simplifyMeters=60,sampleStepMeters=600,paddingMeters=10}={}){
  const [west,south,,north]=data.bbox,longitudeMeters=111320*Math.cos((south+north)*Math.PI/360);
  const toMetric=p=>[(p[0]-west)*longitudeMeters,(p[1]-south)*111320];
  const fromMetric=p=>[west+p[0]/longitudeMeters,south+p[1]/111320];
  const tagged=value=>value===true||value===1||(typeof value==='string'&&!['','no','false','0'].includes(value.toLowerCase()));
  const distance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],n=dx*dx+dz*dz,t=n?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/n)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);};
  function simplify(points){
    if(points.length<3)return points;const keep=new Set([0,points.length-1]),pending=[[0,points.length-1]];
    while(pending.length){const [start,end]=pending.pop();let best=-1,farthest=simplifyMeters;for(let i=start+1;i<end;i++){const d=distance(points[i],points[start],points[end]);if(d>farthest){farthest=d;best=i;}}if(best!==-1){keep.add(best);pending.push([start,best],[best,end]);}}
    return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
  }
  const polygons=[];
  for(const road of data.roads||[]){
    const kind=String(road.class||'').replace(/_link$/,'');if(!Object.hasOwn(widths,kind)||tagged(road.tunnel))continue;
    const source=(road.points||[]).filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])).map(toMetric).filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>1);
    const points=simplify(source),radius=widths[kind]/2+paddingMeters;if(points.length<2)continue;
    const resampled=[points[0]];
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],count=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/sampleStepMeters);for(let j=1;j<=count;j++)resampled.push([a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count]);}
    let previous=null;
    for(let i=0;i<resampled.length;i++){
      const point=resampled[i],a=resampled[Math.max(0,i-1)],b=resampled[Math.min(resampled.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(!length){previous=null;continue;}
      // Use the same resampled tangents as the rendered deck. Old square caps
      // around every simplified segment consumed extra land at road bends.
      const nx=-dz/length*radius,nz=dx/length*radius,end=i===0?-paddingMeters:i===resampled.length-1?paddingMeters:0;
      const center=[point[0]+dx/length*end,point[1]+dz/length*end],section=[[center[0]+nx,center[1]+nz],[center[0]-nx,center[1]-nz]].map(p=>{const q=projection.project(fromMetric(p));return[q.x,q.z];});
      if(previous)for(const triangle of [[previous[0],section[0],section[1]],[previous[0],section[1],previous[1]]]){const [a,b,c]=triangle;if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))>1e-12)polygons.push([triangle]);}
      previous=section;
    }
  }
  return polygons;
}
