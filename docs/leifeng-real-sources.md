# 西湖·雷峰塔：真实地理场景

这个场景使用真实高程、水岸、地表和道路数据，把雷峰塔放回对应塔址。它不是景区测绘模型：塔的细部为简化外观，周边缺少高度依据的建筑只保留平面轮廓。

## 展示范围与坐标

- 取景框为 WGS84 `[120.1398,30.2293]` 至 `[120.1502,30.2383]`，约 1 公里见方。**矩形是展示取景框，不是景区行政边界。** 边缘厚度是沙盘底座，不表示地质剖面。
- 塔址采用 `[120.1450125,30.2338837]`，对应 [OSM way 229726934](https://www.openstreetmap.org/way/229726934) 的八角塔基中心。已保存原始塔基节点与标签：[tower-way.json](../data/scenes/leifeng/tower-way.json)。这是地图要素的代表中心，不能视为官方测量控制点。源标签中的 Six Harmonies Pagoda 英文别名有误，未用于场景命名。
- 旧目录 `[120.1495,30.2301]` 与该塔址约相距 600 米。没有把高德等不同坐标体系的 POI 直接当作 WGS84。
- 南山路标注使用归档道路要素上的真实顶点；西湖南岸标注是当前取景框中的水域代表点。

## 数据与处理

| 内容 | 来源 | 实际处理与边界 |
| --- | --- | --- |
| 地形 | [Mapzen Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/) 的 4 张 z15 Terrarium 瓦片 | 本地归档、解码为米制高程，统一采样为 256 格。网格变密不等于原始数据精度提高；不生成随机或高斯山形。 |
| 西湖水岸及岛洞 | [OSM 西湖 relation 2308774](https://www.openstreetmap.org/relation/2308774) | 按原始多边形拼接，裁至矩形取景框。水域从地形顶面扣除，避免两层面互相穿插。 |
| 道路、路径、林地、建筑轮廓 | [OSM API 地图范围](https://api.openstreetmap.org/api/0.6/map?bbox=120.1398,30.2293,120.1502,30.2383)，补充必要完整关系 | 192 个源要素，73 条/处道路及步行区域、77 个周边建筑轮廓；道路中心线保留原几何，显示宽度属于制图样式。 |
| 塔基 | [OSM way 229726934](https://www.openstreetmap.org/way/229726934) | 塔基沿源八角轮廓；上部塔体使用统一米制比例，不单独放大。 |

源数据与请求地址、SHA-256 见 [metadata.json](../data/scenes/leifeng/metadata.json)，可重用数据见 [source-features.geojson](../data/scenes/leifeng/source-features.geojson)。读取时间为 2026-09-08。

高程沿用仓库的有界离群值处理：四张完整瓦片共修正 10 个异常像素，原始 PNG 保持不变；具体前后数值见 [scene.json](../data/scenes/leifeng/scene.json)。场景内有效地表采样约 9.2–89.6 米；这不是区域最低点或最高点的测量结论。

每个水面取该源水域内 DEM 采样中位值，西湖部分约为 10.49 米。这个值仅用于匹配同源地形，**不是官方西湖水位**。源水岸上的地形顶点与水面衔接；湖岸附近的局部坡面仍受 DEM 分辨率及水岸数据年代差异影响。模型统一减去该水面基准，不改变山体与塔的相对米制比例。

## 塔体依据及简化

1. [杭州市文化广电旅游局：雷峰塔（雷峰夕照）](https://wgly.hangzhou.gov.cn/art/2022/12/1/art_1229696389_58943150.html) 确认新塔位于原塔址、通高约 71 米及遗址保护罩。该页把层数和边数写反，不能据此制作“五面八层”的塔。
2. [杭州网：带你了解杭州雷峰塔](https://z.hangzhou.com.cn/2022/syjy/content/content_8421276.html) 提供重建后照片，以及铜构瓦、脊、斗拱、栏柱和暗红色外观的信息。该页采用约 72 米的表述；与 OSM `height=71.7` 相容。模型采用约 71.7 米作为名义总高，不宣称毫米级精度。
3. [重建后近景实拍，HoweyYuan，2024-07-29](https://commons.wikimedia.org/wiki/File:Leifeng_Pagoda_20240729_103559.jpg) 用于检查外檐、栏杆与铜构外观；照片没有作为贴图或资产重新分发。
4. [参与考古者郑嘉励的遗址发掘记](https://hznews.hangzhou.com.cn/wghz/content/2020-04/23/content_7720322.htm) 说明历史五层八面形制的依据。本场景表现现代重建塔的外观，不表现古塔内部遗存。

塔体的分层高度、檐口曲线、窗格、栏杆和斗拱是根据已知形制及照片做的视觉简化，缺少施工图校核。它们不是可用于建造、结构分析或遗产数字化存档的精细测量成果。没有添加无来源的亭、船、桥、树木坐标或林间曲径；未确定高度的周边建筑没有编造体量。

## 离线资产及复用

- [scene.glb](../data/scenes/leifeng/scene.glb)：标准几何与 PBR 材质，内嵌地表纹理；约 6.2 MB、约 13.1 万三角面、15 个网格。普通 GLB 查看器可打开。入口镜头靠近塔体；完整一公里地理范围始终保留，可缩小查看，并未放大建筑。
- [build.js](../data/scenes/leifeng/build.js)：在仓库 HTTP 服务中调用 `buildLeifengReal()`，从同目录归档数据重新生成 `group`；用仓库自带 `GLTFExporter` 的 `binary:true` 导出。构建只读取本地归档。
- [leifeng-real.js](../src/scenes/leifeng-real.js)：`await createLeifengReal(signal)` 返回既有景点契约。运行时只读取本地 GLB 与 JSON，无在线 DEM 控制器或工作线程。
- 已验证载入中取消会释放尚未交给页面的资源；返回后由应用资源池管理。切换页面后仍在进行的 GLB 导出可保留资源至结束。

## 许可与署名

OSM 源数据遵循 [ODbL 1.0](https://www.openstreetmap.org/copyright)，已提供可复用的派生地理数据。DEM 保留 Mapzen 及 [USGS、NOAA 和其他上游贡献者的归属](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)。这些数据不因仓库原创代码采用 MIT 而转成 MIT。

展示或再分发模型时保留：**© OpenStreetMap contributors · Mapzen Terrain Tiles / USGS / NOAA**，以及本页的数据来源与简化说明。细分说明见 [资产 NOTICE](../data/scenes/leifeng/NOTICE.md)。
