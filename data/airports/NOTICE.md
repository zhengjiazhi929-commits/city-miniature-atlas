# 三城机场地理数据与来源

快照日期：**2026-09-09**。本轮只包含主要民用客运机场：杭州萧山、香港国际、武汉天河。机场是基础设施，`countsAsAttraction:false`，不计入景点数量；不拓展到所有军用机场、直升机起降点或临时起降场。

## 数据接口

三个运行时文件为 `hangzhou.json`、`hong-kong.json`、`wuhan.json`，坐标均为 WGS84 / EPSG:4326，数组顺序 `[经度,纬度]`。

- `coordinates`：具名 OSM 机场区域的 Nominatim 代表点；`anchor.source/role` 说明来源与点的含义。不是把地址搜索结果当作测量 ARP。
- `boundary`：`[polygonRings,...]`，每面 `polygonRings=[outerRing,...holes]`。机场用地映射范围用于树木、普通楼群避让，不能当作产权或安全边界测绘成果。
- `runways`：每条包含 `points:[端点1,端点2]`、`designators:[首端编号,另一端编号]`、`widthMeters`、`publishedLengthMeters`、`geometryLengthMeters`、`source` 与现役状态来源。同条跑道被 OSM 拆成多段时合并为一条。
- `terminals/aprons`：每条为一面 `rings:[outerRing,...holes]`，多个面分条。真实已映射轮廓保留；并非所有航站建筑都在处理普通客运。`heightMeters:null` 表示未取得实测高度；楼层数单独保存，不能直接当米数。
- `elevationMeters` 只在 OSM 明确有 `ele` 时提供（如杭州 7 米）；机场模型应贴当前地图的实际显示地表。它不是强制把整座机场抬到一个标高的命令。
- 未提供未经核实的 `aircraftStands`；不据此猜飞机停放位置。

## 现役跑道核实

| 机场 | 现役跑道 | 公布长度 × 宽度 | 运行状态依据 |
| --- | --- | --- | --- |
| 杭州萧山 | 06/24；07/25 | 3400×60 米；3600×45 米 | [机场2025年双跑道运行资料](https://www.hzairport.com/party/detail/id/6369.html)，尺寸与原始OSM标注及[2012年杭州报道](https://hznews.hangzhou.com.cn/chengshi/content/2012-11/07/content_4464282_2.htm)交叉核对 |
| 香港国际 | 07L/25R；07C/25C；07R/25L | 各方向公布3800×60米，见下述铺装区别 | [机场2024-11-28三跑道启用公告](https://threerunwaysystem.hongkongairport.com/en/three-runway-system/project-updates/hong-kong-international-airport-commissions-three-runway-system/)及[2026-09-03现行eAIP](https://www.ais.gov.hk/eaip_20260903/2026-09-03-000000/html/eAIP/VH-AD-2-VHHH-en-US.html) |
| 武汉天河 | 04/22；05L/23R；05R/23L | 3400×45 米；3600×60 米；3200×45 米 | [前两条尺寸](https://www.wuhan.gov.cn/sy/whyw/202206/t20220627_1994221.shtml)、[2025-01-23第三跑道启用与新编号](https://www.wuhan.gov.cn/sy/whyw/202501/t20250123_2524244.shtml) |

**香港跑道端点存在需要明确区分的来源情况：**

1. 中跑道 OSM 整条中心线映射约 **4220.85 米**。当前[官方 ADC-1 总平面图](https://www.ais.gov.hk/eaip_20260903/2026-09-03-000000/pdf/VH-AD-2-VHHH-ADC-1.pdf)显示 07C、25C 两方向的起止位置错开，各方向公布3800米；因此保留整段映射铺装，同时单列公布长度。4220.85米是地理几何计算值，未找到官方直接公布该数值，不能称为4220米 TORA。
2. 北跑道 OSM 东北末端段 `way1034755024` 延到距25R阈值约348米处，和当前官方174米内移量不一致。运行时端点改用当前官方07L、25R阈值坐标，按真方向070.90°分别向外推174米，约3796.59米；这是注明算法的地图展示推导。原始OSM端点、约3970.39米映射长度和冲突原因全部保留，不静默篡改源数据。
3. 南跑道合并实际映射的内移阈值段后约3795.82米，与公布3800米差异在映射/计算精度范围内。不要把落地阈值直接当整条物理跑道端点。

以上均为旅游地图几何表达，不提供航空运行导航数据；任何运营参数应以现行正式航行资料为准。

## 航站楼状态与形态来源

- 杭州：[机场官方T4平面图](https://www.hzairport.com/upload/file/2022-08/1661252661462927.pdf)约束指廊形态。[2026年机场公告](https://www.hzairport.com/en/tender/detail/id/6037.html)列目前在用T3（原T3、T1）及T4，T4南区预计2026-12-01投运。保留已建建筑轮廓，不据此声称每个区都已开放。第三跑道只见[四期扩建可研资料](https://www.hzairport.com/mobile/tender/detail/id/5752.html)，未加入现役跑道。
- 香港：[T2出发设施已于2026-05-27启用](https://www.hongkongairport.com/en/media-centre/press-release/2026/pr_1868)，T2C新登机廊属于后续阶段；不把两者状态混为一谈。可参考[官方机场旅客地图](https://www.hongkongairport.com/en/map/)。当前eAIP周期为2026-09-03，但该周期引用的ADC-1图页自身最后修订日期是2025-09-04；两种日期分开记录。
- 武汉：T2、T3是普通客运主体；[2026年机场采购公告](https://www.hbbidcloud.cn/hubei/jyxx/004002/004002006/20260717/554db677-096f-4a09-8c12-986b9f880017.html)将T1列为公务机/贵宾与联合运控用途。[南航官方指南](https://www.csair.com/sg/zh/tourguide/airport_service/airports_info/domestic/18h97q3mp508j.shtml)可核对T3与交通中心，但页面无版本日期，不能单独用它判断第三跑道现状。

## 覆盖范围与后续城市

本轮三座机场都位于对应城市范围内，使用真实坐标显示。后续城市若主要服务机场位于市界之外，**保持城市边界不变，只提供机场名称与距离信息**，不把机场模型移进城市。距离必须注明计算口径；未发现市内主要民用客运机场时不要虚构一个机场。

当前轮廓来自公开OSM快照，可能缺少最新扩建、服务道路、滑行道细节或航站内部区划。跑道现役条数有独立官方核实；普通附属建筑和机坪只声明为已映射结构，不声称完整运营状态已经逐项确认。

## 版权、原始材料与复现

几何数据 © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，按 ODbL 1.0 归属；不将地理源数据误标为应用代码的 MIT 许可。官方网页、PDF、平面图分别归原发布者所有。

`sources/fetch-manifest.json` 记录成功的公开地图API请求、查询范围、文件哈希与本地保存时间；各JSON条目还保留原始要素ID、版本和源时间戳。`sources/build-airports.py` 可从冻结的原始快照重建运行时JSON，不联网。官方HTML/PDF/PNG是本地核实材料，不代表已经取得再分发授权；发布仓库时可保留链接与必要的来源说明，不默认再发布整份官方文件。

读取地图服务发生过406、超时或查询范围过大等失败；失败响应单独标为 `failed-...`，从未用于生成设施几何。运行时只加载三个精简机场JSON，不加载原始地图快照、HTML或PDF。
