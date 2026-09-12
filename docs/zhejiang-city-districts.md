# 浙江 11 市真实分区与悬停表面

`data/regions/zhejiang-cities.geojson` 是省份浏览用的 11 市分区集合，包含杭州、宁波、温州、嘉兴、湖州、绍兴、金华、衢州、舟山、台州、丽水。名单依据[浙江省统计局的区域人口／行政区划页面](https://tjj.zj.gov.cn/col/col1525491/index.html)，本次核对日期为 2026-09-08。名单核对不表示边界是 2026 年测绘成果。

## 数据来源与处理

分区全部取自仓库已有的 **geoBoundaries gbHumanitarian / HDX, China ADM2**，数据表示年份为 **2020**，固定源提交为 `9469f09`。本次没有重新从公共地理编码服务批量查询，也没有用 Voronoi、包围框或任意城市地块替代真实面。

- [官方数据元信息](https://www.geoboundaries.org/api/current/gbHumanitarian/CHN/ADM2/)
- [固定提交的源 GeoJSON](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbHumanitarian/CHN/ADM2/geoBoundaries-CHN-ADM2.geojson)
- [原分片与许可说明](../data/regions/prefectures/README.md)
- [本次逐市来源 ID、校验值及差异测量](../data/regions/zhejiang-cities.provenance.json)

原有分片的几何坐标、多分量和孔洞全部保留，仅集合成一个文件，并补充中文名称、展示 ID、来源身份和导航元数据。坐标为 WGS84 `[经度, 纬度]`，没有 GCJ-02 或 BD-09 转换。浙江台州用相交位置与源 ID 区分同名的江苏泰州。

浙江省视图现在使用 [zhejiang-display.geojson](../data/regions/zhejiang-display.geojson)：由这 11 个市面的完整并集生成展示外轮廓，保留源数据全部岛屿，不再显示另一套省级行政面中的大块外围海域。原有 `zhejiang.geojson`、`hangzhou.geojson` 和所有城市分片均保留不动；本次仅修改城市集合的说明元数据，没有修改任何城市 geometry。[展示轮廓来源与逐项校验](../data/regions/zhejiang-display.provenance.json)记录固定源提交、原始数据及各市文件 SHA-256。

杭州分区使用同源 2020 面，保证省内城市分区来自一致的数据集；点击杭州后，独立城市页面仍由 `region-boundaries.js` 加载现有较细的 OSM 杭州边界。`sourceBoundaryId` 是展示面来源，`boundaryId` 是点击后的加载身份，不能混用。

杭州保留现有目录坐标。其他市的 `coordinates` 是从真实市面与省面交集生成的内部标签／导航点，确保点击身份落在该市内；它们不声称是市政府、中心城区或测绘中心点。`coordinateRole` 明确记录这一用途。

## 同源轮廓与原边界差异

11 市的源面几何均有效，彼此没有面积重叠。新展示轮廓是它们的同源并集：共有 24 个连通分量、2,114 个坐标，原市面 33 个分量全部保留；相邻市域连接后合并为较少的分量。展示范围与 11 市并集双向差集均为空，因此没有显示出来却不属于任何城市的省面。源行政面没有孔洞；西湖、千岛湖和其他范围内的水系继续由真实水层呈现，不会被填成陆地。

较细 OSM 浙江省界与 2020 年概化城市面不能当成同一版数据。此前的混合显示存在以下差异，保留在来源记录中：

| 对比 | Web Mercator 投影面积比例 |
| --- | ---: |
| 城市并集中位于原 OSM 省面外的部分 | 约 1.48% |
| 原 OSM 省面中没有任何城市面覆盖的部分 | 约 33.25% |

这些是显示投影下的几何差异指标，**不是官方土地面积统计**。原省面包含行政海域，源城市面还存在海岸、岛屿和年代概化差异。不能把所有差异都解释成海面。

用户截图中温州海岸未随悬停抬起的条带符合这一来源差异。定向检查发现 `[120.84949,27.85903]`、`[121.07227,28.26718]` 等沿海点在原 OSM 省面中，但不在任何一个 2020 城市面中，且页面同类的 z7 矢量水层没有将这些点标成水。省地形会显示它们，市级高亮却没有对应面。这里只确认了同一区域的数据不一致机制，没有将用户截图逐像素地理配准，也没有证据将差异全部归因为填海或某次行政调整。

新展示面直接使用同源并集，既不把条带凭最近距离划给温州，也不把没有来源的面补到任何城市。市面与省地形仍做几何相交以保持裁切安全，但不再被另一版省界削掉。此前不在 2020 市域源中的沿海条带不属于新展示面；这解决显示一致性，不能宣称已经补齐当代更精细的陆地或岛屿。

### 外围海面与内陆水系

新轮廓移除了原行政海域的宽阔海面，保留该源全部岛屿分量及范围内的河流、湖泊。它仍是概化城市行政面的并集，不能当成精确海岸线。一次 2026-09-08 的 [OpenFreeMap](https://openfreemap.org/quick_start/) z7 水层交叉检查（9 块瓦片，快照 `20260830_080001_pt`）测得，新并集约 0.0477% 的投影面积与 `ocean` 相交，原 OSM 省面约为 29.48%。小量近岸水域重叠可能保留，不能声称绝对零海水。

`ocean`、`lake`、`river` 的含义依据 [OpenMapTiles 水层定义](https://github.com/openmaptiles/openmaptiles/blob/master/layers/water/water.yaml)。该交叉检查使用概化显示数据，不是精确海岸或土地登记审核；水层只用于量化检查，没有用于改变本次 CC BY 3.0 IGO 展示轮廓。记录见 `work/zhejiang-outline/water-comparison.json`。

## Three.js 模块约定

```js
import {createProvinceDistricts} from './src/province-districts.js';

// 先完成 terrain.setWaterMask(...) 与 terrain.setSurfaceTexture(...)。
const districts = await createProvinceDistricts({
  region, projection, terrain, signal,
  reducedMotion: false,
  liftHeight: .22,
  onHover: city => console.log(city),
});
scene.add(districts.group);

// 调用方将地形射线命中点反投影成 WGS84，经本模块判断市域。
const city = districts.hitTest([longitude, latitude]);
districts.setHovered(city?.id || null);
districts.update(deltaSeconds);
// 点击由调用方路由处理；本模块不切换区域。
districts.dispose();
```

当前仅支持浙江。返回值为 `group`、`cities`、`hitTest(lnglat)`、`setHovered(id|null)`、`setReducedMotion(bool)`、`update(deltaSeconds)`、`dispose()` 和 `diagnostics`。`onHover` 在有效选项变化时通知，不生成额外渲染循环或 DOM 控件。`cities` 包含中文名称、英文匹配名、稳定 ID、导航坐标、边界 ID 与来源 ID。

默认显示全部市界；只让一个城市的高亮面和侧裙可见。抬升默认为 0.22 个场景单位，可调范围 0.15–0.35，使用单调缓动，没有弹跳和过冲；减少动态效果时直接到稳定位置。取消悬停或切换城市时上一块立即隐藏，避免同时浮起多块。`update` 接收每帧经过的秒数，不接收 RAF 毫秒时间戳。

高亮面直接裁切省份最终 `terrain.terrainMesh` 的三角形，并插值同一三角面的高程、法线和 UV；不重新采样一张可能穿插的 DEM 表面。高亮借用当前地形贴图，保持道路、水域与地表纹理对齐。侧裙下沿停在原地形，上沿跟随抬升，底层省份地貌保留；边界线使用很小的表面偏移避免闪烁。

若创建后改变底层地形、水面或贴图，调用方应销毁并重建分区。模块不修改底层省份几何。共享四份材质；当前区域退出时中止加载、释放自己的几何和材质，清空城市数据，不销毁借来的地形纹理。预建城市高亮几何只属于当前省份实例，不形成跨地区缓存。

## 许可与验证

数据遵循 [CC BY 3.0 IGO](https://creativecommons.org/licenses/by/3.0/igo/)。保留署名 **geoBoundaries / HDX, China administrative boundaries (2020)**、许可链接及本次处理说明，不暗示来源机构认可产品。省界与底图仍保留其各自 OSM / ODbL 等来源说明；应用 MIT 不重新授权这些数据。

数据检查脚本与结果位于 `work/province-districts/prepare-zhejiang.py`、`data-validation.json`。独立实际浏览器验证脚本为 `work/province-districts/check-districts.cjs`，结果和截图放在同目录；它用于检验 11 市命中、三角面／UV 贴合、单块悬停、减少动态效果、取消和资源释放。页面集成与完整中国→浙江→杭州流程由应用验收另外记录，独立模块通过不代表页面已接线。

改用同源省级展示轮廓之前，2026-09-08 的独立桌面 Chrome 模块验证使用实际浙江 DEM 与 OpenFreeMap 地表：11/11 市内点命中正确，509 个表面采样的最大高度偏差为 0.00000281 场景单位、UV 偏差为 2.26×10⁻⁸；全部三角面方向及有限值检查通过。单块显示、减少动态效果、预取消、加载中取消、幂等释放均通过，四份自有材质释放且借用纹理没有被销毁，页面无错误。默认与杭州抬升截图已实际查看。此历史记录不代替新展示轮廓的页面验收。

该次分区几何为 64,257 个顶部三角形，自有几何缓冲约 5.20 MB，构建耗时约 3.57 秒；这是本机实测，不是跨设备性能保证。使用真实多边形的窄条带缓存将裁切工作减少，优化前后该轮几何数量与采样误差保持一致。

同源展示轮廓由 `work/zhejiang-outline/prepare-display.py` 生成。`display-validation.json` 校验所有城市 geometry 与原分片逐坐标相等、所有源分量包含于展示面、双向差集为空、标签点在面内、西湖与千岛湖代表点保留；没有修改杭州或其他城市的独立边界。加载端仅在浙江省份页面选择这个 Feature，保留 `boundaryRole=prefecture-union-display-outline`，不得将其标成包含完整行政海域的省界。
