# Allen 模型委员会部署

本版本不会启用尚未训练的 LightGBM。新增的 `predictor_service.py` 使用 Amazon 官方公开的 Chronos-Bolt 预训练模型，并由原 Node 网站负责把它与历史统计模型进行方向对照。

## 在 Render 新建第二个 Web Service

1. 仍选择同一个 GitHub 仓库和 `main` 分支。
2. Runtime 选择 `Python 3`。
3. Build Command：`pip install -r predictor-requirements.txt`
4. Start Command：`uvicorn predictor_service:app --host 0.0.0.0 --port $PORT`
5. Health Check Path：`/health`
6. 环境变量：
   - `CHRONOS_MODEL=amazon/chronos-bolt-tiny`
   - `FORECAST_API_TOKEN=` 设置一串自己生成的长随机字符。

首次启动会下载约 9M 参数的模型，时间会比普通启动长。

## 连接原网站

在原来的 `allen-stock-web-v1` 环境变量加入：

- `FORECAST_API_URL=https://你的预测服务.onrender.com`
- `FORECAST_API_TOKEN=` 与预测服务完全相同
- `FORECAST_TIMEOUT_MS=55000`

保存后重新部署原网站。打开“趋势预测中心”，页面会显示 Chronos 与历史统计模型的各自观点以及是否共振。预测服务无法访问时，原网站自动回退，不影响其他功能。

## 重要说明

- 预训练模型不等于已经针对 A 股校准。
- `upProbability` 是根据模型分位数插值得到的研究量，不是实际胜率。
- 只有后续真实预测记录积累到足够样本，才能展示可靠的后验命中率。
- 模型分歧时必须显示等待，不得把平均分伪装成高置信信号。
