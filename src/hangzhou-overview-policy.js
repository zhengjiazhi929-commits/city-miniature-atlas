// The city's map, index and search share this curated list. Unlisted source
// records stay archived; they do not create hidden interactive city markers.
export const hangzhouOverviewIds=Object.freeze([
  'westlake','xiaohe','faxi','lingyin','leifeng','longmen','tianmu','xixi',
  'olympic','hubin-yintai','qiandao',
]);
const ids=new Set(hangzhouOverviewIds);
export const isHangzhouOverviewPlace=place=>ids.has(typeof place==='string'?place:place?.id);
export const hangzhouUrbanView=Object.freeze({coordinates:[120.16,30.27],distance:2.6,direction:[.18,.88,1]});
