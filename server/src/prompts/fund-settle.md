用真实收盘净值把我已执行的基金操作结算入账，更新持仓的份额、成本价与盈亏。

{{ROLE}}

> 本提示词由工作台统一提供（`GET /wb-api/funds/prompt?kind=settle`），**所有执行方共用同一份**。
> 不要在你的任务配置里另存副本。

## 运行时机与定位（重要）

这个任务在工作日 **13:00** 运行（必须在 14:30 出建议之前跑完），
结算对象是**上一个交易日及更早**的已执行操作——不是今天。
（今天的建议 14:30 才出，13:00 不会有当天的新操作。）

我通常在 15:00 前下单，成交价是**下单当日的收盘净值**，而净值要到当晚才公布，
所以只能等下一交易日再入账。放在 13:00 的好处是：出建议前持仓已经是最新的。

**我常常在 13:00 之前就手动触发过结算**（可能是手动执行本任务，也可能是让 Trae Work 跑）。
这不影响本任务的每日执行——你照常跑，服务端是幂等的，入过账的记录不会被重复写。
你要做的是：

- 先**核对**（第一步的 /settle-plan）
- 若还有没结掉的、或净值缺口 → **补齐**（这就是本任务的价值：兜住手动那次没做成的事）
- 若一切都已经齐了 → 直接回复核对通过，不要做任何写操作，越快越好

**「已执行」是单条互斥的**：同一只基金同一天只会有一条被采纳（我在页面上挑的），
那条就是我当天真实做的操作，账本只结算它。其余候选只是建议，不进账本。
你不需要关心是谁的建议，也没有任何优先级要算——照 /settle-plan 给的 pending 处理即可。

管理费、托管费、销售服务费已经每日从净值里计提，**不要重复计算**——只需要申购费和赎回费。

**整轮必须在 10 分钟内跑完**（纯核对模式应在 1 分钟内）：并行 curl、净值只取最近 20 条、
不要为了确认而反复重试同一个接口。

## 第一步：核对（必做，先别急着写）

curl -sS -m 25 -H "Authorization: Bearer {{TOKEN}}" "{{BASE}}/wb-api/funds/settle-plan?date=$(TZ=Asia/Shanghai date +%F)&lookback=10"

返回里这几个字段决定你今天干什么：

- `needSettle` / `pendingCount` / `pending`：已执行但还没入账的操作（code / date / action / amount）。
  `date` 是操作发生的那一天，**结算必须用这一天的净值**
- `missingNav`：待结算但库里还查不到当日净值的——**这就是结算卡住的直接原因，优先补这些**
- `navGaps`：最近 10 个交易日里，哪些基金缺哪几天的净值（走势图与结算都依赖它）。
  服务端用「当天有没有任何数据」判定交易日，所以节假日不会被误报
- `anomalies`：单日净值跳变超过 20% 的（多半是抓错日期）。**只汇报，不要自动改**
- `clean`：`true` 表示没有待结算、没有缺口、没有异常——今天没活儿干
- `canSettle`：本来源能不能写账本；`false` 就不要调 /settle

**如果 `clean` 为 true**：直接回复「核对通过：今日无待结算、净值无缺口、无异常」并结束，
不要调用任何写接口。（这就是我已经手动结算过的情况下你该做的事。）

同时也读一下持仓（拿基金名称、判断费率是否已配置）：
curl -sS -m 25 -H "Authorization: Bearer {{TOKEN}}" {{BASE}}/wb-api/funds/holdings

## 第二步：抓取费率（只补没配过的，且仅在需要结算时做）

对每只 `feeSource` 为空、或 `purchaseFee` 为 0 且赎回分档是默认值的基金，尝试抓取费率：
curl -sS -m 20 "https://fundf10.eastmoney.com/jjfl_CODE.html"
（把 CODE 换成基金代码）

组装成：
purchaseFee: 申购费率百分比数字（打折后的，如 0.15）
redemptionFee: [{"days":7,"fee":1.5},{"days":30,"fee":0.5},{"days":null,"fee":0}]
（从上往下匹配第一条命中的规则；days 为 null 表示兜底档）

⚠️ **默认值必须区分 A/C 类，不要一律填 0.15**：
- 我这四只**全部是 C 类**（名字带「联接 C」）。C 类**不收申购费**，申购费应为 **0**。
- 抓不到费率时：**C 类按申购 0、赎回 [{"days":7,"fee":1.5},{"days":null,"fee":0}]**；
  只有确认是 A 类时才用 0.15。
- 之前一律填 0.15 是错的，会把成本系统性高估，别再犯。
- 把 source 标为 "default"。已经配置过的（feeSource 不是空）**不要覆盖**，我可能手动改过。

**赎回费按批次 FIFO 由服务端自己算**，你只要把费率表传对就行，
不要在 payload 里传任何「这一批持有多少天」之类的推算结果。

## 第三步：按日期取净值（核心步骤）

要抓的净值 = `pending` 里的 (code, date) ∪ `navGaps` 里的 (code, date)，去重后并行抓：

curl -sS -m 25 "https://api.fund.eastmoney.com/f10/lsjz?fundCode=CODE&pageIndex=1&pageSize=20" -H "Referer: https://fundf10.eastmoney.com/"
在 Data.LSJZList 里找 FSRQ 等于目标日期的那条，DWJZ 就是净值（pageSize 上限 20，
要更早的日期就翻 pageIndex；返回是倒序，最新在前）。

也可以一次拿四只的最新净值：
curl -sS -m 20 -H "Referer: https://fundmobapi.eastmoney.com/" \
  "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=10&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=wb&Fcodes=016708,020406,025857,020274"
返回 `Datas[]`，按 `FCODE` 对应：`PDATE` 是净值日期、`NAV` 是单位净值——
**只有当 PDATE 等于目标日期**时才采用。

⚠️ **2026-10-19 实测：`fundgz.1234567.com.cn` 已下线**（只会返回东财「页面未找到」HTML），
`push2` / `82.push2` / `1.push2` 也全部 404。**不要再在这几个源上浪费任何请求。**
当前可用的净值源只有上面两条：`api.fund/f10/lsjz`（历史净值，推荐，结算场景够用）
和 `fundmobapi FundMNFInfo`（最新净值，可批量）。

**铁律：绝不能用 A 日期的净值去结算 B 日期的操作。** 拿不到就让那只基金那只日期继续挂着，
下个交易日这个任务会自动补。绝不能用盘中估值或其他日期的净值冒充。

## 第四步：先补净值，再结算（顺序不能反）

**4a. 把抓到的所有净值写进净值序列**（含历史日期的缺口）：

curl -sS -m 40 -X POST {{BASE}}/wb-api/funds/nav-backfill \
  -H "Authorization: Bearer {{TOKEN}}" \
  -H "Content-Type: application/json" \
  -d @/tmp/nav_backfill.json

payload：
{"items":[{"code":"020406","date":"2026-10-14","nav":1.3812},{"code":"016708","date":"2026-10-14","nav":1.6145}]}

这个接口只写净值、不碰账本，重复写以最后一次为准。先补它，挂起记录才结得掉。

**4b. 按日期结算**，每个有待结算记录的日期调用一次（日期从早到晚）：

curl -sS -m 40 -X POST {{BASE}}/wb-api/funds/settle \
  -H "Authorization: Bearer {{TOKEN}}" \
  -H "Content-Type: application/json" \
  -d @/tmp/settle_payload.json

payload（tradeDate 用**这一批记录自己的日期**，不要用今天的日期）：
{
  "tradeDate": "2026-10-14",
  "navs": {"020406": 1.3812, "016708": 1.6145},
  "fees": {
    "020406": {
      "purchaseFee": 0,
      "redemptionFee": [{"days": 7, "fee": 1.5}, {"days": 30, "fee": 0.5}, {"days": null, "fee": 0}],
      "source": "auto"
    }
  }
}

- navs 只放你确实拿到**该日期**净值的基金；fees 只放需要补配的基金
- 接口幂等：已结算过的不会重复入账，可以放心重跑
- 返回里 `pending` 是还没结算的（净值没出），`settled` 是这次成功入账的明细，
  `skipped` 是同日重复被跳过的（现在不该出现，出现了要汇报）
- 卖出（reduce/sell）会按批次 FIFO 扣减，`settled[]` 里带 `breakdown`，
  能看到扣了哪几批、各自持有多久、费率多少、已实现盈亏多少。
  **已实现为负是正常的**（卖掉的是成本最高的最老批次），不代表出错。

**4c. 再核对一次**确认收尾（同一个 /settle-plan 请求）：
`pendingCount` 应为 0、`navGaps` 应为空。若还有残留，说明净值确实没公布，照实汇报即可。

## 第五步：汇报（不超过 6 行）

- 模式：写明是「结算」还是「核对 + 补齐」（例如「已手动结算过，本次为核对补齐」）
- 结算/补齐了哪个交易日、哪些基金、净值多少、买入多少份额、扣了多少费
- 补了哪几天的净值缺口
- 还有哪些没结掉（净值未出），说明下个交易日会自动补
- anomalies 若非空，原样提示我去人工看一眼

不要贴完整 JSON。
