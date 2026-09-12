# 香港热门十景：如何选出

查阅日期：2026-09-08。

这是结合旅游平台人气列表与官方目的地资料形成的十处景观选集，**不是官方游客量 Top 10，也不是按同一口径计算的实时排名**。平台榜单会变化，受评论、评分、页面访问等因素影响；本项目不展示未经验证的游客量、票价或开放时间。

## 筛选依据

- [Tripadvisor · Hong Kong attractions](https://www.tripadvisor.com/Attractions-g294217-Activities-Hong_Kong.html)：列表包含太平山顶、迪士尼、大佛、天星小轮、海洋公园、南莲园池、昂坪 360、香港天际线、维港及大屿山等。
- [Trip.com · Hong Kong best things to do](https://www.trip.com/toplist/tripbest/recommend/hong-kong/best-things-to-do/111000000038/)：补充香港故宫文化博物馆、中环摩天轮等热门目的地。
- [香港旅游发展局 · Iconic things to do](https://www.discoverhongkong.com/eng/attractions/iconic-things-to-do-when-you-visit-hong-kong.html)：核对香港代表性体验与景观内容。

合并“香港天际线／维多利亚港”与“山顶缆车／太平山顶”等重复方向；大屿山以大佛、昂坪两处具体场景呈现。最后选出兼具游客认知与不同空间特征的十景，顺序是浏览顺序。

| 景点 | 沙盘重点 | 建模参考与边界 |
| --- | --- | --- |
| 维多利亚港 | 两岸天际线、山脊、水面 | [资料](./victoria-harbour-sources.md) |
| 太平山顶 | 凌霄阁、坡道、远处海港 | [资料](./victoria-peak-sources.md) |
| 香港迪士尼 | 奇妙梦想城堡、尖塔、护城河 | [资料](./hong-kong-disneyland-sources.md) |
| 香港海洋公园 | 山地游乐设施与海岸 | [资料](./ocean-park-sources.md) |
| 天坛大佛 | 坐像、莲台、石阶与山林 | [资料](./tian-tan-buddha-sources.md) |
| 昂坪 360 | 山谷、缆线与移动吊舱 | [资料](./ngong-ping-sources.md) |
| 天星小轮 | 独立的近景船体与码头 | [资料](./star-ferry-sources.md) |
| 南莲园池 | 金阁、红桥、园林池水 | [资料](./nan-lian-garden-sources.md) |
| 香港故宫文化博物馆 | 金色斜立面、广场、滨海步道 | [资料](./hong-kong-palace-museum-sources.md) |
| 中环摩天轮 | 轮辐、直立吊舱、中环海滨 | [资料](./observation-wheel-sources.md) |

十处均为可旋转的真实网格场景，可单独导出 GLB。坐标是景点附近定位提示；空间比例和周边布局经过艺术化压缩。香港总览只展示当前分组的模型（宽屏每组四处、窄屏每组两处），左侧列表始终保留十个入口。代码运行不需要 Astra API、地图密钥或登录。
