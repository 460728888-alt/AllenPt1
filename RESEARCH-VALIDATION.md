# 短期预测离线核验工具

当前状态：工具框架可测试，尚无真实策略收益结论。它不会训练、选择、替换或启用任何模型，不修改正式筛选策略。T1＋1.5仍不兼容、合格候选未判定、T2未启用。

## 目前能核验什么

以明确的交易日历和已保存预测，分别核验：
1. 下一交易日原始开盘至第N交易日原始收盘是否上涨（未扣费）。
2. 同一窗口原始价格收益是否跑赢指定基准（未扣费）。
3. “先止盈后止损”目前不评估：日线OHLC不能证明可成交的日内顺序，不能用触价代替交易结果。

输出按目标独立列出样本数、预测/未预测比例、准确率及Wilson区间、Brier分数、对数损失、固定分箱校准和分月表现。所有方法同时报告各自覆盖率及共同样本；共同样本另与固定50%概率比较。固定50%不需要训练，也不是“买入持有”的收益基准。

交易信息另列：显式比例成本/滑点情景净收益、未成交、退出未解决、执行未知和持有期最不利价格变化。该情景不含最低佣金，不是实际收益或组合回测。组合最大回撤与真实交易收益返回null，不能用单笔收益串乘冒充组合。

## 输入协议

JSON结构可参考 tests/fixtures/validation.mjs。示例全部虚构，不代表真实行情或个人费率。
- dataKind：synthetic 或 historical；metadata包括source、datasetVersion、universeBasis(point_in_time/current_only/unknown)。
- protocol：id、market:CN_A、priceBasis:raw_no_corporate_actions、horizonSessions(2..20)、probabilityUnit(percent或fraction)。
- 明确entryRule:next_session_open、exitRule:horizon_session_close、upTarget:raw_price_return_positive、benchmark、tPlusOne:true、sameDayBarrierOrder:unknown。
- costs必须显式提供buyBps/sellBps/buySlippageBps/sellSlippageBps，mode必须为proportional_scenario_no_minimum_commission。没有默认真实成本或仓位。
- split：trainEnd/validationEnd/testEnd必须为日历中的有序日期；embargoSessions必须显式提供。
- sessions：完整、有序、无重复的交易日期；不能删掉缺失日来缩短五日窗口。
- bars：symbol/date、完整且一致的原始OHLC、complete:true、corporateAction:false。拆股、分红等价格尺度不明确的窗口公开排除；不静默拼接复权尺度。
- 执行标记：suspended、canBuyOpen、canSellClose须明确。缺失为未知，封板或停牌不能默认成交；退出未解决不会延长原五日预测窗口。
- records：独立研究编号id、symbol、dataThrough、featureThrough、featureAvailableAt、generatedAt、featureSnapshotHash、strategyVersion。
- forecasts以方法名分组，各目标独立：target、value、probabilityUnit、horizonSessions、startRule、endRule、feeBasis:gross_raw_price、modelVersion、trainedThrough、validUntil；跑赢目标还须benchmark匹配。若有校准和预处理，记录对应trainedThrough。
- 概率单位不猜测：percent中的0.8就是0.8%，不是80%。过期、缺失、窗口不匹配或训练时间跨界的概率计未预测，不当0。
- 历史模型有效期按预测生成时核验，不能据此推断今天仍可使用。

## 时间隔离与最终测试

特征的完整日线须已到15:05核验边界，availableAt≤generatedAt<次交易日开盘。训练/验证标签窗口跨越下一分区时公开purge，并保留统计。
本工具不拟合特征处理器或概率校准器，也不根据测试结果挑赢家。训练日期必须在协议训练截止内。元数据声明本身不能独立证明无泄漏，仍需原始数据、代码版本和来源审计。

默认只输出validation结果；其他分区的标签、收益与执行结果不写入报告ledger。
最终测试需显式 --final-test，同时提供事先冻结的协议SHA256和数据集规范化SHA256。任何修改使封存值失配即拒绝。此软件检查不能证明操作者从未反复查看最终测试，仍需记录首次封存和访问过程。

## 运行

先安装项目依赖。合成自检：
node scripts/validate-research.mjs --demo --output framework-demo.json

真实数据离线核验：
node scripts/validate-research.mjs --input research-dataset.json --output validation-report.json

输出采用新文件写入，拒绝覆盖已有文件或输入。无网络、数据库或生产配置访问。试点JSON上限32MiB，超过时需明确缩小审计样本并披露范围。
所有输出approved:false、modelSelected:null。合成输出固定标为framework_test_only，绝不写回网站成为已验证概率。

## 尚缺的数据和能力

真实历史股票池/退市及停牌资料、可追溯的当时特征与模型、足够留出样本、分钟级成交顺序、资金仓位及重叠持仓、组合回撤，以及最终正式交易规则。缺少这些时，最多验证价格标签和描述性预测统计，不能声称策略已可靠盈利，更不能声称最高准确率。
旧网站固定扣0.2个百分点的收盘到收盘成绩单不是本工具的可执行回测证据。
