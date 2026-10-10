# Employee Attendance & Analytics API

A FastAPI-based REST API for managing employee attendance tracking and analytics with MongoDB backend.

## Quick Start

### Prerequisites
- Python 3.8+
- MongoDB (local or Atlas)

### Installation

```bash
pip install -r requirements.txt
```

### Configuration

Set environment variables (or create a `.env` file):
```bash
MONGO_URI=mongodb://localhost:27017
MONGO_DB=hrone_attendance
```

For MongoDB Atlas:
```bash
MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGO_DB=hrone_attendance
```

### Running the Server

```bash
uvicorn app.main:app --port 8000
```

The API will be available at `http://localhost:8000` with interactive docs at `/docs`.

### Load Sample Data (Optional)

```bash
python sample_seed.py
```

## API Endpoints

### Employees
- `POST /employees` - Create employee
- `GET /employees` - List employees (supports filtering by department, pagination)

### Attendance
- `POST /attendance/punch-in` - Record punch-in
- `POST /attendance/punch-out` - Record punch-out
- `GET /attendance` - List attendance records (supports filtering by emp_code, date range, status)

### Analytics
- `GET /analytics/employees/{emp_code}/monthly` - Monthly attendance summary for employee
- `GET /analytics/departments/summary` - Department-level summary for a month
- `GET /analytics/leaderboard/late` - Late arrivals leaderboard
- `GET /analytics/departments/{department}/trend` - Department attendance trend over date range

### Health
- `GET /health` - Health check
- `GET /admin/explain/{endpoint}` - Query explanation

## Data Model

### Collections

**employees**
- `emp_code` (string, unique) - Employee ID (format: EMP followed by 4-6 digits)
- `name` (string) - Employee name
- `email` (string) - Email address
- `department` (string) - Department name
- `shift_start` (string) - Shift start time (HH:MM)
- `shift_end` (string) - Shift end time (HH:MM)
- `joined_on` (string) - Join date (YYYY-MM-DD)
- `created_at` (datetime) - Record creation timestamp

**attendance**
- `emp_code` (string) - Employee ID
- `date` (string) - Attendance date (YYYY-MM-DD)
- `status` (string) - Status (PRESENT, LEAVE, WFH, ON_DUTY)
- `punch_in` (datetime) - Punch-in timestamp
- `punch_out` (datetime) - Punch-out timestamp
- `work_hours` (float) - Total work hours
- `late_minutes` (integer) - Minutes late from shift start
- `overtime_minutes` (integer) - Overtime minutes
- `half_day` (boolean) - Half-day flag
- `history` (array) - Punch history

**audit_logs**
- Tracks all API operations for compliance

## Technical Details

### Timestamps
- All API timestamps are epoch milliseconds (integers)
- Invalid formats (seconds, floats, strings) return 422 error
- Internal storage uses UTC datetime objects
- IST (UTC+5:30) used for date calculations

### Indexing
- Indexes created automatically at startup
- `employees.emp_code` - unique, sparse
- `attendance.emp_code + date` - compound index
- `attendance.date + emp_code` - compound index for trend queries

### Database Connection
- Supports both local MongoDB and Atlas
- TLS verification enabled for Atlas
- Connection timeout: 5000ms (configurable via `MONGO_SERVER_SELECTION_TIMEOUT_MS`)
- Automatic retry on connection failure

### Pagination
- Default page size: 20
- Max page size: 100
- Supports `page` and `page_size` query parameters

## Implementation Notes

- Department trend endpoint uses Python-side date loop for gap filling (max 92 days)
- Late leaderboard uses standard competition ranking (1, 2, 2, 4)
- Half-up rounding applied to decimal calculations
- Punch-out must occur after punch-in
- Only one active punch-in per employee per day
- Static files served from `/static` directory

## Files

- `app/main.py` - FastAPI application and endpoints
- `sample_seed.py` - Sample data loader
- `requirements.txt` - Python dependencies
- `static/` - Frontend files (HTML, JS)
- `sample_data/` - Sample JSON data files
- `openapi.yaml` - OpenAPI specification
- `DATA_MODEL.md` - Detailed data model documentation
- `DECISIONS.md` - Architecture and design decisions
