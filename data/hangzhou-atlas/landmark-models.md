# 杭州景点实体代表模型

2026-09-09。文件：`src/hangzhou-landmarks.js`。这是全市旅游沙盘的独立景点符号库，**示意模型，非测量复原**。真实坐标、边界、河湖与地形由 `scene-data.json` 和主场景负责；本模块不创建地图、虚构湖岸或山峰。

## 接口与资源所有权

```js
import {
  createHangzhouLandmark,
  disposeHangzhouLandmark,
  HANGZHOU_LANDMARK_TYPES,
} from './hangzhou-landmarks.js';

const group = createHangzhouLandmark({ id: 'faxi', type: 'temple', name: '法喜寺' });
group.position.set(x, terrainY, z);
group.scale.setScalar(symbolScale);
scene.add(group);
// 离开城市时：
disposeHangzhouLandmark(group);
```

- 直接导入 `three`，兼容现有网页 import map；不需要额外资源或纹理请求。
- 返回 `THREE.Group`，局部基底 `minY=0`、水平包围盒居中、最大 X/Z 尺寸为 1；高度按类别设为 0.40–1.50。垂直比例是视觉表达，不能换算为实物高度。
- 支持模型类型优先匹配，再检查 `id` / 中文名称 / 类型别名；可直接传当前数据中的 20 个 `landmarks` 对象。未知目标返回 `generic` 且 `userData.recognized=false`，不能把该兜底当作实景。
- `userData` 包含 `modelType`、`triangles`、`drawCalls`、`normalizedSize`、`representative`、`accuracy` 和部分结构语义（如 `stoneLanterns:3`）。
- 每次调用独立拥有几何和材质；同个模型内部按材质合并实体几何。无全局缓存、动画循环、贴图、事件监听器或后台请求。可使用上方释放函数，也可由主场景统一遍历释放；不要同时重复管理同一资源。
- 主场景负责地理锚点、统一缩放、必要的防遮挡处理、标签和引导线。局部 +X 向东、-Z 向北；三潭印月三石塔在岛南面；小河直街已按原始 OSM 街道端点的西北—东南走向旋转约 45°。其它院落内部布置只表达形制，不声称测绘方位。
- 园林岛和石灯塔共用一个**景区代表点**，不代表三塔精确中心或真实间距。放大该符号不能改变湖泊 GIS 几何。不要同时添加 `santan` 与其 `westlake` 别名，避免同一景观重复。

## 模型清单与辨识规则

| 模型类型 | 实体表达 | 三角面 | 材质批次 |
| --- | --- | ---: | ---: |
| `leifeng` | 五层八角塔、宽挑檐、塔基；不是六和塔 | 3108 | 8 |
| `liuhe` | 十三重深色外檐、八角外观；内部七层仅记为语义 | 4420 | 8 |
| `santan` | 低园林岛、内塘开口、桥与亭；岛南恰好三座低石灯塔 | 1508 | 11 |
| `faxi` | 黄墙灰瓦、三级错落院落、可见连阶；无大塔 | 1252 | 8 |
| `xiaohe` | 连续双层店宅、灰瓦坡屋顶、石板街、河埠台阶；不是寺庙或小河公园 | 1476 | 11 |
| `lingyin` | 较大的双檐正殿、前庭、侧廊、古树，与法喜的阶梯院落分开 | 1196 | 8 |
| `liangzhu` | 草坡台地、露出的遗址线索；没有臆造完整宫殿 | 316 | 5 |
| `gongchen` | 实体三孔拱桥，桥洞贯通，带立体栏杆 | 1484 | 2 |
| `qiandao` | 亭、林与小码头代表符号；不绘制假湖或假岛形状 | 364 | 9 |
| `tianmu` | 高树群与简化入口寺院；山体完全交给真实 DEM | 640 | 9 |
| `yaolin` | 可见洞口开口、岩石拱、低面数钟乳石 | 1016 | 7 |
| `yanziling` | 临江石台、亭与台阶；不自行添加江面 | 372 | 8 |
| `longmen` | 白墙灰瓦古村与较大宗祠 | 1164 | 11 |
| `xinye` | 白墙灰瓦民居群，建筑数量经过简化 | 1056 | 10 |
| `olympic` | 中空体育场碗体、24 片代表性实体莲花瓣；瓣数为简化参数 | 944 | 6 |
| `qianjiang` | 现代高低楼群与国际会议中心金色球体 | 904 | 8 |
| `xixi` | 立体木栈道、林丛与小屋；真实湿地形状由 GIS 提供 | 688 | 8 |
| `duanqiao` | 低矮单拱石桥与树木，支持 `broken-bridge` 别名 | 1564 | 4 |
| `xianghu` | 临湖小亭与步道，不生成椭圆湖泊 | 412 | 9 |
| `hefang` | 双层传统街屋群，简化商业街符号 | 1056 | 10 |

20 个数据景点合计 **24,940 三角面 / 160 材质批次**。若将 `westlake` 别名和 `generic` 也各生成一次，22 个导出类型总计 26,588 三角面，低于 10 万预算。材质为非高反光 `MeshStandardMaterial`，颜色和基本光照分开管理。

## 来源与简化界限

这些资料约束身份、显著轮廓和相互区别；程序中的建筑数量、层间距离、院落尺寸、屋顶曲线、树冠及装饰均为独立制作的微缩表达，未提取第三方模型或贴图。

- 四处重点身份和真实 WGS84 锚点的原始核实材料：`work/hangzhou-concept-v3/supports/missing-landmarks/`。包含原始 OSM 法喜寺区域与小河直街线要素、官方资料链接及位置说明。
- 雷峰塔：项目已核实的 [OSM 建筑要素](https://www.openstreetmap.org/way/229726934) 与既有 `data/scenes/leifeng` 资料。当前五层八角形制与三潭低石塔明确分开。
- 三潭印月：[杭州市官方景点介绍](https://www.ehangzhou.gov.cn/2018-06/14/c_242883.htm)、[文旅局资料](https://wgly.hangzhou.gov.cn/art/2023/8/23/art_1229733751_58948820.html)。园林岛与水中三塔不是同一几何对象；三座石塔不放到岛上。
- 法喜寺：[杭州市文旅局上天竺寺身份介绍](https://wgly.hangzhou.gov.cn/art/2021/9/14/art_1229495371_58938316.html)、[官方院落与古树报道](https://www.ehangzhou.gov.cn/2023-03/17/c_284025.htm)、[OSM 原始寺院区域](https://www.openstreetmap.org/way/1104396360)。不能混同法净寺、法镜寺或灵隐寺。
- 小河直街：[拱墅区政府历史街区介绍](https://www.gongshu.gov.cn/art/2024/4/30/art_1229789753_59080393.html)、[政府托管遗产资料中的粉墙黛瓦与下店上宅](https://zjjcmspublic.oss-cn-hangzhou-zwynet-d01-a.internet.cloud.zj.gov.cn/jcms_files/jcms1/web3794/site/attach/0/b6b892c924a3469a851eb42e21654697.pdf)、[OSM 原始步行街](https://www.openstreetmap.org/way/234289068)。用简化街屋，不能借用寺院造型。
- 六和塔：[杭州市文旅局介绍](https://wgly.hangzhou.gov.cn/art/2013/7/7/art_1229495371_58931730.html) 明确外观十三层、内部七层。模型展示十三重外檐，不声称十三个可进入楼层。
- 良渚：[UNESCO 城址区资料与地图](https://whc.unesco.org/en/list/1592/maps/)。以遗址台地表达，不复原不存在测绘依据的宫殿群。
- 灵隐：[杭州官方介绍](https://www.ehangzhou.gov.cn/2018-06/14/c_242885.htm)；拱宸桥：[官方资料](https://www.ehangzhou.gov.cn/2025-08/07/c_294577.htm)；奥体：[官方场馆介绍](https://www.ehangzhou.gov.cn/2018-08/03/c_274673.htm)；钱江新城金球：[官方旅游线路](https://www.ehangzhou.gov.cn/2023-09/01/c_286642.htm)。
- 严子陵钓台：[官方旅游介绍](https://www.ehangzhou.gov.cn/2021-03/18/c_276566.htm)；瑶琳：[官方桐庐旅游资料](https://www.ehangzhou.gov.cn/2020-04/15/c_269775.htm)。其它具名符号的地理身份与原始要素链接保存在 `scene-data.json` 对应景点中；通用形体不等于景区建筑测绘成果。

地理数据归属 © OpenStreetMap contributors（ODbL）；UNESCO 和政府资料分别归属其发布者。本模块不声称官方认证或测量精度。

## 已执行验证

- 使用仓库自带 Three.js，对全部类型实例化并检查顶点和法线有限值、基底、水平尺寸、关键层数/石塔数量、三角面预算及释放过程。
- 将 `scene-data.json` 的 20 个景点逐项传入接口，均能识别到模型类型，不依赖兜底。
- 独立 Chrome / WebGL 联系表渲染检查实际实体轮廓；依据预览修改了小河直街双层立面、法喜可见连接阶梯、贯通拱洞等问题。该检查不替代主场景中的地理定位、镜头遮挡和最终用户验收。
