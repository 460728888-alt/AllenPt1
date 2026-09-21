import unittest

import numpy as np
import pandas as pd

from ml.build_yahoo_dataset import add_features
from ml.train_ranker import FEATURES, relevance


NON_PRICE_FEATURES = {
    "revenueGrowth", "profitGrowth", "netMargin", "debtRatio",
    "timedEventCount", "positiveEvidenceCount", "negativeEvidenceCount",
    "bodyEvidenceCount",
}


class TrainingContractTest(unittest.TestCase):
    def test_yahoo_builder_produces_all_runtime_price_features(self):
        rng = np.random.default_rng(20260921)
        close = pd.Series(20 * np.exp(np.cumsum(rng.normal(0.001, 0.02, 180))))
        frame = pd.DataFrame({
            "date": pd.date_range("2025-01-01", periods=len(close)),
            "symbol": "000001",
            "close": close,
            "high": close * 1.01,
            "low": close * 0.99,
            "volume": rng.integers(1_000, 5_000, len(close)),
        })
        featured = add_features(frame)
        technical = [name for name in FEATURES if name not in NON_PRICE_FEATURES]
        self.assertTrue(set(technical).issubset(featured.columns))
        self.assertTrue(np.isfinite(featured.iloc[-1][technical].astype(float)).all())

    def test_relevance_reserves_positive_labels_for_net_winners(self):
        values = pd.Series([-1.0, 0.2, 0.31, 0.8, 2.0])
        labels = relevance(values, 0.3)
        self.assertEqual(labels.iloc[0], 0)
        self.assertEqual(labels.iloc[1], 0)
        self.assertTrue((labels.iloc[2:] > 0).all())
        self.assertTrue(labels.is_monotonic_increasing)


if __name__ == "__main__":
    unittest.main()
