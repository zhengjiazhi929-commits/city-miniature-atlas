# 用这份代码做下一座城市

这个项目提供两层复用。**城市接入示例**读取你提供的行政边界和景点坐标，运行通用的地形、路网、建筑轮廓与点位交互；**杭州精细沙盘**另有本地数据加工、街区组织、地标建模与碰撞校验流程。改一个城市名不会自动得到杭州的模型品质。

## 先运行真实武汉示例

在仓库根目录运行：

```sh
npm start
```

打开 [城市接入示例](http://127.0.0.1:4173/examples/city-starter/)；也可以在任意部署地址后使用 `/examples/city-starter/?city=wuhan-example`。若 4173 已被占用，可以运行 `PORT=4178 npm start` 并使用相应端口。

页面加载 [wuhan-example.json](../data/cities/wuhan-example.json) 中声明的、仓库原有的武汉 OSM 行政边界，并验证 SHA-256。黄鹤楼使用主应用已收录的代表坐标，在真实位置显示可点击标注。点击“黄鹤楼”可靠近观察，点击“完整市域”返回全图。

这不是从杭州改名而成的示例。武汉行政边界来自 OSM relation 3076268。通用地形和路网依赖公开的 Mapzen DEM 与 OpenFreeMap 网络服务，断网、服务不可达或来源覆盖不足时会显示错误／缺失信息，不会以随机山水或假路网补齐。杭州主应用读取本地预处理数据的流程与此不同。

## 生成你自己的城市配置

先准备**该城市真实的** WGS84 / EPSG:4326 边界文件。必须是单个 GeoJSON `Feature`，几何为 `Polygon` 或 `MultiPolygon`；不是城市定位点或任意矩形，也不是未经选择的 FeatureCollection。保留原始来源字段、署名和许可。经纬度顺序为 `[经度, 纬度]`。

下面是一条可以直接运行的练习命令，它仍然使用**武汉的真实名称和边界**，只为示例取一个独立配置 ID，不代表新增了另一座城市：

```sh
node scripts/create-city.mjs \
  --id wuhan-workshop \
  --name 武汉 \
  --name-en Wuhan \
  --lon 114.305 \
  --lat 30.593 \
  --boundary data/regions/wuhan.geojson \
  --source https://www.openstreetmap.org/relation/3076268 \
  --license ODbL-1.0 \
  --attribution '© OpenStreetMap contributors'
```

脚本生成 `data/cities/wuhan-workshop.json` 与 `data/regions/custom/wuhan-workshop.geojson`。运行页面：

```text
http://127.0.0.1:4173/examples/city-starter/?city=wuhan-workshop
```

制作其他城市时，**同时替换名字、坐标、边界文件、来源链接、署名和许可**；`--id` 只决定文件名与 URL。若边界有名称字段，脚本要求中文名或 `--name-en` 与来源名称匹配，防止直接把另一座城市的边界改名。别名需先人工核实并在来源数据说明中保留依据，不能靠随意删除来源名称绕过检查。

脚本不联网查询、不生成道路或景点、不猜测机场。它检查边界格式、闭环、非零范围、经纬度、城市点包含关系，保留输入的原始字节并记录哈希。文件存在时拒绝覆盖。它不能证明行政面是最新、完整或权威的数据，也不能检测所有自交、多边形拓扑错误；你需使用 GIS 工具进一步核实来源。当前投影不支持跨越日期变更线或纬度绝对值大于 85° 的城市。

## 配置与景点

配置结构见真实武汉示例。主要字段：

| 字段 | 用途 |
| --- | --- |
| `schema` | 固定为 `city-starter-v1` |
| `id`, `name`, `nameEn` | 文件／URL 标识与真实显示名称；英文名可选 |
| `coordinates` | 市内的真实代表点，需位于边界内 |
| `boundary.path`, `boundary.sha256` | 仓库 `./data/` 下的边界文件与原始字节 SHA-256 |
| `boundary.source` | `url`、`attribution`、`license`，会在地图署名区显示 |
| `landmarks` | 最多 80 个已核实景点，每项包含 `id`、`name`、`coordinates`、`sourceUrl`、`description` |
| `airports.status` | 此模板固定为 `unverified`，不是“没有机场” |

脚本创建空的 `landmarks`；按真实来源添加点位后刷新即可。每个景点必须位于边界内、有可追溯的来源链接。这个入口只负责位置标注与镜头定位，**不把标注冒充已建好的景点模型**。若要加入独立模型，可参考主应用 `src/catalog.js` 中的异步 `create(signal)` 及 `src/scenes/` 的模型模块，再注册进入主应用目录。

不要直接改边界而保留旧哈希。核实来源后重新使用脚本生成一个新的 ID，或明确更新配置中的哈希。边界路径限定在应用的 `data/` 目录，禁止外部 URL、路径跳出和未审核的查询参数。

此示例没有自动注册到全国地图的 `catalog.js`，因此不会把未完成的城市标为已制作。主地图接入还需要真实省份关联、行政面目录、景点模块与机场覆盖资料，参考 `src/catalog.js`、`src/region-boundaries.js`、`src/city-airports.js`。没有机场的城市应注明真实市外服务机场，不能把机场挪进边界。

## 直接调用通用 Viewer

页面提供本地 Three.js import map 后，可调用：

```js
import {createGeographicMap} from './src/regional-viewer.js';

const controller = new AbortController();
const viewer = await createGeographicMap({
  container,                       // 有实际宽高的 DOM 元素
  initialView: {city: config},
  boundary: boundaryFeature,       // 经校验的该城市 GeoJSON Feature
  boundarySource: config.boundary.source,
  landmarks: config.landmarks,
  signal: controller.signal,
  onStatus: ({state, message}) => {},
  onAttractionPick: place => {},
});
viewer.focusAttraction('your-verified-place-id');
viewer.resetView();
// 页面／城市切换时，只保留当前城市：
controller.abort();
viewer.destroy();                 // 可重复调用，释放控制器、渲染器、几何和请求
```

`boundary` 与 `boundarySource` 是新增的可选参数。不传入时，主应用仍使用原来的地区目录解析路径；杭州仍使用独立的 `hangzhou-sandtable.js`。自有边界入口会再次检查边界和来源，不会按城市 ID 偷用杭州地理数据。若你自己调用低层 API，需要自行校验原始文件哈希；示例页面已实现该校验。

## 复用 City Kit，逐步提高模型质量

`assets/city-kit/v1/` 是固定几何资产，不需要每做一座城市就重新建住宅、商业楼、厂房、树冠、道路结构。`src/city-assets.js` 提供：

```js
import {loadCityAssets, createCityAssetMaterials} from './src/city-assets.js';

const assets = await loadCityAssets({signal});
const materials = createCityAssetMaterials({
  wallColour: '#c1c9cd',
  glassColour: '#b3bdc1',
});
const asset = assets.buildings.residential[0];
// asset.geometry 是可复用 BufferGeometry，建筑底部 y=0。
// 用 InstancedMesh 组织经过真实用地与路网约束的楼群。
// 完成后释放你创建的材质；assets.dispose() 释放这次加载的资产。
```

建筑几何的三组材质分别表达墙体、玻璃和金属。不要给整栋建筑套同一实例色，否则玻璃和金属也会被染色。可选资产路径通过 `loadCityAssets({manifestUrl, signal})` 指定；manifest 的版本、哈希、固定几何和类型会被校验。

**通用 Viewer 目前不会自动把 OSM 轮廓变成杭州 City Kit 街区。** 要接近杭州精细度，需要再提供真实主路、用地与建筑足迹、高程／水岸、景点与标志建筑资料，并重新配置道路避让、街区组合、建筑比例、贴地高度、树群分布与镜头。可参考：

- `src/hangzhou-fabric.js`：来源约束下的道路、街区、普通建筑和树群组织。
- `src/hangzhou-footprint-guard.js`、`src/hangzhou-surface.js`：避让与地表采样。
- `src/hangzhou-district-massing.js`：**杭州特定**片区高低与配色，不能直接当作其他城市的商业中心位置。
- `scripts/build-hangzhou-*.py` 和 `data/hangzhou-atlas/`：**杭州特定**预处理链，不是通用城市生成命令。
- `src/scenes/`：独立的景点模型及释放约定。

更换数据或算法后须重新生成对应缓存；不能复制杭州的缓存冒充另一座城市。代码 MIT 许可与 OSM、DEM、geoBoundaries 等数据的许可分别保留，详见根目录的数据与第三方许可说明。

## 检查

```sh
node scripts/check-city-starter.mjs
```

检查真实武汉配置与边界哈希、原始坐标保留、生成 CLI、覆盖保护、越界点位、非法路径和取消。这个命令不启动浏览器，也不替代在线瓦片可达性与实际 WebGL 效果验收。

浏览器至少检查：地形成功展开、边界署名可见、点击黄鹤楼定位、隐藏／恢复标注、完整市域视角、刷新深链接、缺数据时提示，以及离开页面后资源与网络请求停止。
