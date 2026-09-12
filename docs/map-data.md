# 地图数据说明

本项目的省级轮廓来自 **Natural Earth 1:10m Admin 1 — States, Provinces**。地图用于旅游探索原型中的省份选择；它是经过简化的地理示意，不是官方标准地图、导航地图或完整的领土边界表达。

## 来源与许可

- [Natural Earth 数据说明](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/)
- [Natural Earth 公共领域许可说明](https://www.naturalearthdata.com/about/terms-of-use/)
- [固定版本的原始 GeoJSON](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_admin_1_states_provinces.geojson)
- [本项目处理记录](../data/data-provenance.json)

Natural Earth 将其矢量数据置于公共领域，允许修改和再分发，包括商业使用。本项目保留来源记录，便于复核和替换数据。地图数据的公共领域属性与项目代码的许可证分别适用。

## 本项目做了什么

1. 提取源文件中的相关省级区域。
2. 将台湾的源子区域合并为一个“台湾”选择入口，将香港的源分区合并为一个“香港”入口，保留澳门几何。
3. 将源数据单列的西沙群岛几何并入海南入口。
4. 使用 Shapely `coverage_simplify` 对共享边界一起简化，容差为源坐标单位中的 `0.03` 度，再保留四位小数。
5. 添加应用稳定 ID、中文短名称和常见省级代码。应用使用字符串 ID 关联城市与景点，不依赖外部代码版本。

结果包含 **34 个可选省级入口**，共 10,820 个坐标，未压缩文件约 209 KB。这一数量描述应用导航的入口数，不表示覆盖了所有岛屿或完整疆域。

## 覆盖范围与已知限制

- Natural Earth 官方说明其默认采用实际控制边界；本项目没有重新裁定或修订源数据中的边界差异。
- 包含大陆省级轮廓、海南、台湾、香港、澳门，以及源文件中存在的部分离岸岛屿；细小岛屿和海岸细节可能缺失或简化。
- 未提供南海诸岛附图，也未提供相应海域界线表达。不要将该示意图作为经过地图审核的完整中国地图复用。
- 没有城市或区县边界。城市选择由内容数据定义；城市标记只用于定位入口。
- 香港、澳门等区域在全国视角下很小；界面应同时提供文字选择入口，不能只依赖点击几何。
- 景点是程序化创作的风格化模型，不是实测或摄影测量成果。

如果要将它作为面向公众的正式地图服务上线，应将底图替换为适合该发布场景、具备明确使用条件的标准地图数据，再核对行政区划、岛屿和边界表达。本仓库保留独立的数据接口，便于替换。

## GeoJSON 接口

```json
{
  "type": "Feature",
  "id": "zhejiang",
  "properties": {
    "id": "zhejiang",
    "name": "浙江",
    "nameEn": "Zhejiang",
    "adcode": "330000",
    "center": [119.97, 29.1084],
    "sourceIds": ["..."]
  },
  "geometry": { "type": "MultiPolygon", "coordinates": [] }
}
```

`center` 是标记或镜头定位参考点，不是严格计算的面积中心。坐标顺序是经度、纬度。

几何同时包含 `Polygon` 和 `MultiPolygon`。每个 polygon 的第一条 ring 是外环，其余是洞；渲染器必须保留洞。推荐遍历方式：

```js
const polygons = geometry.type === 'Polygon'
  ? [geometry.coordinates]
  : geometry.coordinates;

for (const [outer, ...holes] of polygons) {
  // outer -> THREE.Shape
  // holes -> THREE.Path entries on shape.holes
}
```

第一版内容使用 `zhejiang → hangzhou` 和 `hubei → wuhan`。其他省份可以选择，但尚无景点内容的省份应清楚显示待收录状态。
