import {createLandFootprintGuard} from './hangzhou-footprint-guard.js';
import {groundModelOnTerrain,groundScatteredForest,terrainEnvelopeRelief} from './hangzhou-model-grounding.js';
import {sourceRoadExclusions} from './source-road-exclusions.js';

// Fit representative architecture on dry, reasonably even terrain. Dense
// urban views no longer require enormous village/temple plates to be legible.
export function createTourismLayout({data,airports,signatureExclusions,projection,project}) {
  const projected=polygons=>polygons.map(poly=>poly.map(r=>r.map(c=>{const p=projection.project(c);return[p.x,p.z];})));
  const roadExclusions=sourceRoadExclusions({data,projection});
  const guard=createLandFootprintGuard({boundary:projected(data.boundary),water:projected(data.water.map(w=>w.rings)),exclusions:[...projected([...airports.flatMap(a=>a.boundary||[]),...signatureExclusions]),...roadExclusions],cellSize:.035});
  const water=data.water.filter(w=>w.areaMeters>300000).map(w=>w.rings);
  const bank=createLandFootprintGuard({boundary:data.boundary,water,cellSize:.003});
  const reserved=[];
  function overlaps(a,b){
    for(const ring of[a,b])for(let i=0;i<ring.length;i++){
      const p=ring[i],q=ring[(i+1)%ring.length],dx=q[0]-p[0],dz=q[1]-p[1];
      const range=r=>r.reduce((v,c)=>{const s=-dz*c[0]+dx*c[1];return[Math.min(v[0],s),Math.max(v[1],s)];},[Infinity,-Infinity]);
      const x=range(a),y=range(b);if(x[1]<y[0]||y[1]<x[0])return false;
    }return true;
  }
  function sameBank(a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<1e-10)return true;
    const x=-dy/len*1e-9,y=dx/len*1e-9;
    return bank.allows([[a[0]+x,a[1]+y],[b[0]+x,b[1]+y],[b[0]-x,b[1]-y],[a[0]-x,a[1]-y]]);
  }
  const widths={leifeng:.18,liuhe:.30,faxi:.40,lingyin:.43,xiaohe:.42,hefang:.4,longmen:.40,xinye:.35,tianmu:.38,xixi:.38,qiandao:.4,'hubin-yintai':.34,hubin:.34};
  const minimumWidths={leifeng:.10,faxi:.24,lingyin:.26,xiaohe:.14,longmen:.15,tianmu:.30,xixi:.18,'hubin-yintai':.11};
  return {
    fit(group,item,transported){
      const hull=transported.metadata.footprintWorld,target=widths[item.id];
      if(!target){reserved.push(hull);return transported;}
      const width=Math.max(Math.max(...hull.map(p=>p[0]))-Math.min(...hull.map(p=>p[0])),Math.max(...hull.map(p=>p[1]))-Math.min(...hull.map(p=>p[1])));
      const desired=Math.min(2.5,target/width);
      const current=transported.metadata.displayCoordinates,lon=111320*Math.cos(item.coordinates[1]*Math.PI/180),candidates=[current,item.coordinates];
      for(const radius of[125,250,375,500,750,1000,1250,1490])for(let i=0;i<16;i++){const a=i*Math.PI/8;candidates.push([item.coordinates[0]+Math.cos(a)*radius/lon,item.coordinates[1]+Math.sin(a)*radius/111320]);}
      let chosen=null;
      // Fit symbols inside the unwarped map. If a large dry slot does not
      // exist, reduce the symbol rather than stretching its surroundings.
      const minimum=minimumWidths[item.id]??.08;
      const factors=[...new Set([...[1,.85,.72,.60,.5,.42,.35,.29,.24,.20].map(f=>desired*f),minimum/width])].filter(f=>f*width>=minimum-1e-8).sort((a,b)=>b-a);
      for(const factor of factors){
        let best=null;
        for(const coordinate of candidates){
          const distance=Math.hypot((coordinate[0]-item.coordinates[0])*lon,(coordinate[1]-item.coordinates[1])*111320);
          if(distance>1495||!sameBank(item.coordinates,coordinate))continue;
          const point=project(coordinate),face=hull.map(p=>[point.x+(p[0]-group.position.x)*factor*1.000004,point.z+(p[1]-group.position.z)*factor*1.000004]);
          if(!guard.allows(face)||reserved.some(p=>overlaps(face,p)))continue;
          const terrain=terrainEnvelopeRelief(face,{project,projection,step:Math.max(.025,width*factor/4)});
          const reliefLimit=Math.min(.12,Math.max(.022,width*factor*.28));
          if(item.id!=='tianmu'&&terrain.relief>reliefLimit)continue;
          const score=item.id==='tianmu'?distance/1500:terrain.relief/reliefLimit+distance/1500;
          if(!best||score<best.score)best={factor,coordinate,point,face,distance,terrain,score};
          if(item.id==='tianmu'&&distance<.01)break;
        }if(best){chosen=best;break;}
      }
      if(chosen){
        const {factor,coordinate,point,face,distance}=chosen;
        // Keep narrower symbols in proportion on the restored global ground.
        let modelHeight=0;
        group.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.computeBoundingBox();modelHeight=Math.max(modelHeight,mesh.geometry.boundingBox.max.y);}});
        const heightRatios={leifeng:5.4,liuhe:5.4,faxi:.62,lingyin:.62,xiaohe:.82,hefang:.7,longmen:.75,xinye:.7,tianmu:1.5,xixi:.85,qiandao:.8};
        const heightCaps={leifeng:.47,liuhe:.74,faxi:.27,lingyin:.28};
        const heightTarget=Math.min(modelHeight,heightCaps[item.id]??Infinity,width*factor*(heightRatios[item.id]??.78));
        const heightFit=heightTarget/Math.max(modelHeight,1e-6);
        group.traverse(mesh=>{if(!mesh.isMesh)return;mesh.geometry.scale(factor,heightFit,factor);mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();});
        group.position.copy(point);
        const footprint=face.map(p=>projection.unproject(...p));
        if(item.id==='tianmu')groundScatteredForest(group,{project,projection});
        else groundModelOnTerrain(group,{project,projection,bottomFraction:item.id==='xixi'?.13:.005});
        Object.assign(transported.metadata,{displayCoordinates:coordinate,footprintWorld:face,horizontalGrowth:factor,heightGrowth:transported.metadata.heightGrowth*heightFit,heightFit,displayWidth:width*factor,displayHeight:heightTarget,minimumReadableWidth:minimum,displayOffsetMeters:distance,maxDisplayOffsetMeters:1500,layoutVerified:true,terrainRelief:chosen.terrain.relief,grounding:group.userData.grounding,roadClearancePolicy:'Whole symbol clears the same simplified primary/trunk/motorway source lines as fabric, at 155/210/250 m display widths plus 10 m numerical allowance.'});
        transported.footprint=footprint;reserved.push(face);
      }else{
        // Keep a failed fit explicit so validation cannot mistake it for safe.
        // An unplaceable symbol must not be drawn across water or a mountain
        // drop. The source terrain and clickable source anchor still exist.
        throw new Error(`${item.name}在现有道路和水岸约束内无法达到最小可读占地；需要调整构图或展示尺度，不能隐藏或继续缩成图钉。`);
      }
      return transported;
    },
    dispose(){guard.dispose();bank.dispose();reserved.length=0;}
  };
}
