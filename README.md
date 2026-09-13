# 山河入掌 · City Miniature Atlas

用真实地理数据制作可交互的城市微缩沙盘。包含杭州示范、可复用的树木与建筑资产，以及新增城市的代码示例。

**[English](docs/README.en.md) · [接入一座城市](docs/add-a-city.md) · [通用模型资产](assets/city-kit/README.md) · [架构与数据](docs/architecture.md)**

![杭州 0.0.2 实际 WebGL 网页截图](docs/media/hangzhou.png)

*实际网页渲染，非生成概念图。地形与水系有来源，普通树楼采用适合远景的代表体量，不是逐栋测绘复原。*

## 本地运行

安装 Node.js 18 或更新版本，然后运行：

```sh
git clone https://github.com/zhengjiazhi929-commits/city-miniature-atlas.git
cd city-miniature-atlas
npm start
```

打开 <http://127.0.0.1:4173/#/city/hangzhou>。运行所需的 Three.js、字体、杭州数据和模型已随仓库提供；**启动不需要 npm install、地图 API key 或付费服务**。桌面浏览器需要支持 WebGL 2。

- 中国与地区入口：<http://127.0.0.1:4173/>
- 杭州完整沙盘：<http://127.0.0.1:4173/#/city/hangzhou>
- 新城市接入示例：<http://127.0.0.1:4173/examples/city-starter/>
- 可旋转的通用资产展示：<http://127.0.0.1:4173/docs/city-kit.html>

杭州的地理与模型可从本地文件加载。其他省市以及城市接入示例仍需联网读取 Mapzen DEM 和 OpenFreeMap 矢量数据；上游覆盖与可用性会影响效果。必须通过 HTTP 服务打开，不要直接双击 HTML 文件。

## 可以直接复用什么

| 内容 | 仓库提供 | 做其他城市时需要补充 |
| --- | --- | --- |
| 城市浏览 | 独立区域裁切、旋转缩放、标记、加载状态、退出释放 | 有来源的城市边界、中心与景点坐标 |
| 基础地图 | 在线 DEM、道路、水系与建筑轮廓的加载和渲染 | 当地数据覆盖核查；必要时替换数据源 |
| 通用资产 | 12 款建筑、树冠/树干、实体路面和桥墩组件，固定几何与 GLB | 根据当地用地、道路与视角组织模型，不复制杭州摆放坐标 |
| 杭州示范 | 主城首屏、完整市域、楼群高低/配色、地标与独立景点 | 当地 DEM、道路、水系、用地、街区及标志建筑资料 |
| 开发入口 | 可运行的城市示例、配置创建脚本、输入校验、接入指南 | 确认地理范围、来源许可和视觉效果 |

**目前不是“输入城市名称就生成同等质量沙盘”的服务。** 城市接入示例展示基础在线地图；新的 Codex 工作流能用当地来源构建通用树楼路方案，但杭州的成体系楼群与精细地标仍包含专用配置。两条路径的接口、数据清单及区别见[接入指南](docs/add-a-city.md)。

## 让 Codex 制作另一座城市

仓库现在提供 **Codex 驱动的城市制作工作流**：资料冻结 → 通用建模 → 几何检查与有限修复 → 实际截图 → Codex 看图返修。任务可恢复，修改方案后旧截图不能继续验收。Codex 负责研究和视觉判断，网站没有内置大模型服务。

建议使用 Node.js 22（工作流至少需要 18.17）。用 Codex 打开仓库并输入“使用 $build-city 制作指定城市”，或先跑随包的真实武汉局部样例：

```sh
node scripts/city-workflow.mjs init --id wuhan-demo --brief examples/city-workflow/wuhan.json
node scripts/city-workflow.mjs run --id wuhan-demo
npm start
```

打开 <http://127.0.0.1:4173/examples/city-workflow/?run=wuhan-demo>。样例只采集黄鹤楼周边，完整市界不代表全市建筑覆盖。通用构建复用 City Kit，保留来源占地、主路和水系；定制地标、当地覆盖补全与最终观感仍需继续制作和验收。

[工作流与命令](docs/city-workflow.md) · [Codex 技能](.agents/skills/build-city/SKILL.md)

## 杭州示范

默认聚焦主城，滚轮拉远查看全市。总览包含 11 处景点与萧山机场；西湖、小河直街、法喜寺、灵隐寺、雷峰塔、龙门古镇、天目山、西溪湿地、千岛湖可打开独立模型。湖滨银泰、奥体中心和机场在总览定位。只保留当前视图资源，切换时释放上一场景。

本次公开代码以 **0.0.2** 为基础：保留已有体量与城市密度，增加街区高度节奏和灰白、银灰、少量灰蓝配色。项目在持续完善，景点模型和普通建筑是概括表达；不同城市尚未达到同等细化程度。

## 项目结构

```text
src/                    页面、地图、景点和可复用资产加载器
assets/city-kit/        固定树楼几何、GLB 与资产说明
data/                   随包地理资料、模型和来源记录
examples/city-starter/  不依赖主应用目录的新城市接入示例
examples/city-workflow/ 通用构建方案的独立预览
.agents/skills/         Codex 可调用的城市制作技能
scripts/                启动、校验、资产和地理数据构建工具
docs/                   接入、架构、地图来源和开发说明
vendor/                 随包运行依赖、字体及其许可
```

## 验证与修改

```sh
npm run check
npm run check:city-assets
npm run check:city-starter
npm run check:city-sources
npm run check:city-plan
npm run check:city-workflow
```

修改固定模型后可运行 `npm run build:city-assets`。这会改变资产哈希，使用这些资产的杭州缓存需要重新生成。地理重建需要对应原始输入和可选 Python/Playwright 依赖，见 [scripts/README.md](scripts/README.md)，不能通过改城市名称复用杭州缓存。

数值检查不能代替实际网页验收。每次检查默认远景、地面接触、道路/建筑关系、景点位置与离开后的资源释放。[当前公开版本检查](docs/QA.md)。

## 贡献与许可

欢迎贡献新的城市数据适配、可追溯的地标模型和资产改进。提交前阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

原创代码与通用模型按 **MIT** 提供。**地图数据不统一属于 MIT**：OSM 派生数据、geoBoundaries/HDX、DEM 和字体分别保留各自条款，详见 [NOTICE.md](NOTICE.md) 和随包来源说明。公开仓库不包含开发对话、个人工作区、未授权再分发的参考照片或机场航图。
