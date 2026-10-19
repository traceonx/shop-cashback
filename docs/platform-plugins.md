# 电商平台插件

平台实现位于 `apps/server/src/platforms/<平台>/`，统一契约在 `types.ts`，注册表在 `registry.ts`。目前注册京东和淘宝；拼多多没有伪实现。

每个插件声明平台名称、配置字段及密钥属性、认证方式、官方文档、历史查询范围和单次时间窗口，并实现配置可用性判断、商品链接校验、转链、订单权限测试和分页订单查询。平台调用返回统一的商品快照或订单行，原始响应同时保留用于核对。签名、请求参数、分页和响应规范化均由插件负责。

共享服务负责凭证加密保存、权限校验、任务调度、订单去重入库、审计和返现账务。订单插件不直接修改余额。新增平台需实现契约、加入注册表并增加后台入口；不得复用京东签名规则或假设不同平台的状态、佣金及订单权限相同。API `GET /api/v1/platforms` 返回已注册插件的公开元信息。

## 京东依据与认证范围

- [京东联盟订单行查询](https://union.jd.com/openplatform/api/12707)
- [京东官方联盟接入说明](https://jos.jd.com/jdunion)

当前京东插件使用联盟应用 AppKey / AppSecret 签名调用官方接口。官网登录入口仅打开京东联盟，不读取浏览器 Cookie，也不冒充完成 OAuth 授权。官方订单接口用于推广订单，历史范围为最近 90 天，不代表能读取个人购物账号的全部购买订单。当前未确认此应用的一键 OAuth 授权能力；如扩展授权模式，需依据该业务官方文档独立实现授权回调、state 校验、令牌加密与刷新。

已使用用户保存的应用凭证只读验证：订单接口成功，最近一小时无更新。缺少网站 / APP ID 不阻止查询订单；站点 ID 仅在转链时检查。没有 data 的成功响应按空订单处理，非数组响应或相互矛盾的分页信息仍报错。

## 京东第三方接入（喵有券）

个人京东联盟账号调用官方 `goods.query`（商品与优惠查询）需要企业认证，因此另接第三方服务商[喵有券](https://www.ecapi.cn)（ecapi.cn）补齐查券能力。它与「京东联盟（官方）」是两条独立接入，官方接入的配置、转链和订单同步保持不变。

- 代码：`apps/server/src/platforms/jd/ecapi.ts`；配置加密保存在系统配置 `integration:jd-ecapi`，不占用联盟账号。后台「联盟配置」中显示为「京东联盟 · 喵有券」，带「第三方」标签。
- 字段：启用开关、喵有券 apkey、key_id（喵有券「京东授权列表」中的调用 Key）、推广位 ID（可选，不填时喵有券自动生成专用推广位）。
- 开关：启用且 apkey、key_id 齐全时，京东链接改走喵有券；关闭时继续用官方 `promotion.common.get` 转链。喵有券失败直接报错，不自动退回官方，避免两条链路混用。
- 流程：[商品查询 getJdUnionItems](https://www.ecapi.cn/index/index/openapi/id/51.shtml?ptype=2)（`sceneId=2`，可直接传 3.cn 短链）→ 选券 → [转链 doItemCpsUrl](https://www.ecapi.cn/index/index/openapi/id/56.shtml?ptype=2)。有单件可用的最优券时生成含券链接（materialId 改为商品详情页链接并传 couponUrl），含券失败退回普通链接并提示；无可用券时传 `autoSearch=1`。券门槛全部高于单件售价时按无券计算到手价与佣金。返回的推广链接只接受 u.jd.com、3.cn、union-click.jd.com。
- 订单：喵有券使用你授权给它的京东联盟账号，推广订单归属该账号，由官方 `order.row.query` 同步，所以必须保留官方 AppKey / AppSecret。喵有券订单接口（需授权 key，曾返回 1038）不使用。
- 用户归属：转链时会传 subUnionId，但需在喵有券另行申请（官方要求开通后两个月内日均 500 单），未开通会被忽略，订单继续按「7 天内只有一个用户转过该商品」匹配。
- 网络：喵有券按调用方公网出口 IP 白名单校验，未加白名单返回错误码 401。设置了 `PROXY_HOST` 时，喵有券请求（京东、淘宝都是）经该代理发出，白名单填代理节点的出口 IP。家用 NAS 没有固定公网 IP 时，在 mihomo 中把 `ecapi.cn` 分流到固定出口 IP 的节点（如 `DOMAIN-SUFFIX,ecapi.cn,固定IP节点`）；若规则走 DIRECT，出口仍是家庭宽带 IP，白名单仍会失效。401 报错会提示当前是直连还是经代理。
- 测试：「测试接口」用关键词查询一次商品，验证 apkey、key_id 与 IP 白名单。

## 淘宝第三方接入（喵有券 + 官方混合）

淘宝联盟商品 ID 升级后，官方接口只接受新版联盟商品 ID（字母数字混合）。分享链接里只有旧的数字 ID，而本应用没有万能转链、万能解析（错误码 11）和消费者比价场景（错误码 1911），无法换成新版 ID；按标题做物料搜索又常有多家店铺卖同名商品，无法确定原商品，只能拒绝转链。因此另接喵有券补齐「数字 ID → 新版 ID」这一步，其余仍用官方接口。

- 代码：`apps/server/src/platforms/taobao/ecapi.ts`；配置加密保存在系统配置 `integration:taobao-ecapi`。后台「联盟配置」中显示为「淘宝联盟 · 喵有券」，带「第三方」标签。
- 字段：启用开关、喵有券 apkey（可与京东共用）、喵有券「账号授权」中已授权的淘宝用户名 tbname。推广位使用淘宝联盟（官方）配置的 PID；不传 relation_id，喵有券后台不要设置默认渠道 ID。
- 流程（已用暴龙眼镜框、FILA 跑鞋实测跑通）：
  1. 喵有券[万能转链 doTbHighCommissionPromotionUrl](https://www.ecapi.cn/index/index/openapi/id/330.shtml?ptype=1)：`material_list` 传原分享文案，取得推广链接和推广淘口令；如返回的 `material_id` 已是新版 ID 则跳过第 2 步。
  2. 喵有券[万能解析 doCommonPromotionUrlParse](https://www.ecapi.cn/index/index/openapi/id/346.shtml?ptype=1)（付费会员接口）：解析上一步的推广淘口令，`link_info_dto.material_id` 为新版联盟商品 ID。
  3. 官方 `taobao.tbk.dg.material.optional.upgrade`：`q=https://uland.taobao.com/item/edetail?id=新版ID`、`biz_scene_id=1`，只接受 `item_id` 与新版 ID 完全一致的结果，取价格、优惠、预计佣金与官方推广链接，再用官方 `tbk.tpwd.create` 生成淘口令。
- 次数：每个新商品 2 次喵有券 + 1 次官方；新版 ID 在进程内缓存 24 小时（最多 2000 条）。缓存键只用链接跳转中取得的数字 ID；短链落地页 HTML 里搜出的 ID 不可靠（可能是统计脚本等其他 ID，曾导致不同链接返回同一商品），此时按分享短链本身缓存。缓存的 ID 查不到时自动重新走喵有券。
- 短链：物料搜索给的是很长的 coupon_share_url / click_url，转链后先用官方 `taobao.tbk.spread.get` 转成 `s.click.taobao.com` 短链（官方淘宝接入的物料搜索转链同样处理）；未开通或失败时用第 1 步喵有券返回的推广短链（同一 PID，随新版 ID 一起缓存），都拿不到才保留长链。淘口令用最终链接生成。
- 兜底：官方未命中时使用喵有券返回的推广链接与淘口令，提示「未取到官方价格与佣金」，不计算预计返现，避免混用两套佣金口径（实测同一商品喵有券佣金带多件条件，与官方单品预计佣金不同）。
- 开关：启用且 apkey、tbname 齐全时淘宝链接走混合流程（仍需官方 AppKey / AppSecret / PID）；关闭时沿用官方标题搜索转链。混合流程失败直接报错，不自动退回官方。
- 网络：喵有券按公网出口 IP 白名单校验（401），代理设置同京东（`PROXY_HOST`，见上一节）；淘宝官方接口仍直连。「测试接口」调用 getTbAuthList，确认 tbname 已授权并显示到期时间。
- 未验证：淘宝订单同步、用户自动归属与最终返利结算。

## 历史订单同步

后台可选择最近一小时更新、一天、七天、三十天、九十天订单。除一小时选项按更新时间查询外，历史回补按下单时间查询。每个窗口不超过一小时，按官方分页结果继续获取；不按本系统的推广位筛选，但可见范围仍由京东账号和接口权限决定。

任务及分页游标持久保存于 PostgreSQL。每两秒处理一页，通过条件更新领取任务；进程中断后超过两分钟可重新领取。导入和游标推进在同一事务内提交。重复订单按平台、账号、订单号、订单行号更新。失败显示错误并保留已经导入的记录，可重新选择范围同步。九十天至少有 2160 个时间窗口，需要较长时间，可离开页面等待。

京东插件将 validCode 3 / 15 / 16 / 17 分别映射为已取消 / 待付款 / 已付款 / 已完成，其他未映射状态保留待核实。交易状态与返现用户归属分开。计佣基数不能当作订单原价或实付金额，不能凭插件响应自动给用户入账。

## 淘宝订单同步

- 代码：`apps/server/src/platforms/taobao/orders.ts`。官方 `taobao.tbk.order.details.get`：最近一小时用 `query_type=4`（更新时间），历史回补用 `query_type=1`（创建时间）；单窗口 3 小时；第 2 页起回传上一页的 `position_index`（按窗口暂存在内存，进程重启后不带位点继续）；`order_scene=1` 常规订单。
- 官方返回错误码 11（未开通订单权限）时，1 小时内直接改用喵有券 [tbkOrderDetailsGet](https://www.ecapi.cn/index/index/openapi/id/83.shtml?ptype=1)（付费会员接口，字段与官方一致，需「淘宝联盟 · 喵有券」的 apkey 与 tbname，开关可不开；淘宝授权 30 天有效）。
- 映射：订单号 `trade_parent_id`，订单行 `trade_id`（TOP 响应按原文解析，超过 2^53 的整数保留为字符串）；状态 12 已付款、13 已失效、14 确认收货、3 已结算；佣金 13 记 0、3 取 `pub_share_fee`、其余取 `pub_share_pre_fee`；付款金额 `alipay_total_price`；下单时间 `tk_create_time`（北京时间），结算时间 `tk_earning_time`。
- 用户归属：尚未接入渠道 ID（relation_id）/ 会员运营 ID（special_id），订单没有可靠的用户标识；淘宝转链记录也不存商品 ID，按商品兜底不会命中。订单全部进入「未关联用户」，在后台手动关联，不推送订单通知。接入渠道备案后改按 relation_id 归属。
- 后台：订单管理拆为「京东订单」「淘宝订单」子菜单（`/orders/jd`、`/orders/taobao`），`GET /orders?platform=`、`GET /orders/sync-status?platform=`、`POST /orders/sync {platform, hours}` 按平台；不传 platform 时同步所有已配置的联盟。

## 验证

单元测试验证插件注册、链接白名单、空响应、签名请求、分页和长订单号。隔离数据库测试验证重复任务互斥、跨窗口游标、任务完成、过期任务领取及失败状态；测试数据不会写入正式库。
