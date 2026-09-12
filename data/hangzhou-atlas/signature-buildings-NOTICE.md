# 杭州代表建筑数据与建模边界

核查日期：2026-09-09。对象限定为钱江新城／奥体、武林、未来科技城的 **8 组已建项目**。这是独立的实地结构输入；没有修改全市边界、地形、水系、景点坐标或原场景数据。几何来源为 OpenStreetMap 社区快照，不是实测建筑图纸。

## 坐标与模型接口

- `coordinates`：EPSG:4326，经度、纬度。由所列源面计算面积中心，作为模型组原点；不是入口或测量基准点。市民中心原点在庭园中，大莲花原点在运动场中，这些孔洞是开放空间，不是水体。
- `footprint`：GeoJSON Polygon／MultiPolygon，保留孔洞与多个真实建筑地块。`footprintRole` 明确它是楼体、裙房或园区用地。不得把园区内部、两塔间道路、庭院孔洞填成实心建筑。
- `dimensions.widthMeters/depthMeters`：在 `orientation` 轴向下由源轮廓包络计算的尺寸；通常为最小面积外包矩形。地理计算采用当地纬度的等距近似，适用于本轮微缩示意，不宣称测绘精度。
- `orientation.degreesFromNorth`：从真北顺时针至模型 **+X 主轴**；局部 **+Z** 指向该主轴的顺时针右侧。角度只是源面包络或双塔连接轴，没有证据就不声称真实主入口朝向。小莲花近圆，方向显式为 `null`；其 dimensions 中的计算轴只用于量包络。
- `shape.components[].coordinates`：各有源部件的独立地理中心。另给两种偏移：`offsetMetersEastNorth` 是真实东／北，`offsetMetersCanonicalXZ` 已转成模型局部轴。建模只能选一套，不能重复偏移或旋转。各部件地理位置不应被统一塞到一个假地块。
- 模型地面 `y=0`。允许另行设置展示比例和名义高度；必须把这种展示选择与真实源坐标、核验高度分开记录。

## 入选对象与一手形制来源

| ID | 可用识别形态 | 高度边界 | 地图来源 |
|---|---|---|---|
| hangzhou-gate | 310 米曲面双塔，中部曲线连接及拱形下腹；不是塔顶横梁 | SOM 310 米，2023 已完工，64 层 | [西南塔](https://www.openstreetmap.org/way/1015040645)、[东北塔](https://www.openstreetmap.org/way/1015040647) |
| civic-center | 六塔围合中庭与高位连接 | 总高未填；资料中的 85／90 米是连接高度，不能当总高 | [中央环形建筑及庭院孔洞](https://www.openstreetmap.org/relation/4762996) |
| conference-center | 金色球体与低矮椭圆附属体 | 一手幕墙项目：结构高 85 米，球径约 85 米，附属体 13 米；不能相加成 98 米 | [裙房主体](https://www.openstreetmap.org/way/626838544) |
| big-lotus | 开口椭圆体育场，28 大瓣＋27 小瓣 | 无已核定总高，OSM 2 米不采用 | [大莲花](https://www.openstreetmap.org/relation/8718531) |
| small-lotus | 近圆网球馆，24 固定外瓣＋8 旋转屋盖瓣 | 无已核定总高，OSM 5 米不采用 | [小莲花](https://www.openstreetmap.org/relation/9874418) |
| hangzhou-center | 双矩形玻璃塔、多层玻璃盒子商业裙房、退台绿化 | GP 项目表：双塔 130 米 | [整体建筑面](https://www.openstreetmap.org/way/1071415098) |
| efc | 两座细长框边塔，保留各自真实地块 | 总体 verifiedHeight 为 null；业主 220 米仅明确指 T6，源塔号映射存在冲突 | [英国中心](https://www.openstreetmap.org/way/641923497)、[OSM T6](https://www.openstreetmap.org/way/641923474) |
| alibaba-xixi-c | 六栋中层办公、访客中心、共享连接与开放大庭园 | 日本设计项目高度 80 米是园区最高尺度，不是每栋统一高度 | [西溪 C 区园区边界](https://www.openstreetmap.org/way/645093961) |

杭州之门：[SOM 已完工项目](https://www.som.com/projects/greenland-hangzhou-century-center/)，[SOM 官号中部连接说明及照片](https://www.linkedin.com/posts/skidmoreowingsmerrill_the-hangzhou-century-center-designed-by-activity-7171913945488711680-I4fe)。其连桥的精确曲率、连接楼层没有源几何支持，模型只可做有依据的辨识性概括。不要混淆尚在建设阶段的西站云门项目。

市民中心：[ATELIER L+ 建筑师项目介绍](https://www.world-architects.com/zh/projects/view/hangzhou-citizen-center)。整体是约 400 米方形街坊、六塔与四组裙房；此处 OSM 面只涵盖约 197 米中央环，不能把其包络冒称完整街坊或随意填足 400 米。

国际会议中心：[Hunter Douglas 一手幕墙项目](https://ap2.hunterdouglas.asia/project/hangzhou-international-conference-center)。球体中心取其源上部构件面；整体中心取源裙房面。OSM 主面 20 米是低部模型标签，不替代 85 米整体数据。

大小莲花：[NBBJ 已完工项目](https://www.nbbj.cn/work/hangzhou-olympic-sports-center/)，[国家体育总局大莲花形制](https://www.sport.gov.cn/n14471/n14482/n14519/c932351/content.html)，[杭州网球公开赛小莲花场馆页](https://www.hangzhouopen.com/en/tournament/venue)，[总局所载建筑师关于屋盖的访谈](https://www.sport.gov.cn/n14471/n14482/n14519/c876605/content.html)。小莲花屋盖开／闭是模型展示状态，不是实时场馆状态。

杭州中心：[GP 项目](https://www.gpchicago.com/architecture/four-seasons-hotel-hangzhou-hangzhou-center/)，[GP 完工公告](https://www.gpchicago.com/news/goettsch-partners-celebrates-completion-four-seasons-hotel-hangzhou-hangzhou-center/)，[四季酒店官方地址](https://www.fourseasons.com/zh/hangzhoucentre/getting-here/)，[华润商业开业公告](https://www.crmixclifestyle.com.hk/gsxw/2023-12-26/1974445.html)。GP 英文完工公告中 Wuhan Square、near Qiantang River 地理文案不沿用；地址与 OSM 确认它在武林广场东侧、运河南侧。单塔独立平面未经核实，不能把整体裙房面称为两塔测绘图。

EFC：[基汇资本 T6 收购公告](https://www.gawcapital.com/wp-content/uploads/2020/06/Press-Release-Gaw-Capital-Partners-Completes-the-Acquisition-of-EFC-T6-in-Hangzhou_04062020.pdf)，[Foster 设计并入驻的杭州办公室](https://www.fosterandpartners.com/studio/hangzhou)，[FORCITIS 幕墙顾问实景项目](https://www.forcitis.com/en/case/tower/12)，[UAD 署名项目文章](https://www.archina.com/index.php?a=show&g=works&id=12712&m=index)。OSM 英国中心标签 232 米／47 层，另一源面名 T6 却标 apartments；业主 T6 为 220 米／46 层。保持冲突，不把任一塔号或高度强行复制到两塔。两面几何位置可用；具体塔号和用途不作为视觉标签。不同竣工年份可能指不同阶段，不强填全项目单一年份。

阿里全球总部：[日本设计 2026 项目册](https://www.nihonsekkei.co.jp/wp-content/uploads/2026/02/GLOBAL-PROJECT-REPORT2026_JPN-CHS_rev1.pdf) PDF 第 28 页、印刷 49–50 页；[阿里官方总部视频资源](https://www.alibabagroup.com/en-US/resource-video) 2024-05-10；[杭州官方来源启用报道](https://en.hangzhou.com.cn/News/content/2024-05/16/content_8730061.html)；[余杭 2025 现场活动](https://www.yuhang.gov.cn/art/2025/1/13/art_1532133_59128840.html)。它在文一西路北、高教路东，不能移植 A 区“文一西路 969 号”的位置。日中资料的庭园面积数值冲突，未入模型参数。OSM 内部建筑映射不完整，没有用它们伪装成六栋完整精确楼体；六体围庭形态属于建筑师实景依据下的示意重建。

## 地理与视觉验收边界

这些坐标各自独立。钱江新城三处位于钱塘江北岸；杭州之门和两座莲花馆位于南岸；杭州中心在武林；EFC 与阿里 C 区在未来科技城。完整城市尺度下可以用额外显示比例使地标可读，但放大后的体量必须另检水域、道路、机场与其他建筑避让，并保留真实锚点；本数据核实不等于运行画面已通过视觉验收。

没有采用环球中心作为第九项：高度与年代资料冲突，限时内未找到足够稳定的唯一源几何，不凑数量。

## 复现与归属

- 构建脚本：`work/hangzhou-signatures/build-registry.py`，只读取冻结的 east OSM 与 west-north 资料生成 JSON。
- 原始查询、时间、bbox 与哈希：`work/hangzhou-signatures/east/*-query.json`、west-north 目录中的原始查询；主 JSON 的 `sources` 记录输入 SHA-256。
- 建筑简介是按所列一手来源独立概括，照片只用于内部形态核查；不代表取得照片公开再发布许可。
- 地图：© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。发布数据时保留归属和适用许可。
