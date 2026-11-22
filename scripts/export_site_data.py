"""Reproduce the notebook pipeline and export the numbers used by the project website.

Run from the repository root:

    uv run python scripts/export_site_data.py

The output, docs/assets/site-data.js, defines `window.SITE_DATA`. It is a plain
script (not JSON fetched at runtime), so the page also works when opened from disk.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import scipy.stats as stats
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "diabetes.csv"
OUT_PATH = ROOT / "docs" / "assets" / "site-data.js"

RANDOM_STATE = 42
THRESHOLD = 0.3
HIDDEN_ZERO_COLS = ["Glucose", "BloodPressure", "SkinThickness", "Insulin", "BMI"]
HYPOTHESES = [
    ("H1", "BMI", "If a patient has a higher BMI, then they are more likely to have diabetes."),
    ("H2", "Age", "The older a patient is, the more likely they are to test positive for diabetes."),
    ("H3", "Glucose", "If a patient has higher glucose levels, then their chances of having diabetes are higher."),
]


def scores(y_true, y_pred) -> dict[str, float]:
    return {
        "recall": recall_score(y_true, y_pred),
        "precision": precision_score(y_true, y_pred, zero_division=0),
        "f1": f1_score(y_true, y_pred),
        "accuracy": accuracy_score(y_true, y_pred),
    }


def histogram(values: pd.Series, edges: np.ndarray) -> list[float]:
    """Share of the group in each bin (sums to 1), so both classes are comparable."""
    counts, _ = np.histogram(values, bins=edges)
    return (counts / counts.sum()).round(4).tolist()


def main() -> None:
    df = pd.read_csv(DATA_PATH)

    # Same split as the notebook
    df_train, df_test = train_test_split(
        df, test_size=0.2, stratify=df["Outcome"], random_state=RANDOM_STATE
    )
    df_train, df_test = df_train.copy(), df_test.copy()

    # Hidden zeros -> NaN -> training medians (applied to both sets)
    hidden_zeros = (df_train[HIDDEN_ZERO_COLS] == 0).sum().to_dict()
    df_train[HIDDEN_ZERO_COLS] = df_train[HIDDEN_ZERO_COLS].replace(0, np.nan)
    train_medians = df_train[HIDDEN_ZERO_COLS].median()
    df_train[HIDDEN_ZERO_COLS] = df_train[HIDDEN_ZERO_COLS].fillna(train_medians)
    df_test[HIDDEN_ZERO_COLS] = df_test[HIDDEN_ZERO_COLS].replace(0, np.nan).fillna(train_medians)

    X_train, y_train = df_train.drop(columns="Outcome"), df_train["Outcome"]
    X_test, y_test = df_test.drop(columns="Outcome"), df_test["Outcome"]
    features = X_train.columns.tolist()

    # Hypothesis tests (one-sided Mann-Whitney U, Bonferroni-corrected alpha)
    alpha = 0.05 / len(HYPOTHESES)
    hypotheses = []
    for code, feature, statement in HYPOTHESES:
        neg = df_train.loc[df_train["Outcome"] == 0, feature]
        pos = df_train.loc[df_train["Outcome"] == 1, feature]
        _, p_value = stats.mannwhitneyu(neg, pos, alternative="less")
        hypotheses.append({
            "code": code,
            "feature": feature,
            "statement": statement,
            "p_value": float(p_value),
            "median_neg": float(neg.median()),
            "median_pos": float(pos.median()),
            "verdict": "Supported" if p_value < alpha else "Cannot tell yet",
        })

    # Class-conditional histograms for the distribution explorer
    bin_specs = {"Glucose": (40, 200, 10), "BMI": (15, 60, 2.5), "Age": (20, 80, 5)}
    distributions = {}
    for feature, (lo, hi, step) in bin_specs.items():
        edges = np.arange(lo, hi + step, step)
        distributions[feature] = {
            "edges": edges.round(2).tolist(),
            "neg": histogram(df_train.loc[y_train == 0, feature].clip(lo, hi - 1e-9), edges),
            "pos": histogram(df_train.loc[y_train == 1, feature].clip(lo, hi - 1e-9), edges),
        }

    # Models
    dummy = DummyClassifier(strategy="stratified", random_state=RANDOM_STATE).fit(X_train, y_train)
    glucose_cutoff = float(df_train.loc[y_train == 1, "Glucose"].median())
    logreg = LogisticRegression(random_state=RANDOM_STATE, max_iter=1000).fit(X_train, y_train)
    logreg_balanced = LogisticRegression(
        class_weight="balanced", random_state=RANDOM_STATE, max_iter=1000
    ).fit(X_train, y_train)

    def rule(X):
        return (X["Glucose"] > glucose_cutoff).astype(int)

    def thresholded(X):
        return (logreg.predict_proba(X)[:, 1] >= THRESHOLD).astype(int)

    models = [
        ("Random baseline", "baseline", dummy.predict),
        ("Rule-based (glucose)", "baseline", rule),
        ("Logistic regression", "model", logreg.predict),
        ("LogReg, balanced", "model", logreg_balanced.predict),
        ("LogReg, threshold 0.3", "best", thresholded),
    ]
    results, confusion = [], {}
    for name, kind, predict in models:
        pred_test = predict(X_test)
        results.append({
            "name": name,
            "kind": kind,
            "train": scores(y_train, predict(X_train)),
            "test": scores(y_test, pred_test),
        })
        tn, fp, fn, tp = confusion_matrix(y_test, pred_test).ravel()
        confusion[name] = {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}

    # Threshold trade-off on the TRAINING set (this is where the threshold was chosen)
    proba_train = logreg.predict_proba(X_train)[:, 1]
    curve = []
    for t in np.round(np.arange(0.05, 0.951, 0.025), 3):
        pred = (proba_train >= t).astype(int)
        curve.append({"t": float(t), **{k: round(v, 4) for k, v in scores(y_train, pred).items()}})

    # Standardised coefficients: effect of +1 standard deviation on the log-odds
    stds = X_train.std()
    importance = sorted(
        ({"feature": f, "value": round(float(c * stds[f]), 4)} for f, c in zip(features, logreg.coef_[0])),
        key=lambda d: abs(d["value"]),
        reverse=True,
    )

    data = {
        "dataset": {
            "rows": int(len(df)),
            "features": len(features),
            "train_rows": int(len(df_train)),
            "test_rows": int(len(df_test)),
            "positive_share": round(float(df["Outcome"].mean()), 4),
            "hidden_zeros_train": {k: int(v) for k, v in hidden_zeros.items()},
        },
        "alpha": alpha,
        "hypotheses": hypotheses,
        "distributions": distributions,
        "glucose_cutoff": glucose_cutoff,
        "results": results,
        "confusion": confusion,
        "threshold_curve": curve,
        "importance": importance,
        "model": {
            "features": features,
            "coef": [round(float(c), 6) for c in logreg.coef_[0]],
            "intercept": round(float(logreg.intercept_[0]), 6),
            "threshold": THRESHOLD,
            "medians": {f: float(X_train[f].median()) for f in features},
            "min": {f: float(X_train[f].min()) for f in features},
            "max": {f: float(X_train[f].max()) for f in features},
        },
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        "// Generated by scripts/export_site_data.py - do not edit by hand.\n"
        f"window.SITE_DATA = {json.dumps(data, indent=2)};\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
