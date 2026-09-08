# Allen股票分析1.0

单用户私人股票研究与决策辅助 Web App。

## 当前能力

- 私人登录，不开放注册
- 股票搜索与个人股票池
- 真实市场价格、历史行情、均线和波动数据
- 股票详情九大研究模块
- 短期 / 中期 / 长期条件评分
- 持仓与投资逻辑本机保存
- 风险预警、未来事件、每日简报
- 缺少可靠来源的财务、公司和行业数据明确标记为待接入

## 本地运行

```bash
npm install
APP_USERNAME=allen APP_PASSWORD=allen123 npm start
```

打开 `http://localhost:10000`。

## Render 环境变量

- `APP_USERNAME`：登录用户名
- `APP_PASSWORD`：登录密码（必须在 Render 中设置）

## 重要说明

行情可能延迟。本项目用于研究辅助，不构成投资建议。AI 不会编造缺失的实时、财务或新闻数据。
