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
- 用户独立推广位（京东官方与喵有券转链都适用，`platforms/jd/positions.ts`）：在京东联盟后台「推广管理 → 推广位」建好推广位后，把推广位 ID 填进京东联盟配置的「推广位池」（`positionPool`，数字，每行一个，不能包含默认推广位）。用户首次转京东链接时固定绑定第一个空闲推广位，之后转链都传该 `positionId`；订单行的 `positionId` 对应到绑定用户，且该用户有过成功转链时按联盟标识关联（TRACKING），不需要 subUnionId 权限。绑定保存在 `system_configs`（`jd-position:<推广位>`、`jd-position-user:<用户>` 成对写入，主键唯一防并发重复），不回收；已绑定的推广位不能从池里移除。池子用完时用默认推广位并在转链结果提示，订单按商品匹配。后台显示每个推广位绑定的用户（`GET /api/v1/integrations/jd/positions`）。优先级：subUnionId → 推广位 → 已有归属 → 按商品匹配。
- 网络：喵有券按调用方公网出口 IP 白名单校验，未加白名单返回错误码 401。设置了 `PROXY_HOST` 时，喵有券请求（京东、淘宝都是）经该代理发出，白名单填代理节点的出口 IP。家用 NAS 没有固定公网 IP 时，在 mihomo 中把 `ecapi.cn` 分流到固定出口 IP 的节点（如 `DOMAIN-SUFFIX,ecapi.cn,固定IP节点`）；若规则走 DIRECT，出口仍是家庭宽带 IP，白名单仍会失效。401 报错会提示当前是直连还是经代理。经代理请求失败时自动直连重试一次。后台头像菜单「出口 IP 查询」（`GET /system/egress-ip`）可查看直连与经代理的出口 IP；经代理结果取决于 IP 查询服务（ipw.cn 等）的分流，与 ecapi.cn 同节点时才等于喵有券看到的 IP。
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

### 数据源（明确选择，不隐式切换）

后台「渠道配置 → 淘宝联盟」的「订单数据源」三选一；与转链数据源（「淘宝联盟 · 喵有券」开关）分开配置：

| 数据源 | 接口 | 前提 |
|---|---|---|
| 官方账号授权 | [taobao.tbk.sc.order.details.get](https://developer.alibaba.com/docs/api.htm?apiId=43755) | 应用具备该接口权限 + 淘宝账号授权（session） |
| 官方推广者 | taobao.tbk.order.details.get | 应用具备该接口权限 |
| 喵有券 | [tbkOrderDetailsGet](https://www.ecapi.cn/index/index/openapi/id/83.shtml?ptype=1) | 「淘宝联盟 · 喵有券」的 apkey 与授权淘宝用户名（付费会员接口） |

- 查询的是联盟推广订单，不是个人购物订单。三者返回同一套字段，由 `orders.ts` 统一转换；订单唯一键为 平台 + 推广账号（`taobao-primary`）+ `trade_parent_id` + `trade_id`，与数据源无关，切换数据源不会重复入库或重复返利。
- 旧配置没有保存数据源时按一次性规则推断（配置了喵有券授权账号为喵有券，否则为官方推广者），运行中不再「官方失败后改用喵有券」。

### 官方账号授权（OAuth）

依据淘宝开放平台[用户授权介绍](https://developer.alibaba.com/docs/doc.htm?treeId=49&articleId=102635&docType=1)、[taobao.top.auth.token.create](https://developer.alibaba.com/docs/api.htm?apiId=25388)、[taobao.top.auth.token.refresh](https://jaq-doc.alibaba.com/docs/api.htm?scopeId=381&apiId=25387)。代码：`apps/server/src/platforms/taobao/oauth.ts`。

1. 超管点「授权淘宝账号」→ `POST /integrations/taobao/oauth/start` 生成 24 字节随机 state（库里只存 SHA-256，10 分钟有效、一次性，绑定发起的管理员与当前 AppKey），返回 `https://oauth.taobao.com/authorize?response_type=code&client_id=AppKey&redirect_uri=回调&state=&view=web`。
2. 用户在淘宝官方页面登录并同意，淘宝跳回 `外部访问地址/api/v1/callbacks/taobao/oauth?code=&state=`。
3. 回调原子取出并删除 state，校验未过期、AppKey 未变更、管理员仍为启用的超管，再用 `taobao.top.auth.token.create`（code 30 分钟内一次性）换取 session；解析 `token_result` 的 access_token、refresh_token、expire_time、refresh_token_valid_time、user_id、user_nick。只有成功才写入，失败不覆盖已有凭证。
4. 凭证用 CONFIG_ENCRYPTION_KEY（AES-256-GCM）加密保存在系统配置 `oauth:taobao`；接口只返回昵称、状态和到期时间，不返回 session / refresh_token；日志与跳转地址不含 code 或凭证。回调只跳回固定的 `/affiliates?taobao_oauth=ok|fail&reason=代码`。
5. 续期：只有服务市场订购类应用支持 `taobao.top.auth.token.refresh`；session 到期前 30 分钟尝试刷新并保存新的 refresh_token；不支持或失败时保留原凭证，到期后提示重新授权。接口返回 26 / 27 等 session 错误时标记「授权已失效」（不删除凭证），重新授权后覆盖。
6. 「解除本系统绑定」只删除本系统保存的凭证，不调用也不声称撤销淘宝侧授权。

回调地址配置：在淘宝开放平台「控制台 → 应用管理 → 应用设置 → 基础信息 → 回调地址」填写与「外部访问地址」同域的地址（官方要求 redirect_uri 与回调地址同域或同一顶级域）。NAS 部署时外部访问地址填浏览器能打开后台的公网域名（经反向代理 / 内网穿透均可，淘宝只做浏览器跳转，不直接访问服务器）；也可用环境变量 `PUBLIC_BASE_URL` 提供默认值。

### 同步

- 历史回补按创建时间（`query_type=1`），最近一小时增量按更新时间（`query_type=4`）；每段 20 分钟（官方日常 3 小时、大促 20 分钟），起点向前重叠 1 分钟，重复数据幂等更新。
- 第 2 页起必须回传上一页的 `position_index`：位点写在同步任务游标里，与该页订单在同一事务提交，进程重启后从游标继续；位点丢失直接报错，不跳页。
- 响应缺少 `data`、列表结构异常、提示有下一页却无位点时报错，不当作零订单推进进度。
- 错误分类：授权失效（26/27/session）标记失效且不重试；无接口权限（11/12/-4002）提示申请权限；限流（7/9100）、超时、服务不可用（3001、isp.*）退避重试 2 次（1s、3s），仍失败则任务失败并保留已导入数据。
- 映射：状态 12 已付款、13 已失效、14 确认收货、3 已结算；佣金 13 记 0、3 取 `pub_share_fee`、其余取 `pub_share_pre_fee`；「付款金额」按计佣金额口径：未结算取 `alipay_total_price`、结算后取 `pay_price`（与 `total_commission_fee` 的计算口径一致）；下单时间 `tk_create_time`，佣金结算时间 `tk_earning_time`。接口没有确认收货时间字段，「完成时间」显示「未获取」，不与结算时间混用。
- 用户专属推广位（`perUserAdzone`，默认开启，`platforms/taobao/adzones.ts`）：用户首次转淘宝链接时固定绑定一个推广位，推广位 ID 保存为该用户的淘宝标识（`user_tracking_codes`，旧版随机标识会被替换），之后都用该推广位的 PID 转链；订单的 `adzone_id` 作为 trackingCode，按联盟标识精确关联用户（TRACKING）。绑定后不回收，旧链接多久以后下单都能对上。推广位来源依次为：
  1. 推广位池（`adzonePool`）：管理员在淘宝联盟后台建好推广位后填入，每行一个 PID，必须与默认 PID 同一联盟账号（网站可不同），不能包含默认推广位；取第一个未绑定的。已绑定用户的推广位不能从池里移除。后台显示每个推广位绑定的用户（`GET /api/v1/integrations/taobao/adzones`）。
  2. 池子用完且开启喵有券淘宝接入时，通过喵有券 `taoke/adzoneCreate`（付费会员接口，参数 apkey、tbname、site_id、adzone_name，返回 `data.model` 为新 PID）在默认 PID 的网站下创建「拾惠用户-xxxx」；返回其他账号或网站的 PID 时拒绝。
  3. 都不行时本次使用默认推广位，并在转链结果提示原因；默认推广位不属于任何用户，订单按商品规则匹配。
  分配在进程内串行，并由 `(accountId, code)` 唯一约束兜底，同一推广位不会给两个人。推广短链缓存按 PID 区分。淘宝联盟单账号推广位数量有上限（以联盟后台为准）。
- 用户归属：授权账号是推广者账号，不是下单用户；用默认推广位转链的订单没有用户标识。「按商品自动关联下单用户」开关（默认开启，`autoMatch`）开启时按商品匹配（`attribution-taobao.ts`）：
  - 统计候选用户时放宽：下单前 7 天至下单后 10 分钟内的成功转链，商品 ID 相同、完整标题相同、标题互相包含（≥10 字），或转链记录没有商品信息（无法排除）的，都计为可能转过该商品的用户；
  - 自动关联时收紧：候选用户只有一人，且此人有商品 ID 或完整标题完全一致的记录；否则不关联，进入「未关联用户」人工关联。
  - 订单记录归属方式 `attribution`：TRACKING 联盟标识 / PRODUCT 按商品匹配 / SIBLING 同订单其他行 / MANUAL 人工关联；后台用户列标注，按商品匹配的订单通知会提醒用户核对。新关联上用户的订单即使状态未变也补发一次通知。
  - 无法识别：他人用转链用户分享出去的链接下单；需接入渠道 ID 才能根治。同步订单不会增加可提现余额。
- 后台：订单管理「京东订单」「淘宝订单」子菜单（`/orders/jd`、`/orders/taobao`）；淘宝联盟配置弹窗可「测试订单查询」（`POST /integrations/taobao/orders/test`，查最近 20 分钟第一页，不入库）与「同步历史订单」。

## 验证

单元测试验证插件注册、链接白名单、空响应、签名请求、分页和长订单号。隔离数据库测试验证重复任务互斥、跨窗口游标、任务完成、过期任务领取及失败状态；测试数据不会写入正式库。
