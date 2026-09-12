# Geographic data and rendering

当前城市与省份沙盘直接使用 Three.js。杭州使用随包处理结果；通用地区通过在线 DEM 和 OpenFreeMap 矢量资料加载地貌、道路、水体及建筑轮廓。旧 MapLibre 文件不是当前渲染路径。

- 省级选择轮廓：Natural Earth，公共领域；具体处理与限制见 [map-data.md](map-data.md)。
- 独立 OSM 区域边界：见 [data/regions](../data/regions/README.md)，ODbL。
- 其他城市边界：geoBoundaries / HDX 的 2020 ADM2 快照，CC BY 3.0 IGO；不同层级与缺失限制见 [prefectures](../data/regions/prefectures/README.md)。
- 地形：Mapzen / AWS Terrain Tiles，采用 Terrarium 编码；来源包括 USGS GMTED2010/SRTM、NOAA ETOPO1 等，[数据集登记](https://registry.opendata.aws/terrain-tiles/)。不同地区精度与来源不完全相同；保留来源署名，参见 [高程处理](terrain-quality.md)。
- 道路、水体、地类、建筑：© OpenStreetMap contributors，经 OpenFreeMap/OpenMapTiles 提供或本地处理，保留 ODbL 和每份资料的来源记录。
- 杭州：具体输入、处理、数据快照见 [杭州 NOTICE](../data/hangzhou-atlas/NOTICE.md) 和 [当前架构](architecture.md)。

统一使用 WGS84 `[经度, 纬度]`；高程与建筑高度以米表示后由投影转换。不要混用地面海拔与楼体高度。缺失高度、楼层估计、显示夸张均需与实测值区分。

保留边界多分量和孔洞、水系拓扑与来源坐标。城市模型缺少某片区，不表示那里没有建筑；可能是来源覆盖、显示概化或预算限制。联网地区在源服务不可用时应显示加载问题，不得用虚构地图填充。

完整许可分组见 [NOTICE](../NOTICE.md)。新增城市需要自己的地理来源；仓库不是完整全球城市数据库，也不是地图导航或行政边界认证服务。
