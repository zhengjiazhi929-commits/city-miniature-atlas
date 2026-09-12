# 西湖：完整湖区独立沙盘

`src/scenes/westlake-geographic.js` 的 `createWestLakeGeographic(signal)` 使用一份局部离线资料包。这个场景覆盖完整西湖及紧邻周围地形，雷峰塔和三潭印月为其中的可进入子景点。

## 范围与地理骨架

显示矩形为 WGS84 西 120.105°、南 30.217°、东 120.169°、北 30.273°，约 6.15 × 6.23 公里。它是主动声明的取景范围，不是官方景区边界。场景长宽来自同一局部比例的 Web Mercator，未引入局部放大、扭曲或地标避让位移。

西湖主水面直接使用现有杭州资料中 `areaMeters=6124570` 的唯一水体。200 点外环和 6 个陆地孔洞的坐标逐值保留；完整主湖在取景矩形内，不经重新简化或裁掉角落。孔洞表达上游保留的岛屿／堤体陆地，不能据孔洞数量推断实际岛屿数量。周围另有 7 个来源水面，部分按取景边界裁切。

地形来自现有杭州烘焙地形：裁切得到 530 个原地形顶点、568 个三角面。源高程范围为 8.059–168.6363 米，未加随机山形。显示三角面细分至 9,088 面仅用于改善着色，细分点严格保留原三角面的高度。源 DEM 格网约 900 米，因此缺乏精细坡地和岸边测量，不应将加密网格称为高精度地形。

统一水平单位为每米 0.004 场景单位；原高程乘相同单位并显示 2.5 倍高差。沙盘有等厚底座、外周地形断面及中性岸壁。岸壁沿来源水陆边界构造，不添加码头、护栏、堤路或新岛。水位采用上游 12.1 米估计，不是实测或实时水位。

## 道路、林地与地标

135 条来源主路片段含 trunk、primary、secondary；保留 bridge/tunnel，9 条隧道来源片段不在地面显示。路宽与薄路面厚度为观看尺度参数，路面沿实际显示三角面取高；无 bridge 标志而落入来源水面的短片段省略。没有凭空补连道路、苏堤、白堤或旅游步道。原水体中保留的堤体孔洞继续作为陆地存在。

5 片来源森林和 75 片来源建成用地约束代表树群及楼群，摆放使用稳定序列，避免源水面、主路与地标。它们是土地利用的立体概括，非逐栋建筑或逐树清单。没有树木位置、实测楼高、材料或树种清单。

地标使用上游已核对的来源锚点，模型中心不为排版移动：

| 地点 | WGS84 经纬度 | 来源与表达限制 |
| --- | --- | --- |
| 雷峰塔 | 120.1450125, 30.2338837 | [OSM way 229726934](https://www.openstreetmap.org/way/229726934)，现有项目塔身脚印中心；概括五层八角形制。 |
| 三潭印月 | 120.1397779, 30.2394753 | [OSM node 1468743788](https://www.openstreetmap.org/node/1468743788)，景点代表点，不是三座石塔测绘质心。仅在水面内添加三个石塔符号，其相对间距为显示选择，实际岛岸不变。 |
| 断桥 | 120.14703, 30.2609053 | [OSM way 1466925249](https://www.openstreetmap.org/way/1466925249)，上游已核对的具名对象代表点；桥体尺寸和方向是便于观看的符号，不是该桥三维实测。 |

## 数据、资源与复现

运行时只请求 `data/scenes/westlake/scene-data.json`，89,219 字节。没有请求完整杭州数据，没有额外 DEM 控制器、后台计时器、纹理或独立 WebGL 上下文。

项目自带生成器 [scripts/build-westlake.mjs](../scripts/build-westlake.mjs)，直接读取本地杭州 `scene-data.json` 和 `terrain-mesh.json`，重建 `data/scenes/westlake/scene-data.json`；两份原始文件 SHA-256 记录在输出包中。生成器使用已有 `vendor/polygon-clipping.js`，无需网络依赖。使用 Node.js 18 或更新版本，在项目目录运行 `node scripts/build-westlake.mjs`；脚本按自身位置查找文件，也可以用绝对路径从其他工作目录运行。

独立验证脚本为 [scripts/check-westlake.mjs](../scripts/check-westlake.mjs)。运行 `node scripts/check-westlake.mjs` 检查当前数据与场景，默认将报告写入 `docs/qa/westlake-numerical.json`；也可用 `node scripts/check-westlake.mjs --report /tmp/westlake-numerical.json` 指定报告位置。验证不重建数据，检查单文件读取、主湖所有环与原始数据逐值一致、索引和顶点有效、真实锚点及子景点入口、加载前／中途／几何分配后取消，以及 resourcePool 归零。数值检查不替代浏览器视觉检查。早期工作记录与脚本继续保留在外层项目的 `work/hangzhou-westlake-entry/` 中。

返回对象包含 `group`、`camera`、`overviewCamera`、`hotspots`、`description`、`diagnostics`、无操作 `update()`。雷峰塔和三潭印月热点分别带 `sceneId: 'leifeng'` / `'santan'`。成功返回后由应用的 resourcePool 管理几何、材质与实例；加载取消或失败由模块释放尚未交付的资源。

归属：[局部数据 NOTICE](../data/scenes/westlake/NOTICE.md)、[杭州上游 NOTICE](../data/hangzhou-atlas/NOTICE.md)。© OpenStreetMap contributors / ODbL；OpenFreeMap / OpenMapTiles；AWS Terrain Tiles / Mapzen。本次离线派生没有重新联网核验数据时效。
