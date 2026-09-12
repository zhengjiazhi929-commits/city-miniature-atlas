# 天坛大佛 · 场景依据

本场景是原创程序化微缩作品，模型、面部细节、手势、袈裟褶皱、莲台与山地均由代码生成。没有使用照片贴面、第三方人物模型或下载的建筑模型。

## 公开参考

- [香港旅游发展局：The Big Buddha](https://www.discoverhongkong.com/eng/place-to-go/travel.guide-the-big-buddha.html)：大屿山昂坪的青铜坐佛、莲花基座、长石阶及山林环境；页面公开照片用于观察坐姿、右掌抬起及左手置于腿上的轮廓。
- [香港旅游发展局：Po Lin Monastery](https://www.discoverhongkong.com/eng/place-to-go/travel.guide-po-lin-monastery.html)：宝莲禅寺的寺院建筑与昂坪文化背景，用于场景中的寺院环境提示。
- [香港民政事务总署：Po Lin Monastery and The Big Buddha](https://www.gohk.gov.hk/en/spots/spot_detail.php?spot=Po+Lin+Monastery+and+The+Big+Buddha)：大佛、木鱼峰与宝莲禅寺的环境关系。

参考日期：2026-09-08。参考页面和摄影作品的权利属于原作者；本仓库仅提供链接，没有转载其照片。代码与程序化几何按仓库许可证提供。

## 建模选择与边界

- 以青铜坐佛、右掌、合拢的眼睑、长耳、螺发、盘腿、袈裟及莲台构成主要识别特征。
- 头部、鼻、眉、眼睑、嘴唇、耳廓和手指均为实体几何；这是一件风格化雕塑研究，不是实物三维扫描。
- 圆形基座、石阶、森林丘陵与小型寺院建筑经过组合；寺院门楼、道路与山林的位置不是实地测绘布局。
- 实地阶数、树木数量、坡度、建筑与人物比例均未逐一复制。台阶数量用于表现登坛过程，不对应官方实地阶数。
- 场景不提供礼佛路线、开放时间或无障碍导航信息。
- 本场景的收录不代表官方热门排名或客流统计。

## 实现入口

`src/scenes/tian-tan-buddha.js` 导出 `createTianTanBuddha()`。静态几何按材质合并；模型可以沿用主程序的旋转、缩放、截图与 GLB 导出。
