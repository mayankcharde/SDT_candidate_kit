const API = '';

// ── Utilities ────────────────────────────────────────────────────────────────

function toast(msg, ok = true) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = ok ? '#166534' : '#991b1b';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function setAlert(id, msg, ok = false) {
  const el = document.getElementById(id);
  if (!msg) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="alert ${ok ? 'alert-success' : 'alert-error'}">${msg}</div>`;
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, detail: data.detail || JSON.stringify(data) };
  return data;
}

function msToLocal(ms) {
  if (ms == null) return '—';
  return new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
}

function localToMs(dtLocal) {
  if (!dtLocal) return undefined;
  return new Date(dtLocal).getTime();
}

function statusBadge(s) {
  const cls = { PRESENT: 'present', WFH: 'wfh', ON_DUTY: 'on_duty', ABSENT: 'absent', LEAVE: 'leave' };
  return `<span class="badge badge-${cls[s] || ''}">${s}</span>`;
}

function rankBadge(r) {
  const cls = r === 1 ? 'rank-1' : r === 2 ? 'rank-2' : r === 3 ? 'rank-3' : 'rank-n';
  return `<span class="rank-badge ${cls}">${r}</span>`;
}

function paginate(containerId, page, total, pageSize, loadFn) {
  const el = document.getElementById(containerId);
  const pages = Math.ceil(total / pageSize) || 1;
  el.innerHTML = `
    <button onclick="${loadFn}(${page - 1})" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
    <span>Page ${page} of ${pages} &nbsp;·&nbsp; ${total} total</span>
    <button onclick="${loadFn}(${page + 1})" ${page >= pages ? 'disabled' : ''}>Next ›</button>`;
}

// ── Nav ──────────────────────────────────────────────────────────────────────

function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('sec-' + name).classList.add('active');
  event.target.classList.add('active');
  if (name === 'employees') loadEmployees(1);
  if (name === 'attendance') loadAttendance(1);
}

// ── Health ───────────────────────────────────────────────────────────────────

async function checkHealth() {
  try {
    const d = await api('GET', '/health');
    document.getElementById('status-dot').className = 'ok';
    document.getElementById('db-status').textContent = 'MongoDB: connected';
  } catch {
    document.getElementById('db-status').textContent = 'MongoDB: unavailable';
  }
}

// ── Employees ────────────────────────────────────────────────────────────────

let empPage = 1;

async function loadEmployees(page) {
  empPage = page;
  const dept = document.getElementById('emp-filter-dept').value.trim();
  let qs = `?page=${page}&page_size=10`;
  if (dept) qs += `&department=${encodeURIComponent(dept)}`;
  const wrap = document.getElementById('emp-table-wrap');
  wrap.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const d = await api('GET', '/employees' + qs);
    if (!d.items.length) { wrap.innerHTML = '<div class="empty">No employees found.</div>'; paginate('emp-pagination', page, 0, 10, 'loadEmployees'); return; }
    wrap.innerHTML = `<table>
      <thead><tr><th>Code</th><th>Name</th><th>Email</th><th>Department</th><th>Shift</th><th>Joined</th><th>Created</th></tr></thead>
      <tbody>${d.items.map(e => `<tr>
        <td><strong>${e.emp_code}</strong></td>
        <td>${e.name}</td>
        <td>${e.email}</td>
        <td>${e.department}</td>
        <td>${e.shift_start} – ${e.shift_end}</td>
        <td>${e.joined_on}</td>
        <td style="font-size:.75rem;color:#94a3b8">${msToLocal(e.created_at)}</td>
      </tr>`).join('')}</tbody></table>`;
    paginate('emp-pagination', page, d.total, 10, 'loadEmployees');
  } catch (e) {
    wrap.innerHTML = `<div class="alert alert-error">${e.detail}</div>`;
  }
}

async function createEmployee() {
  setAlert('emp-alert', '');
  const body = {
    emp_code: document.getElementById('e-code').value.trim(),
    name: document.getElementById('e-name').value.trim(),
    email: document.getElementById('e-email').value.trim(),
    department: document.getElementById('e-dept').value.trim(),
    joined_on: document.getElementById('e-joined').value,
    shift_start: document.getElementById('e-sstart').value.trim() || '09:30',
    shift_end: document.getElementById('e-send').value.trim() || '18:30',
  };
  try {
    await api('POST', '/employees', body);
    setAlert('emp-alert', `Employee ${body.emp_code} created.`, true);
    toast(`${body.emp_code} added`);
    loadEmployees(1);
  } catch (e) {
    setAlert('emp-alert', e.detail || 'Error creating employee');
  }
}

// ── Punch In / Out ───────────────────────────────────────────────────────────

async function doPunchIn() {
  setAlert('pin-alert', '');
  const emp_code = document.getElementById('pin-code').value.trim();
  const status = document.getElementById('pin-status').value;
  const t = document.getElementById('pin-time').value;
  const body = { emp_code, status };
  if (t) body.punched_at = localToMs(t);
  try {
    const d = await api('POST', '/attendance/punch-in', body);
    setAlert('pin-alert', `Punched in: ${d.emp_code} on ${d.date} (${d.status})`, true);
    toast(`${emp_code} punched in`);
  } catch (e) {
    setAlert('pin-alert', `[${e.status}] ${Array.isArray(e.detail) ? e.detail.map(x => x.msg).join(', ') : e.detail}`);
  }
}

async function doPunchOut() {
  setAlert('pout-alert', '');
  const emp_code = document.getElementById('pout-code').value.trim();
  const t = document.getElementById('pout-time').value;
  const body = { emp_code };
  if (t) body.punched_at = localToMs(t);
  try {
    const d = await api('POST', '/attendance/punch-out', body);
    setAlert('pout-alert', `Punched out: ${d.emp_code} on ${d.date} — ${d.work_hours}h worked`, true);
    toast(`${emp_code} punched out`);
  } catch (e) {
    setAlert('pout-alert', `[${e.status}] ${Array.isArray(e.detail) ? e.detail.map(x => x.msg).join(', ') : e.detail}`);
  }
}

// ── Attendance Logs ──────────────────────────────────────────────────────────

let attPage = 1;

async function loadAttendance(page) {
  attPage = page;
  const emp = document.getElementById('att-emp').value.trim();
  const from = document.getElementById('att-from').value;
  const to = document.getElementById('att-to').value;
  const status = document.getElementById('att-status').value;
  let qs = `?page=${page}&page_size=15`;
  if (emp) qs += `&emp_code=${encodeURIComponent(emp)}`;
  if (from) qs += `&date_from=${from}`;
  if (to) qs += `&date_to=${to}`;
  if (status) qs += `&status=${status}`;
  const wrap = document.getElementById('att-table-wrap');
  wrap.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const d = await api('GET', '/attendance' + qs);
    if (!d.items.length) { wrap.innerHTML = '<div class="empty">No records found.</div>'; paginate('att-pagination', page, 0, 15, 'loadAttendance'); return; }
    wrap.innerHTML = `<table>
      <thead><tr><th>Code</th><th>Date</th><th>Status</th><th>Punch In</th><th>Punch Out</th><th>Hours</th><th>Late</th><th>OT</th><th>Half</th></tr></thead>
      <tbody>${d.items.map(r => `<tr>
        <td><strong>${r.emp_code}</strong></td>
        <td>${r.date}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="font-size:.78rem">${msToLocal(r.punch_in)}</td>
        <td style="font-size:.78rem">${msToLocal(r.punch_out)}</td>
        <td>${r.work_hours != null ? r.work_hours + 'h' : '—'}</td>
        <td>${r.late_minutes > 0 ? `<span style="color:#ef4444">${r.late_minutes}m</span>` : '0'}</td>
        <td>${r.overtime_minutes > 0 ? `<span style="color:#22c55e">${r.overtime_minutes}m</span>` : '0'}</td>
        <td>${r.half_day ? '✓' : ''}</td>
      </tr>`).join('')}</tbody></table>`;
    paginate('att-pagination', page, d.total, 15, 'loadAttendance');
  } catch (e) {
    wrap.innerHTML = `<div class="alert alert-error">${e.detail}</div>`;
  }
}

// ── Monthly Summary ──────────────────────────────────────────────────────────

async function loadMonthly() {
  const emp = document.getElementById('mon-emp').value.trim();
  const month = document.getElementById('mon-month').value;
  const el = document.getElementById('mon-result');
  if (!emp || !month) { el.innerHTML = '<div class="alert alert-error">Emp code and month required.</div>'; return; }
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const d = await api('GET', `/analytics/employees/${encodeURIComponent(emp)}/monthly?month=${month}`);
    const pct = d.attendance_pct != null ? d.attendance_pct + '%' : 'N/A';
    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-box"><div class="val">${d.working_days}</div><div class="lbl">Working Days</div></div>
        <div class="stat-box"><div class="val">${d.present_days}</div><div class="lbl">Present Days</div></div>
        <div class="stat-box"><div class="val">${d.leave_days}</div><div class="lbl">Leave Days</div></div>
        <div class="stat-box"><div class="val">${d.late_count}</div><div class="lbl">Late Count</div></div>
        <div class="stat-box"><div class="val">${d.total_late_minutes}</div><div class="lbl">Late Minutes</div></div>
        <div class="stat-box"><div class="val">${d.total_overtime_minutes}</div><div class="lbl">OT Minutes</div></div>
        <div class="stat-box"><div class="val" style="color:${d.attendance_pct >= 80 ? '#16a34a' : '#dc2626'}">${pct}</div><div class="lbl">Attendance %</div></div>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="alert alert-error">[${e.status}] ${e.detail}</div>`;
  }
}

// ── Department Summary ───────────────────────────────────────────────────────

async function loadDeptSummary() {
  const month = document.getElementById('ds-month').value;
  const dept = document.getElementById('ds-dept').value.trim();
  const el = document.getElementById('ds-result');
  if (!month) { el.innerHTML = '<div class="alert alert-error">Month required.</div>'; return; }
  let qs = `?month=${month}`;
  if (dept) qs += `&department=${encodeURIComponent(dept)}`;
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const d = await api('GET', '/analytics/departments/summary' + qs);
    if (!d.items.length) { el.innerHTML = '<div class="empty">No departments found.</div>'; return; }
    el.innerHTML = `<table>
      <thead><tr><th>Department</th><th>Headcount</th><th>Present Days</th><th>Avg Hours</th><th>Late Count</th><th>Late Mins</th><th>Leave</th><th>On Duty</th></tr></thead>
      <tbody>${d.items.map(r => `<tr>
        <td><strong>${r.department}</strong></td>
        <td>${r.headcount}</td>
        <td>${r.present_days}</td>
        <td>${r.avg_work_hours != null ? r.avg_work_hours + 'h' : '—'}</td>
        <td>${r.late_count}</td>
        <td>${r.total_late_minutes}</td>
        <td>${r.leave_count}</td>
        <td>${r.on_duty_count}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch (e) {
    el.innerHTML = `<div class="alert alert-error">[${e.status}] ${e.detail}</div>`;
  }
}

// ── Late Leaderboard ─────────────────────────────────────────────────────────

async function loadLeaderboard() {
  const month = document.getElementById('lb-month').value;
  const limit = document.getElementById('lb-limit').value || 10;
  const dept = document.getElementById('lb-dept').value.trim();
  const el = document.getElementById('lb-result');
  if (!month) { el.innerHTML = '<div class="alert alert-error">Month required.</div>'; return; }
  let qs = `?month=${month}&limit=${limit}`;
  if (dept) qs += `&department=${encodeURIComponent(dept)}`;
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const d = await api('GET', '/analytics/leaderboard/late' + qs);
    if (!d.items.length) { el.innerHTML = '<div class="empty">No late records this month.</div>'; return; }
    el.innerHTML = `<table>
      <thead><tr><th>Rank</th><th>Code</th><th>Name</th><th>Department</th><th>Late Count</th><th>Total Late Mins</th></tr></thead>
      <tbody>${d.items.map(r => `<tr>
        <td>${rankBadge(r.rank)}</td>
        <td><strong>${r.emp_code}</strong></td>
        <td>${r.name}</td>
        <td>${r.department}</td>
        <td>${r.late_count}</td>
        <td><strong style="color:#ef4444">${r.total_late_minutes}</strong></td>
      </tr>`).join('')}</tbody></table>`;
  } catch (e) {
    el.innerHTML = `<div class="alert alert-error">[${e.status}] ${e.detail}</div>`;
  }
}

// ── Department Trend ─────────────────────────────────────────────────────────

async function loadTrend() {
  const dept = document.getElementById('tr-dept').value.trim();
  const from = document.getElementById('tr-from').value;
  const to = document.getElementById('tr-to').value;
  const el = document.getElementById('tr-result');
  if (!dept || !from || !to) { el.innerHTML = '<div class="alert alert-error">Department, from and to required.</div>'; return; }
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const d = await api('GET', `/analytics/departments/${encodeURIComponent(dept)}/trend?from=${from}&to=${to}`);
    if (!d.items.length) { el.innerHTML = '<div class="empty">No data.</div>'; return; }
    const maxRate = Math.max(...d.items.map(r => r.attendance_rate || 0), 0.0001);
    el.innerHTML = `<table>
      <thead><tr><th>Date</th><th>Workday</th><th>Headcount</th><th>Present</th><th>Late</th><th>Rate</th><th>7d Avg</th><th>Bar</th></tr></thead>
      <tbody>${d.items.map(r => {
        const rate = r.attendance_rate != null ? (r.attendance_rate * 100).toFixed(1) + '%' : '—';
        const avg = r.moving_avg_7d != null ? (r.moving_avg_7d * 100).toFixed(1) + '%' : '—';
        const barW = r.attendance_rate != null ? Math.round((r.attendance_rate / maxRate) * 120) : 0;
        const barColor = r.attendance_rate >= 0.8 ? '#22c55e' : r.attendance_rate >= 0.5 ? '#f59e0b' : '#ef4444';
        return `<tr style="${!r.is_working_day ? 'opacity:.5' : ''}">
          <td>${r.date}</td>
          <td>${r.is_working_day ? '✓' : ''}</td>
          <td>${r.headcount}</td>
          <td>${r.present_count}</td>
          <td>${r.late_count}</td>
          <td>${rate}</td>
          <td>${avg}</td>
          <td>${barW > 0 ? `<span class="trend-bar" style="width:${barW}px;background:${barColor}"></span>` : ''}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  } catch (e) {
    el.innerHTML = `<div class="alert alert-error">[${e.status}] ${e.detail}</div>`;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

checkHealth();
setInterval(checkHealth, 30000);
loadEmployees(1);
