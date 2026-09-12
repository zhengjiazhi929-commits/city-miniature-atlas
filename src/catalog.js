import {hangzhouPlaces} from './hangzhou-catalog.js';
import {westLakePlace} from './westlake-place.js';
import {hubinPlace} from './hubin-place.js';
import {hangzhouOverviewIds} from './hangzhou-overview-policy.js';
// Add a city and scene registry entry here; scene creation stays in an independent module.
export const cities = [
  { id:'hong-kong', name:'香港', province:'hong-kong', coordinates:[114.173,22.293], subtitle:'山海之间，十种香港', attractions:['victoria-harbour','victoria-peak','hong-kong-disneyland','ocean-park','tian-tan-buddha','ngong-ping','star-ferry','nan-lian-garden','hong-kong-palace-museum','observation-wheel'] },
  { id:'hangzhou', name:'杭州', province:'zhejiang', coordinates:[120.155,30.274], subtitle:'湖山相望，塔影入水', attractions:['leifeng','santan'] },
  { id:'wuhan', name:'武汉', province:'hubei', coordinates:[114.305,30.593], subtitle:'江城的飞檐与远帆', attractions:['yellow-crane'] },
];
export const attractions = {
  'hubin-yintai':hubinPlace,
  westlake:{...westLakePlace,create:async(signal)=>{const {createWestLakeGeographic}=await import('./scenes/westlake-geographic.js');signal?.throwIfAborted();return createWestLakeGeographic(signal);}},
  'victoria-harbour':{id:'victoria-harbour',name:'维多利亚港',city:'hong-kong',en:'VICTORIA HARBOUR',coordinates:[114.18398, 22.29191],subtitle:'两岸天际线，一湾流光',description:'把香港岛的高楼、九龙的海滨与穿行的小船放进同一方沙盘。降低视角，沿水面望向层叠的城市与山岭。',source:'./docs/victoria-harbour-sources.md',create:async(signal)=>{const {createVictoriaHarbour}=await import('./scenes/victoria-harbour.js');signal?.throwIfAborted();return createVictoriaHarbour();}},
  'victoria-peak':{id:'victoria-peak',name:'太平山顶',city:'hong-kong',en:'VICTORIA PEAK',coordinates:[114.14988, 22.27125],subtitle:'乘山顶缆车，俯瞰香港',description:'山顶凌霄阁的弧形轮廓立于绿坡之上。循着倾斜轨道向下看，让远处海港与城市进入视野。',source:'./docs/victoria-peak-sources.md',create:async(signal)=>{const {createVictoriaPeak}=await import('./scenes/victoria-peak.js');signal?.throwIfAborted();return createVictoriaPeak();}},
  'hong-kong-disneyland':{id:'hong-kong-disneyland',name:'香港迪士尼',city:'hong-kong',en:'HONG KONG DISNEYLAND',coordinates:[114.04212, 22.31274],subtitle:'城堡尖塔，层层入梦',description:'从护城河上的桥面走近奇妙梦想城堡。奶油色石墙、彩色穹顶和高低错落的尖塔，构成童话般的建筑群。',source:'./docs/hong-kong-disneyland-sources.md',create:async(signal)=>{const {createHongKongDisneyland}=await import('./scenes/hong-kong-disneyland.js');signal?.throwIfAborted();return createHongKongDisneyland();}},
  'ocean-park':{id:'ocean-park',name:'香港海洋公园',city:'hong-kong',en:'OCEAN PARK',coordinates:[114.17468, 22.24821],subtitle:'山海之间的游乐场',description:'沿海山坡上，缆车跨越山谷，过山车轨道起伏回转。观察设施如何与海岸、高差和植被交织。',source:'./docs/ocean-park-sources.md',create:async(signal)=>{const {createOceanPark}=await import('./scenes/ocean-park.js');signal?.throwIfAborted();return createOceanPark();}},
  'tian-tan-buddha':{id:'tian-tan-buddha',name:'天坛大佛',city:'hong-kong',en:'TIAN TAN BUDDHA',coordinates:[113.90501, 22.25395],subtitle:'林海石阶，莲台端坐',description:'拾级而上的长阶通往莲花台座。绕到侧面，看青铜坐像的手势、衣褶与山林之间的关系。',source:'./docs/tian-tan-buddha-sources.md',create:async(signal)=>{const {createTianTanBuddha}=await import('./scenes/tian-tan-buddha.js');signal?.throwIfAborted();return createTianTanBuddha();}},
  'ngong-ping':{id:'ngong-ping',name:'昂坪 360',city:'hong-kong',en:'NGONG PING 360',coordinates:[113.90139, 22.25632],subtitle:'一线缆车，越过青山',description:'蓝色车厢沿着起伏缆线穿越山谷。转动沙盘，查看塔架、山岭与远处昂坪村落的空间关系。',source:'./docs/ngong-ping-sources.md',create:async(signal)=>{const {createNgongPing}=await import('./scenes/ngong-ping.js');signal?.throwIfAborted();return createNgongPing();}},
  'star-ferry':{id:'star-ferry',name:'天星小轮',city:'hong-kong',en:'STAR FERRY',coordinates:[114.16864, 22.29376],subtitle:'在一艘小轮上，看维港',description:'走近经典绿白船身，细看双层甲板、栏杆与码头。海港的尺度，在一趟小轮的航行中变得亲近。',source:'./docs/star-ferry-sources.md',create:async(signal)=>{const {createStarFerry}=await import('./scenes/star-ferry.js');signal?.throwIfAborted();return createStarFerry();}},
  'nan-lian-garden':{id:'nan-lian-garden',name:'南莲园池',city:'hong-kong',en:'NAN LIAN GARDEN',coordinates:[114.20458, 22.33914],subtitle:'金阁朱桥，池水松影',description:'金色八角亭映在池水中，两座朱桥与唐式屋檐相望。沿曲折园路转一圈，发现松树、山石和庭院的层次。',source:'./docs/nan-lian-garden-sources.md',create:async(signal)=>{const {createNanLianGarden}=await import('./scenes/nan-lian-garden.js');signal?.throwIfAborted();return createNanLianGarden();}},
  'hong-kong-palace-museum':{id:'hong-kong-palace-museum',name:'香港故宫文化博物馆',city:'hong-kong',en:'HONG KONG PALACE MUSEUM',coordinates:[114.15504, 22.30157],subtitle:'当代金色馆舍，面向维港',description:'上宽下收的建筑体量悬于广场边，细密金色条带与内凹玻璃中庭相接。转到海滨一侧，看看馆舍与步道的关系。',source:'./docs/hong-kong-palace-museum-sources.md',create:async(signal)=>{const {createHongKongPalaceMuseum}=await import('./scenes/hong-kong-palace-museum.js');signal?.throwIfAborted();return createHongKongPalaceMuseum();}},
  'observation-wheel':{id:'observation-wheel',name:'中环摩天轮',city:'hong-kong',en:'HONG KONG OBSERVATION WHEEL',coordinates:[114.16176, 22.28533],subtitle:'红色车厢，缓缓转过海港',description:'白色轮辐撑起一圈红色车厢，背后是中环高楼。把视角放低，观察轮体旋转时保持直立的吊舱。',source:'./docs/observation-wheel-sources.md',create:async(signal)=>{const {createObservationWheel}=await import('./scenes/observation-wheel.js');signal?.throwIfAborted();return createObservationWheel();}},
  leifeng:{id:'leifeng',name:'雷峰塔',city:'hangzhou',en:'LEIFENG PAGODA',coordinates:[120.1450125,30.2338837],coordinateSource:'https://www.openstreetmap.org/way/229726934',coordinateRole:'OSM tower footprint centre, WGS84; not a surveyed control point',subtitle:'一座塔，一湖山色',geographic:true,description:'从西湖南岸望向雷峰塔。湖岸、山坡与南山路沿真实地理资料展开，塔身保留五层八面与层叠重檐。',source:'./docs/leifeng-real-sources.md',create:async(signal)=>{const {createLeifengReal}=await import('./scenes/leifeng-real.js');signal?.throwIfAborted();return createLeifengReal(signal);}},
  santan:{id:'santan',name:'三潭印月',city:'hangzhou',en:'THREE POOLS MIRRORING THE MOON',coordinates:[120.1397779,30.2394753],coordinateSource:'https://www.openstreetmap.org/node/1468743788',coordinateRole:'OSM scenic representative point, WGS84; not the three stone pagodas geometric centre',subtitle:'湖中有岛，水上有塔',description:'三座石塔在水面上相望，远处是小岛、曲桥与树影。把视角放低，观察水面、石塔与园林的层次。',source:'./docs/westlake-sources.md',create:async(signal)=>{const {createWestLake}=await import('./scenes/westlake.js');signal?.throwIfAborted();return createWestLake('santan');}},
  'yellow-crane':{id:'yellow-crane',name:'黄鹤楼',city:'wuhan',en:'YELLOW CRANE TOWER',coordinates:[114.3027,30.5446],subtitle:'飞檐层叠，临江而立',description:'从石阶拾级而上，朱柱与金色重檐逐层展开。绕楼一周，看看这座江城地标的轮廓与院落。',source:'./docs/yellow-crane-sources.md',create:async(signal)=>{const {createYellowCrane}=await import('./scenes/yellow-crane.js');signal?.throwIfAborted();return createYellowCrane();}},
};
for(const place of hangzhouPlaces){if(attractions[place.id])Object.assign(attractions[place.id],{subtitle:place.subtitle});else attractions[place.id]={...place,description:place.subtitle};}
// Close-view scenes are lazy: only the chosen place loads its geographic bundle.
const detailCopy={
 xiaohe:'沿真实河道和街巷，走近白墙、黛瓦与连续的临街房屋。',
 faxi:'山谷中的寺院层层展开，黄墙、深色屋面和庭院保留各自的体量。',
 lingyin:'沿来源建筑轮廓展开寺院殿堂，观察重檐、庭院与周边山林。',
 longmen:'沿真实街巷、水塘与聚落范围，查看白墙黛瓦的传统院落群。',
 tianmu:'在山脊与谷地之间，观察天目山的林冠和地形层次。',
 xixi:'顺着真实水岸与池塘，查看湿地中的村落、林地和步道。',
 olympic:'绕行大莲花和小莲花，观察交叠花瓣、开放看台与两馆之间的空间。',
 'hubin-yintai':'围绕湖滨银泰的来源建筑轮廓，查看商业街、庭院和步行界面。',
 qiandao:'这一段湖区保留来源湖岸和岛屿，拉近看林冠，拉远看山水层次。',
};
for(const [id,description]of Object.entries(detailCopy))Object.assign(attractions[id],{overviewOnly:false,geographic:true,description,geographicNote:'地形、水岸与街巷依据公开地理资料；楼高、屋顶与植被作微缩表达。展示范围是取景区域。',source:'./docs/hangzhou-place-details-sources.md',create:async(signal)=>{const {createHangzhouPlaceDetail}=await import('./scenes/hangzhou-place-detail.js');signal?.throwIfAborted();return createHangzhouPlaceDetail(id,signal);}});
attractions.zshc={id:'zshc',name:'杭州萧山国际机场',city:'hangzhou',en:'HANGZHOU XIAOSHAN AIRPORT',coordinates:[120.4291244,30.2368729],category:'airport',overviewOnly:false,geographic:true,subtitle:'双跑道与航站楼',description:'查看双跑道、机坪和航站楼之间的真实位置关系。',geographicNote:'机场轮廓和跑道来源可查；航站楼高度及标线按观看尺度概括。',source:'./docs/hangzhou-place-details-sources.md',create:async(signal)=>{const {createHangzhouPlaceDetail}=await import('./scenes/hangzhou-place-detail.js');return createHangzhouPlaceDetail('zshc',signal);}};
cities.find(c=>c.id==='hangzhou').attractions=[...hangzhouOverviewIds];
export const cityById = (id)=>cities.find(city=>city.id===id);
export const citiesInProvince=(province)=>cities.filter(city=>city.province===province);

// City overview and an attraction's object model are deliberately different views.
const subjectCopy={
 lingyin:['五重殿堂，重檐相接','围绕主要殿堂与必要院落，近看重檐、柱廊和台阶，转动模型查看寺院建筑群。'],
 faxi:['黄墙黛瓦，层层院落','独立展开寺院的主要建筑，观察黄墙、深色瓦面与层叠院落。'],
 leifeng:['五层八面，层檐凌空','单独欣赏雷峰塔的塔身、重檐与遗址保护台基，旋转查看每一面。'],
 xiaohe:['临街屋檐，白墙木窗','以小河直街的连续街屋为主体，保留必要的石板巷与临河边缘，细看屋檐和门窗。'],
 longmen:['厅堂天井，白墙黛瓦','依据文保资料概括传统厅堂的三进院落、门廊和天井；当前为建筑类型示意，尚非具体祠堂的测绘复原。'],
 olympic:['大小莲花，花瓣舒展','独立欣赏大莲花与小莲花的场馆建筑，近看交叠花瓣、中央场地和屋盖。'],
 'hubin-yintai':['商业建筑，街巷相连','单独展开湖滨银泰主要商业建筑与相邻街屋，观察不同体量和临街立面。'],
 zshc:['航站楼群，连廊相接','以航站楼和连廊为主体，近看各翼之间的连接与建筑轮廓。'],
};
for(const [id,[subtitle,description]]of Object.entries(subjectCopy))attractions[id]={...attractions[id],subtitle,description,presentation:'standalone-subject',geographic:true,geographicNote:id==='longmen'?'厅堂院落类型概括；当前资料尚不足以逐栋复原古镇。':'主要位置与建筑轮廓依据公开资料；屋面、立面和院落高差作概括表达。',attribution:'© OpenStreetMap contributors · 建筑外观概括',source:'./docs/hangzhou-subject-models.md',create:async(signal)=>{const {createHangzhouSubject}=await import('./scenes/hangzhou-subject.js');signal?.throwIfAborted();return createHangzhouSubject(id,signal);}};
const naturalSubjectCopy={
 westlake:['两堤、石桥与湖中三岛','沿苏堤六桥看烟柳，在湖中寻找小瀛洲的园林、三座石塔和湖心亭。转动湖面，再看南岸的雷峰塔。'],
 xixi:['秋芦水巷，摇橹入画','走近秋雪庵周边的湿地水网：低处是成片芦花，岸上有柳树、临水街屋，摇橹小舟穿行其间。'],
 qiandao:['青峰成岛，碧水绕岸','观察真实岛群的山脊、岬角和岛间水道。深绿林冠、浅色水岸与湖上的游船，共同展现千岛湖的层次。'],
 tianmu:['古柳杉林，石径入山','沿来源登山小径走近西天目的森林。高大的柳杉伸展枝冠，低处有阔叶树与林下蕨草，露出可辨认的树干和山径。'],
};
for(const[id,[subtitle,description]]of Object.entries(naturalSubjectCopy))attractions[id]={...attractions[id],subtitle,description,presentation:'standalone-subject',geographic:true,geographicNote:id==='westlake'?'保留完整西湖湖形与岛屿；植被数量和形态为概括表达。':'保留选定核心区域的来源水岸与地形；不是完整景区边界，植被为概括表达。',source:'./docs/hangzhou-subject-models.md',create:async(signal)=>{const {createNaturalSubject}=await import('./scenes/natural-subject.js');signal?.throwIfAborted();return createNaturalSubject(id,signal);}};

// These destinations remain in the city; they have no independent model page.
// Clone metadata so the city geometry cache's shared source objects stay intact.
for(const [id,subtitle]of Object.entries({
 olympic:'大小莲花 · 在城市中定位',
 'hubin-yintai':'湖滨商业街区 · 在城市中定位',
 zshc:'航站楼与跑道 · 在城市中定位',
}))attractions[id]={...attractions[id],subtitle,overviewOnly:true,presentation:'city-location',create:undefined};
