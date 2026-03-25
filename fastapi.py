from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import pandas as pd
import joblib
import traceback
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------
# 1. LOAD ASSETS
# -------------------------------
try:
    model = joblib.load("credit_model.pkl")
    threshold = joblib.load("threshold.pkl")
    medians = joblib.load("medians.pkl")
    clip_bounds = joblib.load("clip_bounds.pkl")
    print("✅ All model assets loaded.")
except Exception as e:
    print(f"❌ Error loading assets: {e}")

# -------------------------------
# 2. INPUT SCHEMA (With Hyphen Support)
# -------------------------------
class InputData(BaseModel):
    RevolvingUtilizationOfUnsecuredLines: float
    age: int
    # Use Field alias to handle the hyphen from the frontend/JSON
    NumberOfTime30_59DaysPastDueNotWorse: int = Field(alias="NumberOfTime30-59DaysPastDueNotWorse")
    NumberOfTimes90DaysLate: int
    DebtRatio: float
    MonthlyIncome: float
    NumberOfOpenCreditLinesAndLoans: int

    class Config:
        # This allows the API to accept the field by its alias name
        populate_by_name = True


# -------------------------------
# 3. PREDICT ENDPOINT
# -------------------------------
@app.post("/predict")
def predict(data: InputData):
    try:
        # Convert Pydantic to dict (using the alias names)
        input_dict = data.dict(by_alias=True)
        
        # 1. Create DataFrame
        df = pd.DataFrame([input_dict])

        # 2. Apply the SAME Feature Engineering from training
        # Fill NAs
        df = df.fillna(medians)

        # Clipping
        for col in df.columns:
            if col in clip_bounds:
                lower, upper = clip_bounds[col]
                df[col] = df[col].clip(lower, upper)

        # Generate the 4 missing features the model expects
        df["DebtIncomeRatio"] = df["DebtRatio"] / (df["MonthlyIncome"] + 1)
        df["LateSeverity"] = (
            df["NumberOfTime30-59DaysPastDueNotWorse"] + 
            (3 * df["NumberOfTimes90DaysLate"])
        )
        df["ZeroIncomeFlag"] = (df["MonthlyIncome"] == 0).astype(int)
        df["HighUtilization"] = (df["RevolvingUtilizationOfUnsecuredLines"] > 0.9).astype(int)

        # 3. Inference
        # Ensure column order matches training exactly if you didn't use a pipeline
        # (If 'model' is a Pipeline, it handles the scaling/order)
        prob = model.predict_proba(df)[0][1]
        pred = int(prob >= threshold)

        return {
            "default_probability": round(float(prob), 4),
            "prediction": pred,
            "approved": bool(1 - pred)
        }

    except Exception as e:
        # This will print the EXACT error in your terminal/command prompt
        print("--- ERROR TRACEBACK ---")
        traceback.print_exc() 
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
def home():
    return {"status": "running"}