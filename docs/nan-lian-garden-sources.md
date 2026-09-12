# 南莲园池 · 场景依据

本场景以圆满阁、朱红双桥、碧池、松树、置石和深色木构组成原创程序化微缩园林。亭阁、屋瓦、桥栏、树枝和地形均为可编辑几何，没有下载或转售第三方模型。

## 公开参考

- [香港旅游发展局：Chi Lin Nunnery and Nan Lian Garden](https://www.discoverhongkong.com/eng/place-to-go/travel.guide-chi-lin-nunnery-and-nan-lian-garden.html)：钻石山的唐风园林、环池游径、金色圆满阁、红桥与木构环境。
- [香港旅游发展局：4 Zen Spots to Visit in Wong Tai Sin District](https://www.discoverhongkong.com/eng/neighbourhoods/wong-tai-sin/zen-spots-to-visit-in-wong-tai-sin-district.html)：通往金色亭阁的红色木桥、池塘、观赏石与园林植物，作为空间关系和色彩参考。
- [香港康乐及文化事务署：Nan Lian Garden](https://www.lcsd.gov.hk/en/parks/nlg/index.html)：唐代风格、特色木构、奇石与树木的园林构成，以及南莲园池的官方名称与地点。

参考日期：2026-09-08。参考网页、建筑摄影及其版权均归原权利人；本仓库只保留出处链接，不转载参考照片。代码与程序化几何按仓库许可证提供。

## 建模选择与边界

- 金色八角亭、两侧红桥和池水是主要识别关系；亭阁采用双重曲面屋檐，屋面瓦垄、斗拱提示、柱与栏杆均由几何构成。
- 背景厅堂以唐风低檐木构交代园林环境，不等于逐栋复原志莲净苑或南莲园池建筑。
- 环池游径、盆景式松树、池岸石、水景和锦鲤是艺术化园林配景。数量、尺寸、路径及位置均经过压缩和重新构图。
- 模型展示桥梁的构造与连接，不表示游客可按模型路线通行，也不提供实时开放信息。
- 场景没有复原周围全部道路和高层建筑，不用于现场导航、修缮或建筑测绘。
- 本场景的收录不代表官方热门排名或客流统计。

## 实现入口

`src/scenes/nan-lian-garden.js` 导出 `createNanLianGarden()`。静态构件按材质合并；沿用主程序的旋转、缩放、截图与 GLB 导出接口。
