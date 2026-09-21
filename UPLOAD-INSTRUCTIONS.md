# Allen v1.18 上传与训练步骤

## 1. 上传根目录文件

在 GitHub 仓库 `AllenPt1` 首页点 **Add file → Upload files**，上传本文件夹根目录中的：

- `server.js`
- `ranking-model.js`
- `ranking-model.test.js`
- `package.json`
- `package-lock.json`
- `README.md`
- `LIGHTGBM-TRAINING.md`
- `UPDATE-1.18.md`

不要把 `ml` 或 `.github` 里的文件直接传到根目录。

## 2. 上传 ml 目录文件

进入仓库的 `ml` 文件夹，再点 **Add file → Upload files**，上传本更新包 `ml` 文件夹中的 5 个文件：

- `build_baostock_dataset.py`
- `build_qlib_dataset.py`
- `build_yahoo_dataset.py`
- `train_ranker.py`
- `test_training.py`

## 3. 上传工作流文件

进入 `.github/workflows`，上传：

- `train-lightgbm-current.yml`

## 4. 清理以前误传到根目录的旧副本

仓库首页如果仍有以下 4 个文件，请分别打开文件，点右上角三个点，再点 **Delete file** 并提交：

- `build_baostock_dataset.py`
- `train_ranker.py`
- `requirements.txt`
- `model-manifest.json`

它们是以前误传的旧副本。正确文件分别位于 `ml/` 和 `models/`；即使暂时不删除，v1.18 工作流仍会使用正确目录，但建议清理，避免以后误操作。

## 5. 等待 Render 部署

确认 Render 显示 **Deploy succeeded / Live**。访问：

`https://allen-stock-web-v1.onrender.com/api/health`

页面中的 `version` 应显示 `1.18.0`。

## 6. 重新训练

打开 GitHub 仓库顶部 **Actions**，左侧选择：

**Train LightGBM with recent market data**

点击 **Run workflow**，使用：

- `start_date`: `2016-01-01`
- `universe_limit`: `0`
- `transaction_cost_bps`: `30`

绿色成功后，工作流会自动提交新的 `models/model-manifest.json` 和三个模型文件，并触发 Render 再部署一次。

## 7. 判断是否真正启用

再次打开 `/api/health`，查看 `rankingModel`：

- `approvedHorizons`：通过52%扣费后净胜率等验证门槛的周期；
- `activeHorizons`：当前数据不过期且已实际启用的周期；
- `horizons`：5、20、60日各自的净胜率、净超额和通过状态。

GitHub Action 绿色只表示训练流程完成，不代表模型一定通过研究门槛。未通过的周期会继续安全回退，不显示机器学习概率。
