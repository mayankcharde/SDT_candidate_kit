# DECISIONS.md

1. **Indexes.**
   - `employees.emp_code` (unique): enforces the one-employee-per-code rule and makes every employee lookup O(log n).
   - `attendance_logs.(emp_code, date)` (unique): enforces one record per employee per day and is the natural key for punch-in, punch-out and regularize lookups.
   - `attendance_logs.(date DESC, emp_code ASC)`: serves the `GET /attendance` sort without a collection scan.
   - `attendance_logs.emp_code`: serves the analytics aggregations that filter by employee.
   - Considered but rejected: a compound index on `(emp_code, date, status)` — the status filter is rare and the extra write overhead is not worth it.

2. **Punch-in race.**
   Two identical punch-in requests arrive at the same instant. Both pass the employee lookup. Both try `insert_one` with the same `(emp_code, date)`. Because the unique index on `(emp_code, date)` is enforced by MongoDB, exactly one insert succeeds; the other raises `DuplicateKeyError`, which the handler catches and returns 409. No application-level check-then-insert is needed.

3. **Ties.**
   If two employees share the same `total_late_minutes` at the cutoff, both get the same rank (standard competition ranking). The leaderboard returns every employee whose rank is <= `limit`, so the response may contain more than `limit` rows. Ranking is assigned in Python after sorting by `(total_late_minutes DESC, emp_code ASC)`, comparing each row's minutes to the previous row's to decide whether to advance the rank counter.

4. **Headcount.**
   The department summary pipeline starts from the `employees` collection (not `attendance_logs`) and uses `$lookup` to join logs. Every employee whose `joined_on` <= the last day of the month is included in the `$group` count, regardless of whether they have any log documents. Employees with zero logs simply contribute 0 to all the summed fields.

5. **One thing I would change for 100x the data.**
   Move the department summary and leaderboard aggregations to pre-computed daily/monthly rollup collections updated by a background job (or MongoDB Atlas triggers). At 10 million records a full-collection aggregation on every request becomes too slow even with indexes; materialised summaries reduce query time from seconds to milliseconds.
