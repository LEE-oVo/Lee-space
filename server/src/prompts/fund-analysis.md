分析我的基金持仓，给出今日操作建议**和具体操作金额**，写入我的工作台网站（只做展示与判断参考）。

{{ROLE}}

> 本提示词由工作台统一提供（`GET /wb-api/funds/prompt`），**任务里不要再存副本**。
> 改了工作台这边，下一次运行立刻同步。

## 我的交易风格：允许并鼓励波段

我不是只买不卖的长线持有者。振荡期我要你**主动做波段**：
哪一次加仓赚到了止盈线，就把那部分卖掉，等回调再买回来，用价差摊低成本。
所以 `reduce` / `sell` 是常规操作，**不需要等「接近目标收益率」**，也不需要看空理由。

止盈线**可以在工作台「基金持仓配置」里改，改完立刻生效**——所以
**一律以 `swingBasis.targetPct` / `triggerPct` 为准，不要在本提示词里找百分比**。

但波段也有两条硬门槛：**卖出只能落在 0 费额度内**，**只卖浮盈达标的那些批次**（见第三步 B）。

## 速度要求（重要）

这个结果我只有 15:00 前不到半小时的操作窗口，**整轮必须在 10 分钟内跑完**。
- **盘中估值不用你拉**：服务端已经定时抓好，第一步的 `holdings[].quote` 直接给你
- **历史净值也不用你拉**：`holdings[].navSeries` 直接给你（近 60 个交易日）
- **技术指标服务端已算好**：`holdings[].technicals`，不要自己拿 navSeries 再心算一遍
- **批次、0 费额度、波段可卖金额服务端都已算好**：`lotList` / `sellPlan` / `swingBasis`
- 板块消息面整个任务最多 1 次搜索
- 拿不到就标 stale 继续往下走，**任何一步都不要重试超过一次**
- 第二步 ④ 的决策流程**只做判断、不取数**，全部用上面已返回的字段

## 额度模型：净投入总额约束，不是每日限额

**唯一硬约束：净投入 ≤ `investment.totalBudget`**（数值只从接口读）。没有每日限额。

额度按**净投入**算（`cashIn − cashOut`），所以：
- **卖出会释放额度**：卖 2000 元，可投额度就多出 2000 元
- 波段是「用自己已有的仓位腾挪」，卖了再买回，净投入基本不变，**不会把额度耗光**
- 我场外还有充足的资金可以补进来，但**总投入上限不变**——不要因为「钱多」就放大下注

分配原则：
- 离目标越远、余额越足 → 确定性高时下手重一点
- 余额见底 → 不要为了「每天投一点」硬凑；但有波段机会时，**先卖再买**是允许的
- 单笔几百到几千都行，只要净投入不超 `totalBudget`
- 超过 `remaining` 的请求会被服务端削减（响应里 `budget.adjusted`），自己先算清楚

**集中度**：`amountRules.maxWeightPct` 是单只上限（数值只从接口读）。
某只已接近或超过时，除非理由很强，否则把钱给占比更低的；本次会超限的必须在 reason 里写明理由。

## 第一步：读取持仓、历史记录、额度与实时估值

用 Bash 执行：
curl -sS -m 25 -H "Authorization: Bearer {{TOKEN}}" {{BASE}}/wb-api/funds/holdings

返回内容：
- `source` 应为 `{{SOURCE}}`；`canSettle` 见下
  {{CAN_SETTLE_NOTE}}
- `holdings` 每只基金的完整上下文（下面逐项说明）
- `positions` 每只基金结算后的真实持仓（份额、成本、市值、浮动盈亏、批次）
- `investment` 额度与目标信息
- `curve` 组合走势（近 20 个交易日）
- `amountRules` 金额规则与集中度上限

### holdings[] 里每只基金的字段

- `cost` / `shares` / `amount` —— **加权**成本价、份额、累计投入。**`cost` 不能用来做任何判断**，见第三步 C
- `recent` —— 我最近 12 次真实操作（date / action / amount / nav / shares）
- `quote` —— **实时盘中估值**，见第二步 ①
- `navSeries` —— 近 60 个交易日真实净值序列（升序）
- `technicals` / `technicalsText` —— 服务端统一算好的技术指标
- `weightPct` / `sharePct` —— 占总投资额 / 占已投入金额的百分比
- `holding` —— 最早批次的持有天数与费率。**只看这一批会误导，判断卖出请用 lotList**
- **`swingBasis`** —— **今天能卖哪一部分（已逐批算好）**：
  `price` / `priceSource`（`estimate`=盘中估值，`nav`=最近净值）/ `targetPct` / `triggerPct` /
  `lots[]` / `qualifiedCount` / `qualifiedShares` / `candidateAmount` / `sellableAmount` /
  `suggestedAmount` / `cappedBy` / `feeFreeAmount` / `note`
  - `lots[]` 每个加仓批次一条：`buyDate` / `unitCost` / `shares` / `gainPct` / `marketValue` / `qualifies`
  - **`qualifies: true` 的批次就是今天可以卖的部分，每批独立判断**
  - `candidateAmount` = 所有达标批次按现价合计
  - **`sellableAmount` = 已和 0 费额度取小后的可卖金额**
  - **`suggestedAmount` = 再砍成整百的金额，直接拿去报 `amount`**
  - `cappedBy`：`candidates`=达标金额是上限 / `feeFree`=0 费额度是上限 / `null`=没有达标批次
- **`lotList`** —— **批次账本（FIFO 顺序）**：`kind`(base/buy) / `buyDate` / `unitCost` /
  `shares` / `costAmount` / `daysHeld` / `feePct` / `feeExempt`
  - `kind: "base"` 是**原始底仓**：我前半年反复投入累积的结果，没有单一买入日，
    `buyDate` 与 `daysHeld` 为 null，**整批卖出 0 费**
  - **`lotList[0]` 只回答「这笔卖出去会消耗哪一批、扣几成费」，不是「该不该卖」的依据**
- **`sellPlan`** —— **0 费卖出额度**：`feeFreeShares` / `feeFreeAmount` / `base` / `segments[]` /
  `note`。`segments[].uptoAmount` 是卖到这个金额时的累计上限，超过就进下一档费率
- `myRecent` —— **你自己**最近 5 天的建议

⚠️ **`recent` 不是全部持仓**：它只记录系统上线后的操作，**原始底仓不在里面**。
016708 的 recent 只有 1 条，但实际持有 2434 份。判断「我拿了多久、还能免费卖多少」，
看 `lotList`，不要看 `recent` 的条数。

**读历史是判断的前提，必须先看**：
- `recent` 每条都是我真实执行过的操作（一天最多一条），代表真实仓位变化
- 最近连续加仓 → 今天更谨慎，避免同一价位过度集中
- 之前建议加仓但我没执行、现在价格更低 → 可以维持或提高金额；价格已涨上来就别重复

**判断连贯性**：`myRecent` 是你自己前几天说过的话。
- 没有重大变化时，不要给出与前一交易日相反的方向
- 确实要反向，必须在 reason 里写清「是什么变了」
- 同一天重复执行本任务时，`myRecent` 里会有今天那条，照常覆盖即可

如果 holdings 为空数组，直接结束任务，只回复一句「持仓为空，跳过」。

## 第二步：获取当日行情

### ① 盘中估值 —— 直接用第一步的 holdings[].quote，不要自己请求行情接口

字段：`nav` / `navDate`（折算基准）/ `estimate` / `estimatePct` / `proxy` / `proxyPct` /
`method` / `beta` / `fresh` / `sessionOpen` / `ageSec` / `note`

处理规则：
- `fresh` 为 true → 可以用 `estimate` / `estimatePct` 判断方向，并原样写进 payload
- `fresh` 为 false（过期，或当前不在交易时段 `sessionOpen=false`）→
  **`estimate` 与 `estimatePct` 必须同时填 null**，`stale` 设 true，改用 `nav` / `navDate` 判断。
  不要自己拼数字、不要用指数现价凑一个

⚠️ **三条必须记住的估值口径**：
1. **`estimate` 只能判断方向，它不是成交价。** 场外基金无论几点下单，成交价都是**当日收盘净值**。
   14:30 到 15:00 之间的波动，你既吃不到也躲不开。
2. **估值误差约 ±0.3%**（服务端实测 44 个样本：平均绝对误差 0.27%，无一条超过 1%）。
   所以 `swingBasis` 的 `triggerPct` 已经预留了这个余量，**直接用 `qualifies` 判断**，
   不要自己再按 2.9%/3.1% 改口。
3. **误差是同向的**：同一天四只基金常常一起偏高或偏低（尾盘大盘方向）。
   「分散到多只」并不能抵消估值误差，组合层面要给这个余量留空间。

**净值时效性**：基金净值当晚约 20:00 才公布，你运行时拿到的最新净值必然是上一交易日的，
`navDate` 早于当天完全正常，不要当成取数失败、也不要重试。

### ② 历史净值与技术指标 —— 直接用 holdings 里的 navSeries / technicals

**不要再去请求任何行情接口拉历史净值**（天天基金的估值接口已下线，push2 各主机也不通）。
服务端已经把净值序列和技术指标算好发给你：

`technicals` 字段：
- `ma5` / `ma20` / `maCross` —— 5 日与 20 日均线，`maCross` 为 above/below
- `bias20` —— 相对 MA20 的乖离百分比，正值=在均线上方
- `posPct` —— **净值在近 60 日区间里的位置分位（0-100）**，越小越接近区间底部
- `high60` / `low60` —— 近 60 日最高与最低净值
- `vol20Pct` —— 20 日年化波动率
- `rsi14` —— RSI(14)，>70 超买、<30 超卖
- `chg5` / `chg10` / `chg20` —— 近 5/10/20 个交易日累计涨跌
- `streak` —— 正数连涨、负数连跌
- `estimatePosPct` / `estimateBias20` / `estimateBelowRange` / `estimateAboveRange`

**用法提示**：
- 「今天跌了」不等于「便宜」。看 `posPct` 才知道它在自己历史区间里的位置
- `posPct` 低 + `rsi14` 低 + 连跌 → 相对更好的加仓位置；`posPct` 高 + 超买 → 收手
- 这些指标服务端统一口径，**不要自己拿 navSeries 再算一套**

### ③ 板块消息面

只用 1 次搜索覆盖全部持仓主题，不要每只单独搜。搜不到就省略。

⚠️ **时效与交叉验证（必须遵守）**：
- **只采信 24 小时内发布的新闻**，超过 2 天的一概不用
- 搜到的说法**必须与 `quote.proxyPct`（代理标的实时涨跌）交叉验证**
- **方向矛盾时以实时指数为准**，并在 reason 里说明你舍弃了哪条消息面
- 消息面只能辅助，**不能推翻实时行情给出的方向**

### ④ 决策流程：先出「今日作战单」，再逐只给金额

下面四个 skill 是**判断顺序**，不是四次要拉的数据：输入全部来自第一步 `/holdings` 已返回的字段，
**不要为它们新增任何网络请求**。按顺序跑完、在心里形成一张作战单，再进第三步。
每个 skill 都有否决权：它说不许，就不要在后一步偷偷绕回来。

#### 常驻区（每轮必跑）

**skill ① 组合层定调 —— 先判今天该攻还是守**

最容易犯的错，是把四只基金当成四次互不相干的判断。先看整体，再分钱。

输入：`curve.points[].twrPct` / `curve.maxDrawdownPct` / `curve.upDays` / `curve.downDays`、
四只的 `technicals.posPct` / `chg5` / `rsi14`、
`investment.returnPct` / `investment.targetReturnPct` / `investment.progressPct` /
`investment.remaining`，以及上面搜到的消息面（下表里的字段名省略了 `curve.` / `technicals.` 前缀）。

| 判据 | regime |
|---|---|
| 四只 `chg5` 同向为负，且 ≥3 只 `posPct < 25` | `risk-on`（普跌到区间下沿，可以主动找加仓位） |
| ≥3 只 `posPct > 75`，或多数 `rsi14 > 70` | `risk-off`（收手，优先检查波段止盈） |
| `curve.downDays` 明显多于 `upDays`、`maxDrawdownAt` 落在最近几天、`progressPct` 偏高，或消息面有系统性冲击 | `risk-off` |
| 其余 | `neutral` |

- `risk-on`：单笔按第三步 D 的 confidence 上限给
- `neutral`：所有买入金额打六折后取整百
- `risk-off`：**当天不给 buy/add**（已卖出后的回补除外），优先看哪只触发了波段止盈

输出写在 `payload.summary` 第一句，格式 `[risk-on] 今日整体判断…`。
**否决权**：任何 regime 下都不许四只同时 add；`risk-off` 下不许用「单只很便宜」当理由破例。
第三步 B 的降风险档也以这里的 `risk-off` 为准，不要自己另设浮亏线。

**skill ② 跨基金排序与预算切分 —— 先把钱分完，再报金额**

服务端确实会在超额时替你削减（`budget.adjusted`），但那是兜底，不是替你做「钱先给谁」的决策。
被削减等于这次流程没算清楚。

1. 算出今天可动用的钱 `cap = investment.available`（它已扣掉今天已排计划，且不超过
   `investment.remaining`），再按 ① 的 regime 打折
2. 给四只排序，靠前的优先：`posPct` 低、`weightPct` 离 `amountRules.maxWeightPct` 远、`rsi14` 低；
   **`swingBasis.lots[]` 里有 `qualifies: true` 的先处理卖出**（它释放额度，不占 cap）
3. **先切完 cap 再逐只报金额**：前 1~2 只拿大头，没分到钱的直接给 hold
4. 逐只核对：加仓后 `weightPct + 本笔金额 / investment.totalBudget × 100` 不超
   `amountRules.maxWeightPct`；所有 buy/add 金额合计 ≤ cap

**否决权**：合计超 cap 就自己重排，不要带着超额去 POST。
目标是让每次返回的 `budget.adjusted` 都为空。

#### 按需区（命中条件才细读）

> 这两个 skill 本轮先内嵌在这里，规则触发时再看。工作台后续会把这一区改成
> 「命中才取用」的独立模块；**在那之前，不要去请求任何尚不存在的接口**。

**skill ③ 置信度校准 —— 让 confidence 真的能分档**

历史上这批建议几乎全是 medium，决策复盘按置信度分箱因此完全不可信。

给每只基金逐条打勾，一条 1 分：`quote.fresh=true` 且方向明确 / `posPct < 25` 或 `> 75` /
`rsi14 < 35` 或 `> 65` / 消息面与 `quote.proxyPct` 同向 / `myRecent` 方向连贯 /
额度够且加仓后不超集中度。

- 5~6 分 → `high`；3~4 分 → `medium`；0~2 分 → `low`（只给 hold 或 ≤5% 小额试探）
- 每只 `reason` 结尾写 `[证据 4/6 → medium]`，复盘要靠它分箱
- **否决权**：证据少于 3 条却报 high 或大额，一律降档

**skill ④ 决策连贯与波段回补 —— 别在同一价位反复横跳**

- 看 `recent` 最近 3 条：若最近一次加仓的 `nav` 与今天 `quote.nav`（或估值折算价）
  相差不到 1%，视为**同一价位**，今天不再重复加仓，给 hold
- `myRecent` 方向要连贯；确实反向，必须在 reason 里写清「是什么变了」
- 波段回补：**如果** `myRecent` 条目里带 `buyBackPrice`，找出最近一次 `intent=swing` 的卖出，
  现价没跌到那个价就不买回；**如果该字段不存在**，不要臆造回补价，只执行上面的同价位规则，
  并在 reason 里注明「回补价不可得，未做回补」
- 刚卖完、还没回调的位置，不加仓

## 第三步：给出判断与金额

按第二步 ④ 的作战单逐只落地：**regime 决定能不能买、排序决定钱给谁、
证据分决定 confidence、连贯性决定要不要收手**。作战单说 hold 的，这里不要改口。

`action` 只能是：buy / add / hold / reduce / sell
`reduce` / `sell` 时必须给 `intent`：`swing`（波段止盈）/ `risk`（降风险）/ `rebalance`（再平衡）

### A. 买入 / 加仓

- 看 `technicals.posPct` / `rsi14` / `streak` 判断位置，不要只看单日涨跌
- 看 `investment.remaining` 与 `weightPct` 分配金额
- 买入不受赎回费影响，但仍要留额度给后面的机会

### B. 卖出 —— 三档触发，**不要再等「接近目标收益率」**

满足任意一条即可给 reduce / sell：

**1. 波段止盈（intent=swing）—— 我最常用的路径**

判断「今天能卖哪一部分」用 **`swingBasis`**，**绝对不要用 `lotList[0]`**：

- **逐个看 `swingBasis.lots`**：`qualifies === true` 的批次，就是今天可以卖的那部分。
  **每次加仓是独立的小仓位，各算各的** —— 不是只看最近一次，也不是看加权总成本
- 「达标」的门槛是 `swingBasis.triggerPct`（= `targetPct` 减去 0.3pp 噪声余量），
  服务端已经算在 `qualifies` 里，**你不要自己再判断百分比**，也不要写死 3%
- 所有达标批次的金额合计 = `candidateAmount`
- **卖出金额直接报 `swingBasis.suggestedAmount`**（服务端已经把达标金额和 0 费额度取过小，
  再砍成整百）。看 `cappedBy` 决定怎么解释：
  - `candidates` → 达标的部分可以全卖
  - `feeFree` → 0 费额度不够，只能卖这么多，**reason 里要说明剩下的下次再卖**
  - `null`（`qualifiedCount === 0`）→ **今天不做波段，给 hold**
- `suggestedAmount` 小于 100 时说明不够一手，也别卖
- 单次卖出不超过该基金当前份额的 **50%**
- 必须给 `buyBackPrice`（计划回补价），且 **≤ 现价 × 0.98**
- 卖出后若没跌到 `buyBackPrice`，说明这次波段没等到：**不要追高买回**，
  也不要因此改口说「当初应该继续持有」

⚠️ **`lotList[0]` 是原始底仓，成本常年高于现价（实测 -10% ~ -22%），
拿它算浮盈永远不成立**，会导致波段一次也触发不了。它只用来算「这笔扣几成费」。

**2. 降风险（intent=risk）**
- 单只 `weightPct > amountRules.maxWeightPct`，或
- skill ① 判为 `risk-off` 且该基金明显弱于其他（`chg20` 跌幅最大 + 主力持续净流出）

**3. 再平衡（intent=rebalance）**
- 单只 `unrealizedPct ≥ targetReturnPct`，真正到目标才用这档

❌ **不要因为「已经跌了很多」就拒绝卖出。** 卖出与整体浮亏无关，
只与「哪几次加仓已经赚到 `triggerPct`」有关。
❌ **也不要只肯卖赚钱的那只。** 按批次算，卖谁都是卖最早那批。

### C. 三个参考系不要混

卖出这件事有三个完全不同的问题，各用各的数据：

| 问题 | 看什么 |
|---|---|
| **今天能卖哪一部分**（哪几批碰线） | **`swingBasis.lots[].qualifies`** —— 逐批判断 |
| **能卖多少钱** | **`swingBasis.suggestedAmount`** —— 已与 0 费额度取小并砍整百 |
| **卖出去扣几成费、消耗哪一批** | **`lotList[0].feePct`** —— FIFO 队首（通常就是底仓，0 费） |

**`cost`（加权总成本）三个问题都答不了**，**不要用它判断任何一件事。**
`lotList[0]` 也不能用来判断该不该卖，它只回答扣费。

补充规则：
1. **默认卖出金额 = `suggestedAmount`。** 不要自己放大——
   赎回费足以把一段波段利润吃掉一半
2. 确实要超出 `sellPlan.feeFreeAmount`，必须在 reason 里写明「愿意承担约 X 元赎回费」+ 为什么值得
3. `cappedBy === null` 时不要卖（除非是 intent=risk 的降风险）
4. 卖出份额不能超过 `sellPlan.totalShares`，波段不要清仓

⚠️ **卖出后系统记录的「已实现盈亏」会按 FIFO 最老批次（底仓）的成本算，一定是负数。**
这不代表你判断错了——那是记账方式，不是真实亏损。
判断波段是否成功只看两件事：① 后续净值有没有跌到 `buyBackPrice`；② 卖出后持仓均价有没有下降。
不要因为「卖出会记亏损」而不敢卖。

### D. 金额与置信度

`amount` 一律是**非负整数**，方向由 action 决定。
买入/加仓金额必须是 **100 的整数倍**；减仓/卖出也按整百给（波段直接用 `suggestedAmount`）。
`action=hold` **不要给 amount**（给 0 或省略）；买入/加仓/减仓/卖出**必须给 amount**，
否则写入会被服务端拒绝。

`confidence` 必须真的分档，**不要一律 medium**：
- `high` → 单笔可动用 `investment.available` 的 30–40%
- `medium` → 单笔 10–20%
- `low` → 只给 hold，或 ≤5% 的小额试探

> 口径：上面百分比指**单笔**金额；同一天多次下注的合计不要超过 available 的 60%。
> 同一只基金当天只写一条建议，多条会被覆盖。

### E. 赎回费与持有天数

- 卖出前先看 `sellPlan`，不要只看 `holding.minHoldDays`（那只是最早一批的）
- `lotList` 里 `feePct > 0` 的批次应尽量避开
- `daysToNextTier` 很小（1-2 天）时，值得在 reason 里提一句「再等 X 天就降档」

reason 要写清依据：`technicals` 的具体数字、消息面、**哪几批达标（日期 + gainPct）**、
剩余额度与集中度，以及**为什么这个金额在长线上合理**。risks 列 1-3 条。
`sources` 放实际用到的来源。payload 顶层写一段 summary 作为当日整体判断。

原则：绝不编造净值或金额；不确定就给 hold。
**stale 不等于不能判断** —— 没有盘中估值也要照常给 action 和金额，
只是 `stale` 标 true 且 `estimate` / `estimatePct` **必须同时为 null**。

## 第四步：写回工作台

### 写回前自检闸门（POST 之前逐只过一遍）

服务端会校验字段格式、归一 stale、削减超额，但下面这些**语义错它查不出来**，
必须自己先过。任一不过 → 把那条改回 hold 再报，不要带着侥幸 POST：

- [ ] action 合法、金额整百、hold 不带 amount；`intent` 与 `buyBackPrice` 配套齐全
- [ ] confidence 与 skill ③ 的证据分一致，`low` 没有配大额；`reason` 结尾有 `[证据 x/6 → …]`
- [ ] 所有 buy/add 金额合计 ≤ skill ② 切出的 cap；没有四只同时 add
- [ ] reduce/sell 金额 ≤ `swingBasis.suggestedAmount`（超出必须在 reason 里写清愿意承担的赎回费）
- [ ] 加仓后会超 `amountRules.maxWeightPct` 的，reason 里写了理由
- [ ] 与 `myRecent` 反向的，reason 里写了「是什么变了」
- [ ] `stale=true` 时 `estimate` / `estimatePct` **同时**为 null
- [ ] `payload.summary` 第一句是 `[risk-on|neutral|risk-off]`

写成 JSON 文件后用 Bash POST：
curl -sS -m 40 -X POST {{BASE}}/wb-api/funds/ingest \
  -H "Authorization: Bearer {{TOKEN}}" \
  -H "Content-Type: application/json" \
  -d @/tmp/fund_payload.json

结构（tradeDate 用当天日期；**不要带 source 字段**，服务端按令牌判定）：
{
  "tradeDate": "2026-10-27",
  "model": "{{MODEL}}",
  "summary": "[neutral] 今日整体判断",
  "items": [
    {
      "code": "025857",
      "name": "华夏中证电网设备主题ETF联接C",
      "nav": 1.0265,
      "navDate": "2026-10-23",
      "navPct": 1.05,
      "estimate": 1.0024,
      "estimatePct": -2.35,
      "action": "reduce",
      "intent": "swing",
      "confidence": "medium",
      "amount": 1500,
      "buyBackPrice": 0.98,
      "summary": "一句话结论",
      "reason": "判断依据 + 为什么这个金额在长线上合理",
      "risks": ["风险1"],
      "sources": [{"title": "来源", "url": "https://..."}],
      "stale": false
    }
  ]
}

- `nav` / `navDate` 直接用 `quote` 里的同名字段
- 估值字段直接用 `quote` 的 `estimate` / `estimatePct`（`fresh` 为 false 时两者都填 null）
- `intent` 只在 reduce / sell 时需要；`buyBackPrice` 只在 `intent=swing` 时需要
- `navSeries` 可省略：服务端已有相同数据

服务端入库时还会按自己的快照统一覆盖一次估值，保证页面显示的是服务端统一口径。

你写进去的是**建议**，我不会照单全收：我会自己决定采不采纳，也可能自己补记一条。
所以你只需给出自己认为最合理的一版，不用替我想「还有谁会给建议」。

**一天内重复执行本任务是安全的**：同一天同一只基金同一来源只会覆盖更新。
但如果某只基金当天**已经被采纳或已经结算**，服务端会保护那条记录不被覆盖，
响应里 `skipped` 会列出它（带 `lockedBy`）。这代表我当天已经按旧金额实际操作了，
**不要当成写入成功**——汇报时说明「X 已采纳/已结算，未更新」，也不要为此重试。

返回的 `budget.adjusted` 非空 = 有建议被额度削减，汇报时必须点出来。
返回不是 200 时读 `details` 修正后重试一次；仍失败就汇报原因，不要反复重试。
如果返回 403 且提示无账本写入权限，说明你误调了结算接口——本任务不需要结算。

## 第五步：汇报（简短，我要赶时间操作）

固定 5 行以内：
1. 每只基金的建议与金额（一行一只）
2. 今天买多少 / 卖多少 / 净投入变化、**剩余额度还剩多少、加仓后各基金占比**（带上 regime）
3. 如果有波段：**哪几批达标（日期 + 涨幅）**、合计金额、实际卖出额、回补价、
   是被 0 费额度截断了还是全卖
4. 离目标收益率还有多远
5. 有没有数据不可靠（stale）、被额度削减、自检闸门拦下过什么、被保护跳过（skipped），或超集中度上限

不要贴完整 JSON，不要复述行情数据。
**没有盘中估值是常态，不用反复解释，只在第 5 行提一句即可。**
