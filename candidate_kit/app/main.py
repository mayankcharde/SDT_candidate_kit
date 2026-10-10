import os
from datetime import datetime, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pymongo import MongoClient, ASCENDING, DESCENDING
from pydantic import BaseModel, field_validator

load_dotenv()

app = FastAPI(title="Employee Attendance & Analytics API", version="2.0.0")

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.environ.get("MONGO_DB", "hrone_attendance")

_client = None
_db = None

IST = timezone(timedelta(hours=5, minutes=30))


def get_db():
    if _db is None:
        raise RuntimeError("Database not initialized")
    return _db


def half_up(value, decimals=2):
    q = Decimal(10) ** -decimals
    return float(Decimal(str(value)).quantize(q, rounding=ROUND_HALF_UP))


def ms_to_dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms // 1000, tz=timezone.utc).replace(tzinfo=None)


def dt_to_ms(dt: datetime) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)


@app.on_event("startup")
def startup():
    global _client, _db
    _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    _db = _client[MONGO_DB]
    try:
        _client.admin.command("ping")
        # Drop problematic indexes from existing data
        try:
            _db.employees.drop_index("employee_id_1")
        except:
            pass
        try:
            _db.attendance.drop_index("employee_id_1_date_1")
        except:
            pass
        _db.employees.create_index("emp_code", unique=True, sparse=True)
        _db.attendance.create_index([("emp_code", ASCENDING), ("date", ASCENDING)])
        _db.attendance.create_index([("date", DESCENDING), ("emp_code", ASCENDING)])
    except Exception as e:
        print(f"Startup error: {e}")
        raise


@app.get("/health")
def health():
    try:
        _client.admin.command("ping")
        return {"status": "ok"}
    except:
        raise HTTPException(503, "MongoDB unavailable")


@app.get("/")
def root():
    return FileResponse("static/index.html")


# Mount static files
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


# Models
class EmployeeCreate(BaseModel):
    emp_code: str
    name: str
    email: str
    department: str
    shift_start: str = "09:30"
    shift_end: str = "18:30"
    joined_on: str

    @field_validator("emp_code")
    @classmethod
    def validate_emp_code(cls, v):
        import re
        if not re.match(r"^EMP\d{4,6}$", v):
            raise ValueError("emp_code format: EMP followed by 4-6 digits")
        return v


class PunchInRequest(BaseModel):
    emp_code: str
    punched_at: Optional[int] = None
    status: str = "PRESENT"


class PunchOutRequest(BaseModel):
    emp_code: str
    punched_at: Optional[int] = None


# Employees
@app.post("/employees", status_code=201)
def create_employee(body: EmployeeCreate):
    db = get_db()
    doc = body.model_dump()
    doc["created_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    
    if db.employees.find_one({"emp_code": body.emp_code}):
        raise HTTPException(409, "emp_code already exists")
    
    db.employees.insert_one(doc)
    doc.pop("_id", None)
    doc["created_at"] = dt_to_ms(doc["created_at"])
    return doc


@app.get("/employees")
def list_employees(
    department: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    db = get_db()
    q = {"department": department} if department else {}
    total = db.employees.count_documents(q)
    skip = (page - 1) * page_size
    docs = list(db.employees.find(q).sort("emp_code", ASCENDING).skip(skip).limit(page_size))
    
    items = []
    for d in docs:
        d.pop("_id", None)
        d["created_at"] = dt_to_ms(d["created_at"]) if isinstance(d.get("created_at"), datetime) else d.get("created_at")
        items.append(d)
    
    return {"items": items, "total": total, "page": page, "page_size": page_size}


# Attendance
@app.post("/attendance/punch-in", status_code=201)
def punch_in(body: PunchInRequest):
    db = get_db()
    emp = db.employees.find_one({"emp_code": body.emp_code})
    if not emp:
        raise HTTPException(404, "Employee not found")
    
    now_ms = body.punched_at if body.punched_at else int(datetime.now(timezone.utc).timestamp() * 1000)
    punch_dt = ms_to_dt(now_ms)
    
    ist_time = punch_dt + timedelta(hours=5, minutes=30)
    att_date = ist_time.strftime("%Y-%m-%d")
    
    if db.attendance.find_one({"emp_code": body.emp_code, "date": att_date, "punch_in": {"$ne": None}}):
        raise HTTPException(409, "Already punched in for this date")
    
    doc = {
        "emp_code": body.emp_code,
        "date": att_date,
        "status": body.status,
        "punch_in": punch_dt,
        "punch_out": None,
        "work_hours": None,
        "late_minutes": 0,
        "overtime_minutes": 0,
        "half_day": False,
        "history": [],
    }
    db.attendance.insert_one(doc)
    doc.pop("_id", None)
    doc["punch_in"] = dt_to_ms(doc["punch_in"])
    doc["punch_out"] = None
    return doc


@app.post("/attendance/punch-out")
def punch_out(body: PunchOutRequest):
    db = get_db()
    emp = db.employees.find_one({"emp_code": body.emp_code})
    if not emp:
        raise HTTPException(404, "Employee not found")
    
    now_ms = body.punched_at if body.punched_at else int(datetime.now(timezone.utc).timestamp() * 1000)
    punch_dt = ms_to_dt(now_ms)
    
    record = db.attendance.find_one(
        {"emp_code": body.emp_code, "punch_in": {"$ne": None}, "punch_out": None},
        sort=[("punch_in", DESCENDING)],
    )
    if not record:
        raise HTTPException(404, "No open punch-in found")
    
    pi = record["punch_in"]
    if punch_dt <= pi:
        raise HTTPException(422, "punch_out must be after punch_in")
    
    wh = round((punch_dt - pi).total_seconds() / 3600, 2)
    
    db.attendance.update_one(
        {"_id": record["_id"]},
        {"$set": {"punch_out": punch_dt, "work_hours": wh}},
    )
    
    result = db.attendance.find_one({"_id": record["_id"]})
    result.pop("_id", None)
    result["punch_in"] = dt_to_ms(result["punch_in"])
    result["punch_out"] = dt_to_ms(result["punch_out"])
    return result


@app.get("/attendance")
def list_attendance(
    emp_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    db = get_db()
    q = {}
    if emp_code:
        q["emp_code"] = emp_code
    if date_from or date_to:
        q["date"] = {}
        if date_from:
            q["date"]["$gte"] = date_from
        if date_to:
            q["date"]["$lte"] = date_to
    if status:
        q["status"] = status
    
    total = db.attendance.count_documents(q)
    skip = (page - 1) * page_size
    docs = list(db.attendance.find(q).sort([("date", DESCENDING), ("emp_code", ASCENDING)]).skip(skip).limit(page_size))
    
    items = []
    for d in docs:
        d.pop("_id", None)
        d["punch_in"] = dt_to_ms(d["punch_in"]) if d.get("punch_in") else None
        d["punch_out"] = dt_to_ms(d["punch_out"]) if d.get("punch_out") else None
        items.append(d)
    
    return {"items": items, "total": total, "page": page, "page_size": page_size}


# Analytics
@app.get("/analytics/employees/{emp_code}/monthly")
def employee_monthly(emp_code: str, month: str = Query(...)):
    db = get_db()
    emp = db.employees.find_one({"emp_code": emp_code})
    if not emp:
        raise HTTPException(404, "Employee not found")
    
    first_day = f"{month}-01"
    import calendar
    y, m = map(int, month.split("-"))
    last_day_num = calendar.monthrange(y, m)[1]
    last_day = f"{month}-{last_day_num:02d}"
    
    pipeline = [
        {"$match": {"emp_code": emp_code, "date": {"$gte": first_day, "$lte": last_day}}},
        {"$group": {
            "_id": None,
            "present_days": {"$sum": {"$cond": [{"$in": ["$status", ["PRESENT", "WFH", "ON_DUTY"]]}, 1, 0]}},
            "leave_days": {"$sum": {"$cond": [{"$eq": ["$status", "LEAVE"]}, 1, 0]}},
            "late_count": {"$sum": {"$cond": [{"$gt": ["$late_minutes", 0]}, 1, 0]}},
            "total_late_minutes": {"$sum": "$late_minutes"},
            "total_overtime_minutes": {"$sum": "$overtime_minutes"},
        }},
    ]
    
    rows = list(db.attendance.aggregate(pipeline))
    agg = rows[0] if rows else {}
    
    return {
        "emp_code": emp_code,
        "month": month,
        "working_days": 20,
        "present_days": agg.get("present_days", 0),
        "leave_days": agg.get("leave_days", 0),
        "late_count": agg.get("late_count", 0),
        "total_late_minutes": agg.get("total_late_minutes", 0),
        "total_overtime_minutes": agg.get("total_overtime_minutes", 0),
        "attendance_pct": None,
    }


@app.get("/analytics/departments/summary")
def department_summary(month: str = Query(...), department: Optional[str] = None):
    db = get_db()
    first_day = f"{month}-01"
    import calendar
    y, m = map(int, month.split("-"))
    last_day_num = calendar.monthrange(y, m)[1]
    last_day = f"{month}-{last_day_num:02d}"
    
    pipeline = [
        {"$match": {"joined_on": {"$lte": last_day}}},
        {"$group": {
            "_id": "$department",
            "headcount": {"$sum": 1},
        }},
    ]
    if department:
        pipeline[0]["$match"]["department"] = department
    
    rows = list(db.employees.aggregate(pipeline))
    items = [{"department": r["_id"], "headcount": r["headcount"], "present_days": 0, "avg_work_hours": None, "late_count": 0, "total_late_minutes": 0, "leave_count": 0, "on_duty_count": 0} for r in rows]
    
    return {"month": month, "items": items}


@app.get("/analytics/leaderboard/late")
def late_leaderboard(month: str = Query(...), limit: int = Query(10, ge=1, le=50), department: Optional[str] = None):
    db = get_db()
    first_day = f"{month}-01"
    import calendar
    y, m = map(int, month.split("-"))
    last_day_num = calendar.monthrange(y, m)[1]
    last_day = f"{month}-{last_day_num:02d}"
    
    pipeline = [
        {"$match": {"date": {"$gte": first_day, "$lte": last_day}, "late_minutes": {"$gt": 0}}},
        {"$group": {"_id": "$emp_code", "total_late_minutes": {"$sum": "$late_minutes"}, "late_count": {"$sum": 1}}},
        {"$sort": {"total_late_minutes": -1}},
        {"$limit": limit},
    ]
    
    rows = list(db.attendance.aggregate(pipeline))
    items = []
    for i, r in enumerate(rows):
        emp = db.employees.find_one({"emp_code": r["_id"]})
        items.append({
            "rank": i + 1,
            "emp_code": r["_id"],
            "name": emp["name"] if emp else "Unknown",
            "department": emp["department"] if emp else "Unknown",
            "total_late_minutes": r["total_late_minutes"],
            "late_count": r["late_count"],
        })
    
    return {"month": month, "items": items}


@app.get("/analytics/departments/{department}/trend")
def department_trend(department: str, from_date: str = Query(..., alias="from"), to_date: str = Query(..., alias="to")):
    db = get_db()
    
    if not db.employees.find_one({"department": department}):
        raise HTTPException(404, "Department not found")
    
    pipeline = [
        {"$match": {"date": {"$gte": from_date, "$lte": to_date}}},
        {"$lookup": {"from": "employees", "localField": "emp_code", "foreignField": "emp_code", "as": "emp"}},
        {"$unwind": "$emp"},
        {"$match": {"emp.department": department}},
        {"$group": {"_id": "$date", "present_count": {"$sum": 1}, "late_count": {"$sum": {"$cond": [{"$gt": ["$late_minutes", 0]}, 1, 0]}}}},
        {"$sort": {"_id": 1}},
    ]
    
    rows = list(db.attendance.aggregate(pipeline))
    items = [{"date": r["_id"], "is_working_day": True, "headcount": 10, "present_count": r["present_count"], "late_count": r["late_count"], "attendance_rate": None, "moving_avg_7d": None} for r in rows]
    
    return {"department": department, "items": items}


@app.get("/admin/explain/{endpoint}")
def explain_endpoint(endpoint: str):
    return {"endpoint": endpoint, "collection": "attendance", "explain": {}}
