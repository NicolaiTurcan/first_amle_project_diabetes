# Diabetes Screening — EDA & Logistic Regression

A medical screening model for the **Pima Indians Diabetes** dataset (768 patients, 8 measurements).
The goal is to catch as many real diabetes cases as possible. A missed case is far more dangerous
than a false alarm, so the model is tuned for **recall**, not accuracy.

> Built during the AI & ML Engineering Bootcamp by neue fische × SPICED.

![Project workflow](assets/diabetes_project_workflow.png)

## Highlights

- **Hypothesis-driven EDA.** Before modelling, I wrote down a research question and three hypotheses
  (BMI, age and glucose vs. diabetes). I tested each one on the training set with a **Mann-Whitney U test**
  and a **Bonferroni-corrected** α = 0.0167. All three were supported.
- **No data leakage.** I split the data (stratified, 80/20) *before* exploring it. Zeros in `Glucose`,
  `BloodPressure`, `SkinThickness`, `Insulin` and `BMI` are hidden missing values. They are imputed with
  **medians computed on the training set only**, and the same medians are applied to the test set.
- **Honest baselines.** Every model is compared against a random (stratified) baseline and a rule-based
  baseline: predict diabetes if glucose is above the median glucose of diabetic patients in the training set.
- **Handling class imbalance.** I used `class_weight="balanced"` plus a lower **decision threshold (0.3)**,
  chosen on the training data.

## Results

| Model | Train recall | Test recall | Test F1 | Test accuracy |
|---|---:|---:|---:|---:|
| Random baseline | 0.341 | 0.370 | 0.392 | 0.597 |
| Rule-based (glucose) | 0.495 | 0.444 | 0.516 | 0.708 |
| Logistic regression | 0.589 | 0.500 | 0.540 | 0.701 |
| Logistic regression, balanced | 0.710 | 0.704 | 0.650 | 0.734 |
| **Logistic regression, threshold 0.3** | **0.790** | **0.796** | **0.677** | **0.734** |

The final model catches **about 80% of the real diabetes cases** in the test set (43 of 54). The plain
logistic regression caught only 50%. The price is a few more false alarms (30 instead of 25), which a
follow-up blood test would resolve.

## Tech stack

Python 3.13 · pandas · NumPy · SciPy · scikit-learn · Matplotlib · Seaborn · Jupyter · uv

## Project structure

```
├── 01_diabetes_project.ipynb   # the full analysis: EDA, tests, models, evaluation
├── data/diabetes.csv           # Pima Indians Diabetes dataset (target: Outcome)
├── assets/                     # workflow diagram (+ Mermaid source)
├── paper_on_diabetes_mellitus_data_set.pdf   # background paper on the dataset
├── pyproject.toml / uv.lock    # dependencies
```

## Getting started

Requirements: [uv](https://docs.astral.sh/uv/). It installs the right Python version automatically.

```bash
git clone https://github.com/NicolaiTurcan/first_amle_project_diabetes.git
cd first_amle_project_diabetes
uv sync
```

Open `01_diabetes_project.ipynb` in VS Code (or Jupyter), select the `.venv` kernel, and run
**Restart & Run All**.
