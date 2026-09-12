# 湖滨银泰：总览条目与模型来源

核查日期：2026-09-10。条目 ID：`hubin-yintai`。

## 名称与空间类型

- [银泰集团 in77 项目介绍](https://www.china-yintai.com/zh-CN/business/commercial-group/in77)确认项目名为“杭州湖滨银泰in77”。产品依用户名单简称“湖滨银泰”。
- [银泰集团：湖滨银泰三期开业，2017-12-18](https://www.china-yintai.com/zh-CN/news/detail/221)说明这是毗邻西湖的跨街区商业项目，包含庭院里弄商业；三期 D 区为地上四层，并通过连廊和地下通道连接其他区块。此来源用于确认低层商业街区表达，不用于声称所有区块层数相同。
- [银泰集团：湖滨步行街授牌，2020-07-23](https://www.china-yintai.com/zh-CN/news/detail/478)确认湖滨银泰坐落在由湖滨路、东坡路、平海路等组织的湖滨步行街区域。
- [Apple Maps 项目条目](https://maps.apple.com/place?auid=1118368763572032&lsp=57879)列出延安路258号的项目地址。此地址仅作名称/位置交叉核对，没有使用该地图的中国区坐标作为 WGS84 坐标。

## 坐标与许可

直接请求 [OpenStreetMap way 109882469](https://www.openstreetmap.org/way/109882469) 的 [API full.json](https://www.openstreetmap.org/api/0.6/way/109882469/full.json)，返回 `name=湖滨银泰in77 A区`、`building=yes`，way version 4。按该闭合建筑轮廓的面积质心计算，以 `[120.157724, 30.2556862]` 作为 WGS84 经度/纬度代表点。

该点是 A 区建筑的代表点，不是整个 in77 多区块项目的几何中心，也不表示测量控制点、入口或所有区块的真实边界。原始8顶点闭合环保存在 `hubinPlace.sourceFootprintCoordinates`，可复算质心。没有采用高德 GCJ-02 或百度 BD-09 坐标混入地图。

坐标数据 © OpenStreetMap contributors，遵守 [ODbL](https://www.openstreetmap.org/copyright)。官方新闻图片仅用于阅读核对，没有复制到产品中。

## 模型边界

`src/hubin-overview.js` 的 `createHubinOverview()` 输出城市总览中的低层商业街区符号：六组简化店铺、开放步行轴、两个横向间隙、实体橱窗与有柱支撑的店前雨棚。没有制造一座不存在的摩天大楼。它不是A区或全部项目的逐栋复原，店铺数量、层数表达、颜色、尺寸与街内布局均为概括设计。

原生局部轴：+X 向东，-Z 向北。底板宽 `.84`、深 `.56`、厚 `.016`，模型总高 `.228`，底面为 `Y=0`。这些是沙盘显示单位，不是米。全部变换烘焙到顶点，根节点与子网格保持单位变换；调用方仍需对整个底面进行真实地面适配，不能只取中心或最高点放置。

输出为 `THREE.Group`，仅使用独占的几何和材质，跟随当前场景统一释放。`overviewOnly=true`，此轮没有新建独立详细沙盘。
