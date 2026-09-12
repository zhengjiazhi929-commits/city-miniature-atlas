# 西湖独立地理沙盘数据

本目录为现有杭州离线资料的局部派生数据。打开西湖仅加载 `scene-data.json`，不加载完整杭州地形或土地利用数据。

- 显示范围：WGS84 `[120.105, 30.217, 120.169, 30.273]`，顺序为西、南、东、北。此矩形用于呈现完整湖面及紧邻山林、道路和城区，**不是西湖风景名胜区的官方边界**。
- 主湖来源水体：原始 `areaMeters=6124570`。其外轮廓与 6 个岛屿／堤体孔洞原样保留；原始水体 bbox 为 `[120.1189756, 30.2280732, 120.1578999, 30.2626257]`。该面积字段是原来源几何计算值，不是当前实测湖面积。
- 地形：裁切原有 `data/hangzhou-atlas/terrain-mesh.json` 的三角面，高程线性插值于原面内。原始城市 DEM 格网约 900 米，局部地形只能表达概括起伏，不能据此判断精细山脊、岸高或建筑高程。显示地形细分仅改善颜色与法线，不增加真实地形细节。
- 道路：保留来源 trunk、primary、secondary，包含原有桥／隧道属性。隧道不显示地上路面；无 bridge 属性却穿过源水面的短段不显示。未补造苏堤、白堤道路中心线或旅游步道；水体本身已有的陆地孔洞保留。
- 森林与建成区：来源面内放置少量代表树群与楼群，不代表逐树位置、逐栋脚印、数量、树种或测量高度。空白来源区域不等于没有植被或建筑。
- 地标：使用既有核对坐标，雷峰塔与断桥采用小型代表模型；三潭印月保留代表点并仅添加三个石塔符号，不重造岛屿。石塔之间的显示间距、桥体方向和建筑外观不是独立测绘复原。
- 比例：统一局部 Web Mercator；1,000 地面米约对应 4 场景单位，无额外水平变形。地形高差显示为 2.5 倍。主湖水位 12.1 米是上游岸边 DEM 百分位估计，非实测或实时水位。岸壁为中性立体断面，不代表实测驳岸设施。

底图和矢量：© OpenStreetMap contributors，ODbL，由 OpenFreeMap / OpenMapTiles 提供。地形：AWS Terrain Tiles / Mapzen。必须保留本说明与上游归属信息。

来源和 SHA-256 位于 `scene-data.json.source.localSources`。上游说明：[杭州 NOTICE](../../hangzhou-atlas/NOTICE.md)。制作与验证说明：[西湖来源](../../../docs/westlake-geographic-sources.md)。

来源链接：[OpenStreetMap copyright](https://www.openstreetmap.org/copyright)、[OpenFreeMap](https://openfreemap.org/)、[AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)。此版本仅复用已归档资料，未重新联网测绘或核验时效。
