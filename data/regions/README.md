# 独立区域行政边界

此目录包含香港、浙江、杭州、武汉四个区域的 **OpenStreetMap 行政边界面**，供独立区域沙盘裁切使用。坐标与属性来自有来源记录的行政关系，不是手绘轮廓、中心点缓冲区或包围盒替代面。

这些是 OSM 社区维护的行政区数据，不能据此宣称为官方审定边界、精确测绘海岸线或实时行政区划。全国选择图的 Natural Earth 数据仍是独立资产；此目录没有替换其他省份。

## 文件与接口

- `index.json`：四个区域的文件路径、完整范围、镜头中心、内部点、来源和校验值。
- `{id}.geojson`：**单个 GeoJSON Feature**，包含 `Polygon` 或 `MultiPolygon`。
- `provenance.json`：每次下载 URL、时间、原始字节数及 SHA-256、OSM relation ID、处理步骤、简化容差、几何数量及输出 SHA-256。
- `DATA_LICENSE.md`：本目录的 ODbL 数据许可及署名要求。

路径以应用根目录为基准，例如 `./data/regions/hangzhou.geojson`。`properties.bounds` 为 `[[west,south],[east,north]]`；Feature 的标准 `bbox` 为 `[west,south,east,north]`。`center` 是包围盒中点，只服务于完整区域镜头构图；它不是市中心或陆地中心。`interiorPoint` 保证位于行政面内，但沿海区域该点也可能位于水上。

所有坐标均为 **WGS84 经度、纬度**，遵循 [Nominatim GeoJSON 输出](https://nominatim.org/release-docs/latest/api/Output/)及 [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946#section-4)。没有进行 GCJ-02、BD-09 转换，也没有通过不明坐标底图反推边界。

## 来源快照与处理

| 区域 | 原始行政关系 | 原始 → 输出坐标数 | 分量 / 洞 | 简化容差 |
|---|---|---:|---:|---:|
| 香港特别行政区 | [OSM relation 913110](https://www.openstreetmap.org/relation/913110) | 1,718 → 1,718 | 13 / 22 | 无简化 |
| 浙江省 | [OSM relation 553302](https://www.openstreetmap.org/relation/553302) | 19,066 → 4,534 | 1 / 1 | 0.0006° |
| 杭州市 | [OSM relation 3221112](https://www.openstreetmap.org/relation/3221112) | 25,606 → 3,569 | 1 / 0 | 0.0005° |
| 武汉市 | [OSM relation 3076268](https://www.openstreetmap.org/relation/3076268) | 4,978 → 4,978 | 3 / 3 | 无简化 |

2026-09-08 通过 Nominatim 的 [Search](https://nominatim.org/release-docs/latest/api/Search/) 确认名称、类型和关系 ID，再用 [Lookup](https://nominatim.org/release-docs/latest/api/Lookup/) 的 `polygon_geojson=1&polygon_threshold=0` 获取完整几何。每份都核对了 `boundary=administrative`、关系 ID 和 `admin_level`；没有将同名城市节点或香港岛子区域误作整个香港。香港搜索同时返回另一同范围行政层级记录；本目录明确选择 relation 913110，不合并两个重复区域。

浙江和杭州在本地使用 Shapely `simplify(preserve_topology=True)` 压缩；容差是源坐标单位的角度，不能当作统一米制误差或数据测量精度。所有多边形分量与洞均保留，没有过滤面积较小的分量。外环方向规范为逆时针、内环顺时针，没有额外四舍五入坐标；香港和武汉仅调整环方向及元数据，不简化几何。四份 Feature 合计 369,466 字节。

`provenance.json` 的平面面积相对变化和 Hausdorff 距离只描述对本次原始快照的简化差异，不评价 OSM 与现实的误差。Nominatim 输出不包含 relation 的历史版本号，因此记录下载时间和原始响应 SHA-256，不虚构版本号。

## 渲染时必须保留的含义

1. **行政范围不等于陆地范围。** 香港和浙江源关系包含海域；区域内部仍须由水面/海岸线数据区分海洋和岛屿。不能把整个行政面生成一块陆地，也不能仅保留最大分量或用旧陆地轮廓再次裁掉海滨景点。
2. **洞不能填平。** 香港 22 个洞、浙江 1 个洞、武汉 3 个洞来自来源拓扑。它们不应自动解释为湖泊；其中可能是被排除的行政区域。裁切地形、底面、侧壁和建筑时都应使用相同的完整几何。
3. **城市范围是完整行政市域。** 杭州包括西侧广大市域，西湖位于该范围东部；武汉也不只包含中心城区。`bounds` 适合展示全域，不能以市中心附近小窗口冒充全市。
4. 浙江与杭州分别简化，不能保证二者共享边界逐点相同；若以后拼接成连续地图，需另做共享拓扑处理。本目录用于分别展示区域。

## 验证与复现

数据处理脚本：`work/region-boundaries/prepare-regions.py`；缓存原始响应和下载记录位于同一工作目录。脚本仅读取缓存，不访问网络。

检查原始及输出几何有效性、所有分量/洞数量、闭合环、坐标顺序及有限值、完整 bounds。香港现有十景全部被原始和输出边界包含；杭州两处西湖景点及城市代表点、武汉黄鹤楼及城市代表点均通过。JavaScript 使用应用现有 `containsCoordinate` 验证相同锚点，并验证 26 个内部洞探针被排除。结果保存在 `work/region-boundaries/validation.json` 与 `javascript-validation.json`。这些检查证明当前内容没有被误裁，不等于验证了所有边界点的现实精度。

## 采集范围与服务限制

本次仅四次名称查询加四次关系查询，单线程、单机、请求间隔至少 1.1 秒，使用明确应用 User-Agent，并缓存响应。遵守 [Nominatim 使用政策](https://operations.osmfoundation.org/policies/nominatim/) 的最高每秒一次请求等限制；本应用**不接入公共 Nominatim 作为运行时城市搜索服务**。若以后刷新边界，应明确控制范围和频率，使用缓存，不重复请求相同快照。
