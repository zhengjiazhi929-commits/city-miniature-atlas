// Each curated city declares its airport coverage. Unknown coverage never means
// "no airport"; an external service airport needs a verified explicit record.
export const cityAirportRegistry = {
  hangzhou:{status:'inside',files:['hangzhou']},
  'hong-kong':{status:'inside',files:['hong-kong']},
  wuhan:{status:'inside',files:['wuhan']},
};

export function airportDistanceKm(from,to){
  const r=Math.PI/180,a=from[1]*r,b=to[1]*r;
  const h=Math.sin((b-a)/2)**2+Math.cos(a)*Math.cos(b)*Math.sin((to[0]-from[0])*r/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));
}

export async function loadCityAirports(city,{signal}={}){
  const record=cityAirportRegistry[city?.id];
  if(!record)return {status:'unverified',airports:[]};
  const airports=await Promise.all(record.files.map(async file=>{
    const response=await fetch(new URL(`../data/airports/${file}.json`,import.meta.url),{signal});
    if(!response.ok)throw new Error('机场资料加载失败');
    const airport=await response.json();signal?.throwIfAborted();
    return {...airport,city:city.id,category:'airport',overviewOnly:true,
      external:record.status==='external',
      distanceKm:record.status==='external'?airportDistanceKm(city.coordinates,airport.coordinates):null,
      subtitle:`${airport.iata} · ${record.status==='external'?'市外服务机场':'航站楼与跑道'}`,
    };
  }));
  return {status:record.status,airports};
}
