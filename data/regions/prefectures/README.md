# 按需加载的行政区域补充数据

此目录来自 **geoBoundaries gbHumanitarian / HDX, China ADM2** 的一次批量下载，源数据表示年份为 **2020**，固定 Git 提交为 `9469f09`。原始 GeoJSON 为 4,466,023 字节，SHA-256 记录于 `provenance.json`。这里没有使用公共 Nominatim 批量查询，也不依赖运行时地理编码服务。

## 内容与限制

原始数据共有 361 个面，包含地级区域、直辖市、部分省直辖单位，以及台湾、香港、澳门三个省级特例；不能把“ADM2”笼统等同为每条都是同一种行政等级。三个省级特例保留来源分片，但设置 `citySelectable=false`，不参与普通城市匹配。其余 358 条仅作为有明确匹配时的候选。香港、浙江、杭州、武汉继续优先使用上级目录已独立核验的 OSM 数据。

每个 `.geojson` 是一个 Feature，文件名为 `bulk-{shapeID}.geojson`。所有源顶点、多分量与洞均保留，仅调整外环/内环方向和添加应用元数据；没有进一步简化，也没有手绘或补全缺失地形。最大分片有 4,204 个坐标。源本身已经概化，海岸、离岸岛屿和行政变更可能不完整；此数据不是当前测绘成果或完整城镇名录。

源 `shapeName` 只有英文，且 Yichun、Suzhou、Taizhou、Fuzhou、Yulin 等名称重名。应用保留 OSM 城市点的中文名称用于显示，同时用 `nameEn` 匹配来源英文名，再验证该点位于实际行政多边形及所选省内。`City`、`Shi`、`Prefecture`、`Municipality` 末尾词和重音符号会规范化；不会自行猜测中文别名、删除民族名称或把任意乡镇替换成包围它的地级市。没有同名真实面时不提供该地点的独立区域入口。

`index.json` 只缓存名称、ID、范围和文件校验值。UI 在校验候选点时临时读取其本地边界，过滤结束即丢弃几何引用；选中城市后单独加载其文件。深链接保存 `boundaryId` 和 `nameEn`，因此刷新不会按中文标签或包围盒盲猜行政区域。

## 许可与来源

数据遵循 **Creative Commons Attribution 3.0 IGO（CC BY 3.0 IGO）**；与上级目录四份 OSM 数据的 ODbL 许可不同，也不受应用 MIT 许可重新授权。

署名：**geoBoundaries / HDX, China administrative boundaries (2020)**。

- [geoBoundaries 官方数据元信息](https://www.geoboundaries.org/api/current/gbHumanitarian/CHN/ADM2/)
- [固定提交的源 GeoJSON](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbHumanitarian/CHN/ADM2/geoBoundaries-CHN-ADM2.geojson)
- [元信息所列 HDX 来源](https://data.humdata.org/dataset/cod-ab-chn)；本次浏览工具访问该页面返回 403，源许可和年份依据 geoBoundaries 发布的元信息，不声称已再次核对 HDX 页面内容。
- [CC BY 3.0 IGO 许可](https://creativecommons.org/licenses/by/3.0/igo/)：允许再分发及修改，包括商业用途；需署名、链接许可并说明修改，不得暗示来源机构认可本产品。
- [geoBoundaries API 说明](https://www.geoboundaries.org/api.html)

没有采用 gbOpen CHN ADM2：该产品的官方 `boundaryCanonical` 为 County Level，2391 条县级单位，与本次需要的城市范围不符。

## 检查记录

`work/region-boundaries/prepare-prefectures.py` 仅从缓存原始 GeoJSON 分片，不访问网络。361 个原始及输出几何有效，所有分量和洞保持，最大分片小于读取上限。记录于 `work/region-boundaries/prefecture-validation.json`。

`work/region-boundaries/check-region-loader.cjs` 在实际 Chrome 中检查四个 OSM 覆盖、其他省的 Natural Earth 轮廓、宁波、台州/泰州重名区分、乡镇拒绝、深链接身份、取消和缓存生命周期。它只读取本站文件，不调用公共地理编码端点。
