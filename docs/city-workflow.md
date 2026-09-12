# 用 Codex 制作下一座城市

这是一套 **Codex 驱动的制作流程**。Codex 阅读任务、查资料、决定模型和返修方案；项目工具负责冻结输入、通用构建、数值检查、有限自动修复和可恢复的状态记录。网站本身不调用大模型，也不需要模型 API 密钥。

仓库技能位于 [build-city](../.agents/skills/build-city/SKILL.md)。用 Codex 打开项目后，可以输入：

> 使用 $build-city 制作我指定城市的沙盘。先核实真实市界、主路、水系和景点，复用当前模型资产；按城市任务流程生成实际网页，检查后返修。保留数据缺口与实际验收结果。

## 已实现与责任边界

| 工作 | 执行方与结果 |
| --- | --- |
| 地理研究与取景方案 | Codex 使用可用的搜索/浏览工具核实资料，写任务 brief；不能用概念图代替地理来源 |
| 资料收集 | `city-sources.mjs` 读取本地 GeoJSON/Overpass JSON，或显式抓取允许的 HTTPS JSON；冻结原始字节、来源、时间与 SHA-256 |
| 通用构建 | `city-build-plan.js` 将当地边界/道路/建筑/公园组织为通用 City Kit 方案，没有杭州坐标或商业中心的硬编码 |
| 检查与自动修复 | 检查来源占地、水路避让、尺寸、重叠与预算；最多 3 轮有界修复，仅调整/剔除不合法显示实例，不改真实边界水路 |
| 实际网页 | `city-plan-viewer.js` 加载真实在线 DEM 和固定模型，用有厚度的道路、水面和地表支撑呈现当前方案 |
| 截图与视觉返修 | `capture` 生成实际截图和运行记录；Codex 看图写意见，修改显示参数或工具代码后再次构建 |
| 任务恢复 | 每个 run 独立保存阶段、输入、版本指纹、报告与修订历史；同一任务加锁，旧截图不能验收新方案 |

普通建筑是来源轮廓内的概括体块，高度可能估算；独特地标仍需 Codex 根据资料另行制作。此流程尚不自动复刻任意寺庙或复杂建筑，也没有独立 LLM 服务、账户、计费和云端任务平台。

## 跑通随包真实样例

需要 Node.js 18.17+（建议与 CI 一样使用 Node.js 22）。下列命令可直接运行，不需要 Python 或地图密钥：

```sh
node scripts/city-workflow.mjs init --id wuhan-demo --brief examples/city-workflow/wuhan.json
node scripts/city-workflow.mjs run --id wuhan-demo
npm start
```

打开 <http://127.0.0.1:4173/examples/city-workflow/?run=wuhan-demo>。

样例保留真实武汉市界，但**建筑、主路、水域与公园资料只覆盖黄鹤楼附近**。拉远可看完整地貌，不能把未采集部分视为空地或宣称完成武汉全市。黄鹤楼定位取自归档 OSM way/81641900 建筑足迹中心。来源、请求与许可见[样例资料说明](../data/city-workflow-samples/NOTICE.md)。

重复 `init` 同一 ID 会拒绝覆盖。继续任务用：

```sh
node scripts/city-workflow.mjs status --id wuhan-demo
node scripts/city-workflow.mjs run --id wuhan-demo
```

已完成阶段在文件哈希一致时复用；修改构建代码、渲染代码或固定资产后会重新构建。若修改来源解析器，需从已归档原始文件建立新 run 重新解析；不可继续使用旧的规范化结果。当前 run 使用已冻结的来源，修改项目原始源文件不会悄悄替换正在使用的快照。需要新来源时建立新 brief/run。修改生成物会触发完整性错误；恢复原文件或新建任务，不要直接改状态来标记完成。

## 任务输入

[wuhan.json](../examples/city-workflow/wuhan.json) 是完整例子。字段如下：

| 字段 | 约定 |
| --- | --- |
| `schema` | `city-task-v1` |
| `city` | 唯一 slug、真实名称、WGS84 经度/纬度代表点 |
| `boundary` | 本地 `data/` 或 `examples/` 的 GeoJSON Feature Polygon/MultiPolygon、可选预期 SHA-256、来源 URL/许可/署名 |
| `sources` | 有来源的 GeoJSON 或 Overpass JSON 列表；每项有 id、kind、path 或 url、source，可带 SHA-256 与 coverage |
| `landmarks` | 唯一 id、名称、真实坐标、sourceUrl、说明；可加明确的 sourceId 关联来源建筑，该建筑不会被普通资产冒充；此字段创建点位 |
| `display` | 视角与显示预算；不能替代来源坐标 |

GeoJSON 要素保留 `building`、`highway`、`natural`、`landuse`、`leisure`、`height`、`building:levels` 等 OSM 标签（可在 properties 或 properties.tags）。Overpass adapter 只使用已返回的明确几何；无法可靠恢复的关系会记录缺口并跳过。主路选择 motorway/trunk/primary/secondary 及其 link；小路保持在原始来源中，但不构建实体路面。

树只从有依据的公园/林地等面内取代表位置，并避让水、道路和建筑；草地可以只显示绿面。普通建筑保持完整显示占地位于来源足迹内，高度与资产类型按来源标签和明确显示规则选择。其精细度和放大策略与杭州已有专用版本不同，不承诺同等观感。

远程 JSON 必须通过显式 `--network` 开启。支持的当前端点为 Overpass interpreter、OSM API JSON 和 GitHub raw JSON；有响应字节、时间与公共地址限制，不跟随重定向。批量研究应控制范围并遵守上游服务规则。其他来源先由 Codex 核实，再作为合法本地输入导入；不要为了通过限制而伪造来源。

```sh
node scripts/city-workflow.mjs run --id my-city --network --max-repairs 2
```

## 检查、修订与实际截图

所有运行文件在 `work/city-runs/<id>/`：

```text
brief.json         冻结的任务配置
state.json         阶段、事件、工具指纹、文件哈希与修复记录
collected.json     规范化要素及来源记录
plan.json          当前 city-build-plan-v1 方案
checks.json        几何错误、估算/覆盖警告与计数
attempts/          每次构建和来源冻结的历史
captures/          实际浏览器截图
capture.json       对应方案的运行诊断与截图哈希
visual-review.json Codex/人工对实际图片的审查
```

`awaiting_visual_review` 表示可以开始看图，不表示用户已接受。`partial` 警告不会被安全修复自动清除。`artifacts/` 保留按内容哈希存储的方案，状态先提交、别名后替换；中断后 `status` / `run` 会完成尚未写完的别名。哈希校验能发现意外改动，但不是对恶意修改者的签名或防伪认证。

若只能删除全部建筑才能通过，仍应报告表示能力不足，不能把空场景称为完成。

例如把显示楼高上限改为 180 米并调整取景，创建一个项目内 JSON 文件：

```json
{"maxHeightMeters":180,"focusDistanceMeters":2800}
```

```sh
node scripts/city-workflow.mjs revise --id wuhan-demo --patch examples/my-display-change.json
node scripts/city-workflow.mjs run --id wuhan-demo
```

可修订 `focus`、`focusDistanceMeters`、`maxFeatures`、`maxBuildings`、`maxRoads`、`maxTrees`、`maxPolygons`、`maxCoordinates`、`maxGeometryCoordinates`、`maxHeightMeters`、`maxSlenderness`、`estimatedBuildingHeightMeters`、`maxBuildingDimensionMeters`、`treeSpacingMeters`。限制见构建器默认值和上限；来源几何不在这个接口中修改。

截图需要可选 Playwright 与 Chrome/Chromium。可在自己的开发环境安装 `playwright` 和对应浏览器；或者设置 `PLAYWRIGHT_MODULE` 为已有模块入口文件的绝对路径（例如 `node_modules/playwright/index.mjs`）、`CHROME_PATH` 为浏览器实际可执行文件的路径。普通网站运行不需要这些依赖。

```sh
node scripts/city-workflow.mjs capture --id wuhan-demo --url http://127.0.0.1:4173/
```

工具验证服务端文件与当前方案一致，等待地形/模型完成，保存默认、全貌与景点视角，并记录退出释放情况。截图不自动判断审美；Codex 必须实际查看生成的图片、跳过原因和检查报告，再写审查文件：

```json
{
  "schema":"city-visual-review-v1",
  "planSha256":"从 state.artifacts[plan.json] 读取",
  "captureSha256":"从 state.artifacts[capture.json] 读取",
  "verdict":"revise",
  "summary":"说明实际看到的问题或达到的任务范围",
  "findings":[{"code":"view-too-wide","severity":"warning","message":"默认视角过远，主要楼群不易辨认"}]
}
```

```sh
node scripts/city-workflow.mjs review --id wuhan-demo --report examples/my-review.json
```

开始一次新截图就会使此前的视觉验收失效；即使新截图在浏览器启动前失败，也需要重新捕获，不能退回旧的成功状态。

`pass` 必须对应当前方案和截图，且机器检查、运行检查没有失败；通过后状态为 `ready_for_delivery`。它表示产物可以按审查记录交付，仍不代表数据覆盖完整或用户最终视觉验收。

## 回归检查与扩展

```sh
npm run check:city-sources
npm run check:city-plan
npm run check:city-workflow
npm run check
```

`collectCitySources`、`buildCityPlan`、`inspectCityPlan`、`repairCityPlan`、`createCityPlanViewer` 是可分别调用的工具接口；工作流串起它们。研究、复杂模型制作和视觉判断由 Codex 执行。发生数据/算法问题时保留失败阶段与原因，不返回假成功。任务只写本地工作目录，不自动 push GitHub、部署网站或调用付费服务。
