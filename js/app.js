/* =========================================================
   U.B. Jayasooriya Maha Vidyalaya — Grade Tracker
   Application logic
   ========================================================= */
(function () {
  "use strict";

  /* ---------- Constants ---------- */
  const STORAGE_KEY = "ubjmv_gradetracker_data_v1";
  const SCHOOL_NAME = "U.B. Jayasooriya Maha Vidyalaya";
  const GRADES = ["Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11"];
  const TERMS = ["Term 1", "Term 2", "Term 3"];
  const JUNIOR_SUBJECTS = ["Religion", "Sinhala Language", "English", "Mathematics", "Science", "History", "Geography", "Civics Education", "Second Language", "Health & Physical Education", "Aesthetic Subject", "Practical & Technical Skills"];
  const SENIOR_SUBJECTS = ["Religion", "Sinhala Language", "English", "Mathematics", "Science", "History", "Basket Subject 1", "Basket Subject 2", "Basket Subject 3"];

  const state = {
    view: "dashboard",
    reportsTab: "individual",
    selections: {} // scratch selections kept per view while navigating
  };

  /* ---------- Data layer ---------- */
  function buildDefaultData() {
    const grades = {};
    GRADES.forEach((g) => {
      const isSenior = g === "Grade 10" || g === "Grade 11";
      grades[g] = {
        classes: ["A"],
        subjects: isSenior ? [...SENIOR_SUBJECTS] : [...JUNIOR_SUBJECTS]
      };
    });
    return {
      meta: { schoolName: SCHOOL_NAME, version: 1 },
      grades,
      students: [],
      marks: {}
    };
  }

  let data = loadData();

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return buildDefaultData();
      const parsed = JSON.parse(raw);
      if (!parsed.grades || !parsed.students || !parsed.marks) return buildDefaultData();
      return parsed;
    } catch (e) {
      console.error("Failed to load data, resetting.", e);
      return buildDefaultData();
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error("Save failed", e);
      toast("Could not save — your browser storage may be full.", "error");
      return false;
    }
  }

  function uid(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- Calculation helpers ---------- */
  function clampMark(v) {
    if (v === "" || v === null || v === undefined) return null;
    let n = Number(v);
    if (isNaN(n)) return null;
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
  }

  function gradeLetter(avg) {
    if (avg === null || avg === undefined || isNaN(avg)) return null;
    if (avg >= 75) return "A";
    if (avg >= 65) return "B";
    if (avg >= 50) return "C";
    if (avg >= 35) return "S";
    return "W";
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function getStudentsFor(grade, cls) {
    return data.students.filter((s) => s.grade === grade && (!cls || cls === "__all__" ? true : s.cls === cls));
  }

  function studentMarks(studentId, term) {
    return (data.marks[studentId] && data.marks[studentId][term]) || {};
  }

  function computeStudentTermStats(studentId, grade, term) {
    const subjects = data.grades[grade].subjects;
    const marksObj = studentMarks(studentId, term);
    let total = 0, entered = 0;
    subjects.forEach((s) => {
      const v = marksObj[s];
      if (v !== undefined && v !== null && v !== "") {
        total += Number(v);
        entered++;
      }
    });
    const average = subjects.length > 0 ? total / subjects.length : 0;
    return { total, average, subjectsCount: subjects.length, entered };
  }

  function computeStudentOverallStats(studentId, grade) {
    let totalSum = 0;
    TERMS.forEach((t) => {
      totalSum += computeStudentTermStats(studentId, grade, t).total;
    });
    const subjectsCount = data.grades[grade].subjects.length;
    const denom = subjectsCount * TERMS.length;
    const average = denom > 0 ? totalSum / denom : 0;
    return { total: totalSum, average };
  }

  function assignRanks(rows, key) {
    const sorted = [...rows].sort((a, b) => b[key] - a[key]);
    let rank = 0, prevVal = null, pos = 0;
    sorted.forEach((r) => {
      pos++;
      if (r[key] !== prevVal) { rank = pos; prevVal = r[key]; }
      r.rank = rank;
    });
    return sorted;
  }

  function classRankingForTerm(grade, cls, term) {
    const students = getStudentsFor(grade, cls);
    const rows = students.map((st) => {
      const stats = computeStudentTermStats(st.id, grade, term);
      return { ...st, ...stats };
    });
    return assignRanks(rows, "total");
  }

  function classRankingOverall(grade, cls) {
    const students = getStudentsFor(grade, cls);
    const rows = students.map((st) => {
      const stats = computeStudentOverallStats(st.id, grade);
      return { ...st, ...stats };
    });
    return assignRanks(rows, "total");
  }

  /* ---------- Small utilities ---------- */
  function escapeHtml(str) {
    return String(str === undefined || str === null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function todayStr() {
    const d = new Date();
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  function toast(msg, type) {
    const region = document.getElementById("toast-region");
    const el = document.createElement("div");
    el.className = "toast" + (type === "error" ? " error" : "");
    el.textContent = msg;
    region.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function sealSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3L21 7.5L12 12L3 7.5L12 3Z" stroke="#E8A33D" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M6 10V15.5C6 15.5 8.5 17.5 12 17.5C15.5 17.5 18 15.5 18 15.5V10" stroke="#E8A33D" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M21 7.5V13.5" stroke="#E8A33D" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`;
  }

  /* ---------- Modal ---------- */
  function showModal({ title, bodyHtml, actions }) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal">
      <h3>${escapeHtml(title)}</h3>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-actions"></div>
    </div>`;
    const actionsEl = overlay.querySelector(".modal-actions");
    actions.forEach((a) => {
      const btn = document.createElement("button");
      btn.className = "btn " + (a.className || "btn-ghost");
      btn.textContent = a.label;
      btn.addEventListener("click", () => {
        if (a.onClick) a.onClick(overlay);
        if (a.close !== false) overlay.remove();
      });
      actionsEl.appendChild(btn);
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    return overlay;
  }

  function confirmModal(message, onConfirm, confirmLabel) {
    showModal({
      title: "Please confirm",
      bodyHtml: `<p style="margin:0;color:var(--ink-soft);">${escapeHtml(message)}</p>`,
      actions: [
        { label: "Cancel", className: "btn-ghost" },
        { label: confirmLabel || "Confirm", className: "btn-danger", onClick: onConfirm }
      ]
    });
  }

  /* ---------- Navigation / render ---------- */
  const TITLES = {
    dashboard: ["Overview", "Dashboard"],
    setup: ["Configuration", "Setup — Classes & Subjects"],
    students: ["Roster", "Students"],
    marks: ["Recording", "Marks Entry"],
    reports: ["Downloads", "Reports"],
    data: ["Safety", "Backup & Restore"]
  };

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    const [eyebrow, title] = TITLES[view];
    document.getElementById("topbar-eyebrow").textContent = eyebrow;
    document.getElementById("topbar-title").textContent = title;
    render();
  }

  function render() {
    const root = document.getElementById("view-root");
    const actions = document.getElementById("topbar-actions");
    actions.innerHTML = "";
    switch (state.view) {
      case "dashboard": root.innerHTML = renderDashboard(); break;
      case "setup": root.innerHTML = renderSetup(); attachSetupEvents(); break;
      case "students": root.innerHTML = renderStudents(); attachStudentsEvents(); break;
      case "marks": root.innerHTML = renderMarks(); attachMarksEvents(); break;
      case "reports": root.innerHTML = renderReports(); attachReportsEvents(); break;
      case "data": root.innerHTML = renderData(); attachDataEvents(); break;
    }
    if (state.view === "dashboard") attachDashboardEvents();
  }

  /* ========================================================
     DASHBOARD
     ======================================================== */
  function renderDashboard() {
    const totalStudents = data.students.length;
    const totalClasses = GRADES.reduce((sum, g) => sum + data.grades[g].classes.length, 0);
    const gradesWithStudents = new Set(data.students.map((s) => s.grade)).size;

    const rows = GRADES.map((g) => {
      const cls = data.grades[g].classes;
      const subjCount = data.grades[g].subjects.length;
      const stCount = data.students.filter((s) => s.grade === g).length;
      return `<tr>
        <td><b>${g}</b></td>
        <td>${cls.map((c) => `<span class="tag">${escapeHtml(c)}</span>`).join(" ") || "<span class=\"hint\">none yet</span>"}</td>
        <td>${subjCount} subjects</td>
        <td>${stCount} students</td>
      </tr>`;
    }).join("");

    return `
      <div class="grid-stats">
        <div class="stat"><div class="num">${totalStudents}</div><div class="label">Students</div></div>
        <div class="stat"><div class="num">${totalClasses}</div><div class="label">Classes</div></div>
        <div class="stat"><div class="num">${gradesWithStudents}/6</div><div class="label">Grades in use</div></div>
        <div class="stat"><div class="num">3</div><div class="label">Terms tracked</div></div>
      </div>

      <div class="card">
        <h2>Quick actions</h2>
        <p class="hint">Jump straight to the most common tasks.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-primary" data-goto="students">+ Add a student</button>
          <button class="btn btn-accent" data-goto="marks">Enter marks</button>
          <button class="btn btn-ghost" data-goto="reports">Download a report</button>
        </div>
      </div>

      <div class="card">
        <h2>Grades at a glance</h2>
        <p class="hint">Classes and subjects configured for each grade. Edit these under Setup.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Grade</th><th>Classes</th><th>Subjects</th><th>Students</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
    `;
  }

  function attachDashboardEvents() {
    document.querySelectorAll("[data-goto]").forEach((b) => {
      b.addEventListener("click", () => setView(b.dataset.goto));
    });
  }

  /* ========================================================
     SETUP
     ======================================================== */
  function renderSetup() {
    const cards = GRADES.map((g) => {
      const info = data.grades[g];
      const subjectTags = info.subjects.map((s) => `
        <span class="tag">${escapeHtml(s)} <button data-remove-subject="${g}||${escapeHtml(s)}" title="Remove subject">&times;</button></span>
      `).join("");
      const classTags = info.classes.map((c) => `
        <span class="tag">${escapeHtml(c)} <button data-remove-class="${g}||${escapeHtml(c)}" title="Remove class">&times;</button></span>
      `).join("");

      return `
      <div class="card">
        <h2>${g}</h2>
        <p class="hint">Manage the classes (sections) and subjects taught in this grade.</p>
        <div class="two-col">
          <div>
            <label style="font-size:0.8rem;font-weight:700;color:var(--ink-soft);">Classes</label>
            <div class="tag-row">${classTags || '<span class="hint">No classes yet</span>'}</div>
            <div class="inline-form" style="margin-top:12px;">
              <div class="field">
                <label>New class name</label>
                <input type="text" placeholder="e.g. A, B, Green" data-new-class="${g}">
              </div>
              <button class="btn btn-ghost btn-sm" data-add-class="${g}">+ Add class</button>
            </div>
          </div>
          <div>
            <label style="font-size:0.8rem;font-weight:700;color:var(--ink-soft);">Subjects</label>
            <div class="tag-row">${subjectTags}</div>
            <div class="inline-form" style="margin-top:12px;">
              <div class="field">
                <label>New subject name</label>
                <input type="text" placeholder="e.g. Information & Comm. Tech" data-new-subject="${g}">
              </div>
              <button class="btn btn-ghost btn-sm" data-add-subject="${g}">+ Add subject</button>
            </div>
          </div>
        </div>
        <hr class="divider">
        <button class="btn btn-sm btn-ghost" data-reset-subjects="${g}">Reset subjects to default list</button>
      </div>`;
    }).join("");

    return `<p class="hint" style="margin-bottom:18px;">Set up once per school year: which classes exist in each grade, and which subjects are taught. Everything below is fully editable.</p>${cards}`;
  }

  function attachSetupEvents() {
    document.querySelectorAll("[data-add-class]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = btn.dataset.addClass;
        const input = document.querySelector(`[data-new-class="${cssEscape(g)}"]`);
        const val = input.value.trim();
        if (!val) return toast("Enter a class name first.", "error");
        if (data.grades[g].classes.includes(val)) return toast("That class already exists.", "error");
        data.grades[g].classes.push(val);
        saveData(); render(); toast(`Added class ${val} to ${g}.`);
      });
    });
    document.querySelectorAll("[data-remove-class]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [g, c] = btn.dataset.removeClass.split("||");
        const studentsInClass = getStudentsFor(g, c).length;
        confirmModal(
          studentsInClass > 0
            ? `${studentsInClass} student(s) are in ${g} - ${c}. Remove this class anyway? Their records will remain but the class will no longer be listed.`
            : `Remove class "${c}" from ${g}?`,
          () => {
            data.grades[g].classes = data.grades[g].classes.filter((x) => x !== c);
            saveData(); render(); toast("Class removed.");
          },
          "Remove class"
        );
      });
    });
    document.querySelectorAll("[data-add-subject]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = btn.dataset.addSubject;
        const input = document.querySelector(`[data-new-subject="${cssEscape(g)}"]`);
        const val = input.value.trim();
        if (!val) return toast("Enter a subject name first.", "error");
        if (data.grades[g].subjects.includes(val)) return toast("That subject already exists.", "error");
        data.grades[g].subjects.push(val);
        saveData(); render(); toast(`Added ${val} to ${g}.`);
      });
    });
    document.querySelectorAll("[data-remove-subject]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [g, s] = btn.dataset.removeSubject.split("||");
        confirmModal(`Remove "${s}" from ${g}? Any marks already entered for this subject will no longer be shown.`, () => {
          data.grades[g].subjects = data.grades[g].subjects.filter((x) => x !== s);
          saveData(); render(); toast("Subject removed.");
        }, "Remove subject");
      });
    });
    document.querySelectorAll("[data-reset-subjects]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = btn.dataset.resetSubjects;
        const isSenior = g === "Grade 10" || g === "Grade 11";
        confirmModal(`Reset ${g} subjects to the default list? Custom subjects you added will be removed.`, () => {
          data.grades[g].subjects = isSenior ? [...SENIOR_SUBJECTS] : [...JUNIOR_SUBJECTS];
          saveData(); render(); toast("Subjects reset to default.");
        }, "Reset");
      });
    });
  }

  function cssEscape(s) {
    return String(s).replace(/"/g, '\\"');
  }

  /* ========================================================
     STUDENTS
     ======================================================== */
  function renderStudents() {
    const sel = state.selections.students || (state.selections.students = { grade: GRADES[0], cls: "__all__", q: "" });

    const classOptions = ["__all__", ...data.grades[sel.grade].classes]
      .map((c) => `<option value="${escapeHtml(c)}" ${c === sel.cls ? "selected" : ""}>${c === "__all__" ? "All classes" : c}</option>`).join("");

    let list = getStudentsFor(sel.grade, sel.cls === "__all__" ? null : sel.cls);
    if (sel.q) {
      const q = sel.q.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q) || (s.admissionNo || "").toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => a.name.localeCompare(b.name));

    const rows = list.map((s) => `
      <tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.admissionNo || "—")}</td>
        <td>${escapeHtml(s.cls)}</td>
        <td style="text-align:right;">
          <button class="btn btn-sm btn-ghost" data-edit-student="${s.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-delete-student="${s.id}">Delete</button>
        </td>
      </tr>
    `).join("");

    return `
      <div class="card">
        <h2>Add a student</h2>
        <p class="hint">New students are added to the grade and class you pick below.</p>
        <div class="field-row">
          <div class="field"><label>Full name</label><input type="text" id="new-student-name" placeholder="e.g. Nimal Perera"></div>
          <div class="field"><label>Admission no. (optional)</label><input type="text" id="new-student-admission" placeholder="e.g. 4521"></div>
          <div class="field"><label>Grade</label>
            <select id="new-student-grade">${GRADES.map((g) => `<option ${g === sel.grade ? "selected" : ""}>${g}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Class</label>
            <select id="new-student-class">${data.grades[sel.grade].classes.map((c) => `<option ${c === (sel.cls === "__all__" ? "" : sel.cls) ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
          </div>
        </div>
        <button class="btn btn-primary" id="add-student-btn">+ Add student</button>
        <button class="btn btn-ghost" id="add-multiple-btn" style="margin-left:8px;">+ Add several at once</button>
      </div>

      <div class="card">
        <h2>Student roster</h2>
        <div class="inline-form">
          <div class="field"><label>Grade</label>
            <select id="filter-grade">${GRADES.map((g) => `<option ${g === sel.grade ? "selected" : ""}>${g}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Class</label><select id="filter-class">${classOptions}</select></div>
          <div class="field"><label>Search</label><input type="text" id="filter-search" placeholder="Name or admission no." value="${escapeHtml(sel.q)}"></div>
        </div>
        ${list.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Admission No.</th><th>Class</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>` : `<div class="empty-state"><p>No students found for this grade/class yet.</p></div>`}
      </div>
    `;
  }

  function attachStudentsEvents() {
    const sel = state.selections.students;
    const gradeSel = document.getElementById("filter-grade");
    const classSel = document.getElementById("filter-class");
    const searchInput = document.getElementById("filter-search");

    gradeSel.addEventListener("change", () => { sel.grade = gradeSel.value; sel.cls = "__all__"; render(); });
    classSel.addEventListener("change", () => { sel.cls = classSel.value; render(); });
    searchInput.addEventListener("input", () => { sel.q = searchInput.value; render(); });
    searchInput.focus(); searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);

    document.getElementById("new-student-grade").addEventListener("change", (e) => {
      // refresh class options for the add-student form
      const g = e.target.value;
      const classSelect = document.getElementById("new-student-class");
      classSelect.innerHTML = data.grades[g].classes.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
    });

    document.getElementById("add-student-btn").addEventListener("click", () => {
      const name = document.getElementById("new-student-name").value.trim();
      const admissionNo = document.getElementById("new-student-admission").value.trim();
      const grade = document.getElementById("new-student-grade").value;
      const cls = document.getElementById("new-student-class").value;
      if (!name) return toast("Enter the student's name.", "error");
      if (!cls) return toast("Add a class to this grade first (see Setup).", "error");
      data.students.push({ id: uid("st"), name, admissionNo, grade, cls });
      saveData();
      sel.grade = grade; sel.cls = cls;
      render();
      toast(`Added ${name}.`);
    });

    document.getElementById("add-multiple-btn").addEventListener("click", () => {
      const grade = document.getElementById("new-student-grade").value;
      const cls = document.getElementById("new-student-class").value;
      showModal({
        title: `Add several students to ${grade} - ${cls}`,
        bodyHtml: `<p class="hint">One name per line.</p><textarea id="bulk-names" rows="8" style="width:100%;padding:9px;border:1px solid var(--border);border-radius:8px;" placeholder="Kasun Silva\nAmaya Fernando\nSachini Jayawardena"></textarea>`,
        actions: [
          { label: "Cancel", className: "btn-ghost" },
          {
            label: "Add all", className: "btn-primary", close: true, onClick: () => {
              const raw = document.getElementById("bulk-names").value;
              const names = raw.split("\n").map((n) => n.trim()).filter(Boolean);
              if (!names.length) return;
              names.forEach((name) => data.students.push({ id: uid("st"), name, admissionNo: "", grade, cls }));
              saveData();
              sel.grade = grade; sel.cls = cls;
              render();
              toast(`Added ${names.length} student(s).`);
            }
          }
        ]
      });
    });

    document.querySelectorAll("[data-edit-student]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const st = data.students.find((s) => s.id === btn.dataset.editStudent);
        showModal({
          title: "Edit student",
          bodyHtml: `
            <div class="field"><label>Full name</label><input type="text" id="edit-name" value="${escapeHtml(st.name)}"></div>
            <div class="field"><label>Admission no.</label><input type="text" id="edit-admission" value="${escapeHtml(st.admissionNo || "")}"></div>
            <div class="field"><label>Grade</label><select id="edit-grade">${GRADES.map((g) => `<option ${g === st.grade ? "selected" : ""}>${g}</option>`).join("")}</select></div>
            <div class="field"><label>Class</label><select id="edit-class">${data.grades[st.grade].classes.map((c) => `<option ${c === st.cls ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select></div>
          `,
          actions: [
            { label: "Cancel", className: "btn-ghost" },
            {
              label: "Save changes", className: "btn-primary", onClick: () => {
                st.name = document.getElementById("edit-name").value.trim() || st.name;
                st.admissionNo = document.getElementById("edit-admission").value.trim();
                st.grade = document.getElementById("edit-grade").value;
                st.cls = document.getElementById("edit-class").value;
                saveData(); render(); toast("Student updated.");
              }
            }
          ]
        });
        // refresh class list when grade changes inside modal
        document.getElementById("edit-grade").addEventListener("change", (e) => {
          const classSelect = document.getElementById("edit-class");
          classSelect.innerHTML = data.grades[e.target.value].classes.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
        });
      });
    });

    document.querySelectorAll("[data-delete-student]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const st = data.students.find((s) => s.id === btn.dataset.deleteStudent);
        confirmModal(`Delete ${st.name} and all of their recorded marks? This cannot be undone.`, () => {
          data.students = data.students.filter((s) => s.id !== st.id);
          delete data.marks[st.id];
          saveData(); render(); toast("Student deleted.");
        }, "Delete student");
      });
    });
  }

  /* ========================================================
     MARKS ENTRY
     ======================================================== */
  function renderMarks() {
    const sel = state.selections.marks || (state.selections.marks = { grade: GRADES[0], cls: data.grades[GRADES[0]].classes[0] || "", term: TERMS[0] });
    if (!data.grades[sel.grade].classes.includes(sel.cls)) sel.cls = data.grades[sel.grade].classes[0] || "";

    const subjects = data.grades[sel.grade].subjects;
    const students = [...getStudentsFor(sel.grade, sel.cls)].sort((a, b) => a.name.localeCompare(b.name));

    const classOptions = data.grades[sel.grade].classes.map((c) => `<option ${c === sel.cls ? "selected" : ""}>${escapeHtml(c)}</option>`).join("");

    if (!sel.cls) {
      return `
        <div class="inline-form">
          <div class="field"><label>Grade</label><select id="marks-grade">${GRADES.map((g) => `<option ${g === sel.grade ? "selected" : ""}>${g}</option>`).join("")}</select></div>
        </div>
        <div class="empty-state"><p>No classes set up for ${sel.grade} yet. Add one under Setup first.</p></div>`;
    }

    if (!subjects.length) {
      return `<div class="empty-state"><p>No subjects configured for ${sel.grade}. Add subjects under Setup first.</p></div>`;
    }

    const headerCells = subjects.map((s) => `<th style="min-width:88px;">${escapeHtml(s)}</th>`).join("");

    const rows = students.map((st) => {
      const marksObj = studentMarks(st.id, sel.term);
      const cells = subjects.map((subj) => {
        const v = marksObj[subj];
        return `<td><input type="number" min="0" max="100" class="mark-input" data-student="${st.id}" data-subject="${escapeHtml(subj)}" value="${v !== undefined && v !== null ? v : ""}"></td>`;
      }).join("");
      const stats = computeStudentTermStats(st.id, sel.grade, sel.term);
      const g = stats.entered > 0 ? gradeLetter(stats.average) : null;
      return `<tr data-row-student="${st.id}">
        <td>${escapeHtml(st.name)}</td>
        ${cells}
        <td class="cell-total" style="font-weight:700;">${stats.total}</td>
        <td class="cell-avg">${round1(stats.average)}%</td>
        <td class="cell-grade">${g ? `<span class="badge-grade badge-${g}">${g}</span>` : "—"}</td>
      </tr>`;
    }).join("");

    return `
      <div class="inline-form">
        <div class="field"><label>Grade</label><select id="marks-grade">${GRADES.map((g) => `<option ${g === sel.grade ? "selected" : ""}>${g}</option>`).join("")}</select></div>
        <div class="field"><label>Class</label><select id="marks-class">${classOptions}</select></div>
        <div class="field"><label>Term</label><select id="marks-term">${TERMS.map((t) => `<option ${t === sel.term ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      </div>
      <p class="hint">Marks are out of 100 and save automatically as you type. Blank cells count as 0 in the total.</p>
      ${students.length ? `<div class="table-wrap"><table>
        <thead><tr><th style="min-width:140px;">Student</th>${headerCells}<th>Total</th><th>Average</th><th>Grade</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : `<div class="empty-state"><p>No students in ${sel.grade} - ${sel.cls} yet. Add students first.</p></div>`}
    `;
  }

  function attachMarksEvents() {
    const sel = state.selections.marks;
    document.getElementById("marks-grade").addEventListener("change", (e) => {
      sel.grade = e.target.value;
      sel.cls = data.grades[sel.grade].classes[0] || "";
      render();
    });
    const classSelect = document.getElementById("marks-class");
    if (classSelect) classSelect.addEventListener("change", (e) => { sel.cls = e.target.value; render(); });
    const termSelect = document.getElementById("marks-term");
    if (termSelect) termSelect.addEventListener("change", (e) => { sel.term = e.target.value; render(); });

    document.querySelectorAll(".mark-input").forEach((input) => {
      input.addEventListener("change", () => {
        const studentId = input.dataset.student;
        const subject = input.dataset.subject;
        const val = clampMark(input.value);
        input.value = val === null ? "" : val;
        if (!data.marks[studentId]) data.marks[studentId] = {};
        if (!data.marks[studentId][sel.term]) data.marks[studentId][sel.term] = {};
        if (val === null) delete data.marks[studentId][sel.term][subject];
        else data.marks[studentId][sel.term][subject] = val;
        saveData();
        updateRowStats(studentId);
      });
    });
  }

  function updateRowStats(studentId) {
    const sel = state.selections.marks;
    const row = document.querySelector(`tr[data-row-student="${studentId}"]`);
    if (!row) return;
    const stats = computeStudentTermStats(studentId, sel.grade, sel.term);
    const g = stats.entered > 0 ? gradeLetter(stats.average) : null;
    row.querySelector(".cell-total").textContent = stats.total;
    row.querySelector(".cell-avg").textContent = round1(stats.average) + "%";
    row.querySelector(".cell-grade").innerHTML = g ? `<span class="badge-grade badge-${g}">${g}</span>` : "—";
  }

  /* ========================================================
     REPORTS
     ======================================================== */
  function renderReports() {
    const tab = state.reportsTab;
    const selInd = state.selections.reportInd || (state.selections.reportInd = { grade: GRADES[0], cls: "", studentId: "" });
    const selCls = state.selections.reportCls || (state.selections.reportCls = { grade: GRADES[0], cls: "", term: TERMS[0] });

    if (!selInd.cls || !data.grades[selInd.grade].classes.includes(selInd.cls)) selInd.cls = data.grades[selInd.grade].classes[0] || "";
    if (!selCls.cls || !data.grades[selCls.grade].classes.includes(selCls.cls)) selCls.cls = data.grades[selCls.grade].classes[0] || "";

    const tabs = `<div class="pill-tabs">
      <button data-tab="individual" class="${tab === "individual" ? "active" : ""}">Individual student</button>
      <button data-tab="class" class="${tab === "class" ? "active" : ""}">Whole class</button>
    </div>`;

    if (tab === "individual") {
      const studentsInClass = [...getStudentsFor(selInd.grade, selInd.cls)].sort((a, b) => a.name.localeCompare(b.name));
      if (!selInd.studentId && studentsInClass.length) selInd.studentId = studentsInClass[0].id;

      return `${tabs}
        <div class="card">
          <h2>Individual student report</h2>
          <p class="hint">Shows subject-wise marks for all three terms, plus totals, averages and class rank.</p>
          <div class="report-toolbar">
            <div class="field"><label>Grade</label><select id="rep-ind-grade">${GRADES.map((g) => `<option ${g === selInd.grade ? "selected" : ""}>${g}</option>`).join("")}</select></div>
            <div class="field"><label>Class</label><select id="rep-ind-class">${data.grades[selInd.grade].classes.map((c) => `<option ${c === selInd.cls ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select></div>
            <div class="field"><label>Student</label><select id="rep-ind-student">${studentsInClass.map((s) => `<option value="${s.id}" ${s.id === selInd.studentId ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select></div>
            <button class="btn btn-accent" id="rep-ind-download" ${!selInd.studentId ? "disabled" : ""}>⬇ Download PDF report</button>
          </div>
          ${selInd.studentId ? `<div id="rep-ind-preview">${buildStudentReportHtml(selInd.studentId, false)}</div>` : `<div class="empty-state"><p>No students in this class yet.</p></div>`}
        </div>`;
    }

    const studentsForClassReport = getStudentsFor(selCls.grade, selCls.cls);
    return `${tabs}
      <div class="card">
        <h2>Whole class report</h2>
        <p class="hint">Every student's subject marks side by side, with totals, averages and rank for the chosen term.</p>
        <div class="report-toolbar">
          <div class="field"><label>Grade</label><select id="rep-cls-grade">${GRADES.map((g) => `<option ${g === selCls.grade ? "selected" : ""}>${g}</option>`).join("")}</select></div>
          <div class="field"><label>Class</label><select id="rep-cls-class">${data.grades[selCls.grade].classes.map((c) => `<option ${c === selCls.cls ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select></div>
          <div class="field"><label>Term</label><select id="rep-cls-term">${TERMS.map((t) => `<option ${t === selCls.term ? "selected" : ""}>${t}</option>`).join("")}<option value="ALL" ${selCls.term === "ALL" ? "selected" : ""}>All terms (summary)</option></select></div>
          <button class="btn btn-accent" id="rep-cls-download" ${!studentsForClassReport.length ? "disabled" : ""}>⬇ Download PDF report</button>
        </div>
        <div id="rep-cls-preview">${buildClassReportHtml(selCls.grade, selCls.cls, selCls.term, false)}</div>
      </div>`;
  }

  function attachReportsEvents() {
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => { state.reportsTab = btn.dataset.tab; render(); });
    });

    if (state.reportsTab === "individual") {
      const selInd = state.selections.reportInd;
      document.getElementById("rep-ind-grade").addEventListener("change", (e) => {
        selInd.grade = e.target.value; selInd.cls = data.grades[selInd.grade].classes[0] || ""; selInd.studentId = ""; render();
      });
      document.getElementById("rep-ind-class").addEventListener("change", (e) => {
        selInd.cls = e.target.value; selInd.studentId = ""; render();
      });
      const studentSelect = document.getElementById("rep-ind-student");
      if (studentSelect) studentSelect.addEventListener("change", (e) => { selInd.studentId = e.target.value; render(); });
      const dl = document.getElementById("rep-ind-download");
      if (dl) dl.addEventListener("click", () => generateStudentReportPdf(selInd.studentId));
    } else {
      const selCls = state.selections.reportCls;
      document.getElementById("rep-cls-grade").addEventListener("change", (e) => {
        selCls.grade = e.target.value; selCls.cls = data.grades[selCls.grade].classes[0] || ""; render();
      });
      document.getElementById("rep-cls-class").addEventListener("change", (e) => { selCls.cls = e.target.value; render(); });
      document.getElementById("rep-cls-term").addEventListener("change", (e) => { selCls.term = e.target.value; render(); });
      const dl = document.getElementById("rep-cls-download");
      if (dl) dl.addEventListener("click", () => generateClassReportPdf(selCls.grade, selCls.cls, selCls.term));
    }
  }

  function buildStudentReportHtml(studentId, forPrint) {
    const st = data.students.find((s) => s.id === studentId);
    if (!st) return `<div class="empty-state"><p>Select a student to preview their report.</p></div>`;
    const subjects = data.grades[st.grade].subjects;
    const ranking = classRankingOverall(st.grade, st.cls);
    const overallRankRow = ranking.find((r) => r.id === studentId);
    const overall = computeStudentOverallStats(studentId, st.grade);

    const termStats = TERMS.map((t) => computeStudentTermStats(studentId, st.grade, t));
    const termRankings = TERMS.map((t) => classRankingForTerm(st.grade, st.cls, t));

    const subjectRows = subjects.map((subj) => {
      const marksByTerm = TERMS.map((t) => studentMarks(studentId, t)[subj]);
      const validMarks = marksByTerm.filter((v) => v !== undefined && v !== null && v !== "");
      const subjAvg = validMarks.length ? validMarks.reduce((a, b) => a + Number(b), 0) / validMarks.length : null;
      const g = gradeLetter(subjAvg);
      return `<tr>
        <td>${escapeHtml(subj)}</td>
        ${marksByTerm.map((v) => `<td style="text-align:center;">${v !== undefined && v !== null && v !== "" ? v : "—"}</td>`).join("")}
        <td style="text-align:center;font-weight:700;">${subjAvg !== null ? round1(subjAvg) : "—"}</td>
        <td style="text-align:center;">${g ? `<span class="badge-grade badge-${g}">${g}</span>` : "—"}</td>
      </tr>`;
    }).join("");

    const termSummary = TERMS.map((t, i) => {
      const stat = termStats[i];
      const rankRow = termRankings[i].find((r) => r.id === studentId);
      return `<div class="summary-box">
        <div class="val">${stat.total}</div>
        <div class="lbl">${t} total</div>
        <div style="font-size:0.72rem;color:var(--muted);margin-top:2px;">Rank ${rankRow ? rankRow.rank : "—"} / ${termRankings[i].length}</div>
      </div>`;
    }).join("");

    return `
      <div class="report-preview">
        <div class="report-head">
          <div class="seal">${sealSvg()}</div>
          <div>
            <h2>${escapeHtml(SCHOOL_NAME)}</h2>
            <div class="meta">Student Progress Report · Generated ${todayStr()}</div>
          </div>
        </div>
        <div class="report-grid">
          <div>Name<br><b>${escapeHtml(st.name)}</b></div>
          <div>Admission No.<br><b>${escapeHtml(st.admissionNo || "—")}</b></div>
          <div>Grade<br><b>${escapeHtml(st.grade)}</b></div>
          <div>Class<br><b>${escapeHtml(st.cls)}</b></div>
        </div>

        <div class="table-wrap"><table>
          <thead><tr><th>Subject</th>${TERMS.map((t) => `<th style="text-align:center;">${t}</th>`).join("")}<th style="text-align:center;">Avg.</th><th style="text-align:center;">Grade</th></tr></thead>
          <tbody>${subjectRows}</tbody>
        </table></div>

        <div class="report-summary">${termSummary}
          <div class="summary-box" style="background:var(--accent-soft);">
            <div class="val">${round1(overall.average)}%</div>
            <div class="lbl">Overall average</div>
            <div style="font-size:0.72rem;color:var(--primary-dark);margin-top:2px;">Overall rank ${overallRankRow ? overallRankRow.rank : "—"} / ${ranking.length}</div>
          </div>
        </div>
        ${forPrint ? `<p style="margin-top:22px;font-size:0.72rem;color:var(--muted);">Unmarked subjects are counted as 0 towards totals. Grade bands: A ≥75, B ≥65, C ≥50, S ≥35, W &lt;35.</p>` : ""}
      </div>
    `;
  }

  function buildClassReportHtml(grade, cls, term, forPrint) {
    const students = getStudentsFor(grade, cls);
    if (!students.length) return `<div class="empty-state"><p>No students in this class yet.</p></div>`;
    const subjects = data.grades[grade].subjects;

    if (term === "ALL") {
      const ranking = classRankingOverall(grade, cls);
      const rows = ranking.map((r) => `<tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.admissionNo || "—")}</td>
        <td style="text-align:center;">${r.total}</td>
        <td style="text-align:center;">${round1(r.average)}%</td>
        <td style="text-align:center;"><span class="badge-grade badge-${gradeLetter(r.average) || "W"}">${gradeLetter(r.average) || "—"}</span></td>
        <td style="text-align:center;font-weight:700;">${r.rank}</td>
      </tr>`).join("");
      return `
        <div class="report-preview" style="max-width:100%;">
          <div class="report-head">
            <div class="seal">${sealSvg()}</div>
            <div><h2>${escapeHtml(SCHOOL_NAME)}</h2><div class="meta">Class Summary — ${escapeHtml(grade)} / ${escapeHtml(cls)} · All 3 Terms · Generated ${todayStr()}</div></div>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Student</th><th>Admission No.</th><th>Total (3 terms)</th><th>Overall Avg.</th><th>Grade</th><th>Rank</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
          ${forPrint ? `<p style="margin-top:18px;font-size:0.72rem;color:var(--muted);">Total is the sum of term totals across ${subjects.length} subject(s) x 3 terms. Unmarked subjects count as 0.</p>` : ""}
        </div>`;
    }

    const ranking = classRankingForTerm(grade, cls, term);

    // Total columns = student name + one per subject + total + average + rank.
    // For print we force the table to a fixed layout that always sums to 100%
    // of the page width, so columns shrink to fit instead of being clipped
    // off the right edge when there are many subjects.
    const totalCols = 1 + subjects.length + 3;
    let printFontSize = "0.82rem", printPad = "8px 9px";
    if (forPrint) {
      if (totalCols > 15) { printFontSize = "6.6px"; printPad = "3px 3px"; }
      else if (totalCols > 12) { printFontSize = "7.5px"; printPad = "3px 4px"; }
      else if (totalCols > 9) { printFontSize = "8.5px"; printPad = "4px 5px"; }
      else { printFontSize = "9.5px"; printPad = "5px 6px"; }
    }
    const studentColPct = Math.max(10, Math.min(16, 100 / totalCols + 6));
    const otherColPct = (100 - studentColPct) / (totalCols - 1);
    const printTableStyle = forPrint
      ? `style="table-layout:fixed;width:100%;font-size:${printFontSize};"`
      : "";
    const studentColStyle = forPrint ? `style="width:${studentColPct}%;padding:${printPad};word-break:break-word;"` : "";
    const otherColStyle = forPrint ? `style="width:${otherColPct}%;padding:${printPad};word-break:break-word;text-align:center;"` : "";

    const rowsHtml = ranking.map((r) => {
      const marksObj = studentMarks(r.id, term);
      const cells = subjects.map((subj) => {
        const v = marksObj[subj];
        return `<td ${otherColStyle}>${v !== undefined && v !== null && v !== "" ? v : "—"}</td>`;
      }).join("");
      return `<tr>
        <td ${studentColStyle}>${escapeHtml(r.name)}</td>
        ${cells}
        <td ${otherColStyle}><b>${r.total}</b></td>
        <td ${otherColStyle}>${round1(r.average)}%</td>
        <td ${otherColStyle}><b>${r.rank}</b></td>
      </tr>`;
    }).join("");

    return `
      <div class="report-preview" style="max-width:100%;">
        <div class="report-head">
          <div class="seal">${sealSvg()}</div>
          <div><h2>${escapeHtml(SCHOOL_NAME)}</h2><div class="meta">Class Marksheet — ${escapeHtml(grade)} / ${escapeHtml(cls)} · ${escapeHtml(term)} · Generated ${todayStr()}</div></div>
        </div>
        <div class="table-wrap"><table ${printTableStyle}>
          <thead><tr><th ${studentColStyle || 'style="text-align:left;"'}>Student</th>${subjects.map((s) => `<th ${otherColStyle}>${escapeHtml(s)}</th>`).join("")}<th ${otherColStyle}>Total</th><th ${otherColStyle}>Average</th><th ${otherColStyle}>Rank</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>
        ${forPrint ? `<p style="margin-top:18px;font-size:0.72rem;color:var(--muted);">Blank cells mean no mark recorded (counted as 0 in the total).</p>` : ""}
      </div>`;
  }

  const BRAND_TEAL = [21, 74, 70];
  const BRAND_INK = [22, 48, 44];
  const BRAND_MUTED = [108, 134, 129];
  const BRAND_STRIPE = [240, 246, 244];

  function getPdfLib() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      toast("PDF tools haven't finished loading yet — please check your connection and try again in a moment.", "error");
      return null;
    }
    return window.jspdf.jsPDF;
  }

  function safeFileToken(str) {
    return String(str).trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  }

  function pdfHeader(doc, subtitle) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...BRAND_INK);
    doc.text(SCHOOL_NAME, 14, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...BRAND_MUTED);
    doc.text(subtitle, 14, 22);
    doc.setDrawColor(...BRAND_TEAL);
    doc.setLineWidth(0.6);
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.line(14, 26, pageWidth - 14, 26);
  }

  function generateStudentReportPdf(studentId) {
    const jsPDFCtor = getPdfLib();
    if (!jsPDFCtor) return;
    const st = data.students.find((s) => s.id === studentId);
    if (!st) return toast("Select a student first.", "error");

    const subjects = data.grades[st.grade].subjects;
    const ranking = classRankingOverall(st.grade, st.cls);
    const overallRankRow = ranking.find((r) => r.id === studentId);
    const overall = computeStudentOverallStats(studentId, st.grade);
    const termStats = TERMS.map((t) => computeStudentTermStats(studentId, st.grade, t));
    const termRankings = TERMS.map((t) => classRankingForTerm(st.grade, st.cls, t));

    const body = subjects.map((subj) => {
      const marksByTerm = TERMS.map((t) => studentMarks(studentId, t)[subj]);
      const validMarks = marksByTerm.filter((v) => v !== undefined && v !== null && v !== "");
      const subjAvg = validMarks.length ? validMarks.reduce((a, b) => a + Number(b), 0) / validMarks.length : null;
      const g = gradeLetter(subjAvg);
      return [
        subj,
        ...marksByTerm.map((v) => (v !== undefined && v !== null && v !== "" ? String(v) : "—")),
        subjAvg !== null ? String(round1(subjAvg)) : "—",
        g || "—"
      ];
    });

    const doc = new jsPDFCtor({ orientation: "portrait", unit: "mm", format: "a4" });
    pdfHeader(doc, `Student Progress Report · Generated ${todayStr()}`);

    doc.setFontSize(10);
    doc.setTextColor(...BRAND_INK);
    doc.setFont("helvetica", "bold");
    doc.text(st.name, 14, 34);
    doc.setFont("helvetica", "normal");
    doc.text(`Admission No.: ${st.admissionNo || "—"}`, 14, 40);
    doc.text(`${st.grade}  ·  Class ${st.cls}`, 110, 40);

    doc.autoTable({
      startY: 46,
      head: [["Subject", "Term 1", "Term 2", "Term 3", "Avg.", "Grade"]],
      body,
      theme: "grid",
      styles: { fontSize: 9.5, cellPadding: 2.4, textColor: BRAND_INK },
      headStyles: { fillColor: BRAND_TEAL, textColor: 255, fontSize: 9.5 },
      alternateRowStyles: { fillColor: BRAND_STRIPE },
      columnStyles: { 0: { halign: "left" }, 1: { halign: "center" }, 2: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "center", fontStyle: "bold" }, 5: { halign: "center" } }
    });

    let y = doc.lastAutoTable.finalY + 9;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...BRAND_TEAL);
    doc.text("Term summary", 14, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BRAND_INK);
    TERMS.forEach((t, i) => {
      const rankRow = termRankings[i].find((r) => r.id === studentId);
      doc.text(`${t}:  Total ${termStats[i].total}  ·  Rank ${rankRow ? rankRow.rank : "—"} / ${termRankings[i].length}`, 14, y);
      y += 6;
    });
    doc.setFont("helvetica", "bold");
    doc.text(`Overall average: ${round1(overall.average)}%  ·  Overall rank ${overallRankRow ? overallRankRow.rank : "—"} / ${ranking.length}`, 14, y + 2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND_MUTED);
    doc.text("Unmarked subjects are counted as 0 towards totals. Grade bands: A \u226575, B \u226565, C \u226550, S \u226535, W <35.", 14, y + 10);

    const filename = `${safeFileToken(st.name)}_${safeFileToken(st.grade)}_${safeFileToken(st.cls)}_Report.pdf`;
    doc.save(filename);
    toast("Report downloaded.");
  }

  function generateClassReportPdf(grade, cls, term) {
    const jsPDFCtor = getPdfLib();
    if (!jsPDFCtor) return;
    const students = getStudentsFor(grade, cls);
    if (!students.length) return toast("No students in this class yet.", "error");
    const subjects = data.grades[grade].subjects;

    const doc = new jsPDFCtor({ orientation: "landscape", unit: "mm", format: "a4" });
    const isAll = term === "ALL";
    pdfHeader(doc, `${isAll ? "Class Summary — All 3 Terms" : `Class Marksheet — ${term}`} · ${grade} / ${cls} · Generated ${todayStr()}`);

    let head, body, columnStyles;
    if (isAll) {
      const ranking = classRankingOverall(grade, cls);
      head = [["Student", "Admission No.", "Total (3 terms)", "Overall Avg.", "Grade", "Rank"]];
      body = ranking.map((r) => [r.name, r.admissionNo || "—", String(r.total), round1(r.average) + "%", gradeLetter(r.average) || "—", String(r.rank)]);
      columnStyles = { 0: { halign: "left" } };
    } else {
      const ranking = classRankingForTerm(grade, cls, term);
      head = [["Student", ...subjects, "Total", "Average", "Rank"]];
      body = ranking.map((r) => {
        const marksObj = studentMarks(r.id, term);
        const cells = subjects.map((subj) => {
          const v = marksObj[subj];
          return v !== undefined && v !== null && v !== "" ? String(v) : "—";
        });
        return [r.name, ...cells, String(r.total), round1(r.average) + "%", String(r.rank)];
      });
      columnStyles = { 0: { halign: "left" } };
    }

    const colCount = head[0].length;
    const fontSize = colCount > 16 ? 6.5 : colCount > 13 ? 7.2 : colCount > 10 ? 8 : 9;

    doc.autoTable({
      startY: 32,
      head, body, columnStyles,
      theme: "grid",
      styles: { fontSize, cellPadding: 1.8, textColor: BRAND_INK, halign: "center", overflow: "linebreak" },
      headStyles: { fillColor: BRAND_TEAL, textColor: 255, fontSize: Math.min(fontSize + 0.4, 8) },
      alternateRowStyles: { fillColor: BRAND_STRIPE },
      margin: { left: 10, right: 10 }
    });

    const y = doc.lastAutoTable.finalY + 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND_MUTED);
    doc.text(isAll
      ? `Total is the sum of term totals across ${subjects.length} subject(s) x 3 terms. Unmarked subjects count as 0.`
      : "Blank cells mean no mark recorded (counted as 0 in the total).", 14, y);

    const filename = `${safeFileToken(grade)}_${safeFileToken(cls)}_${isAll ? "AllTerms" : safeFileToken(term)}_ClassReport.pdf`;
    doc.save(filename);
    toast("Report downloaded.");
  }

  /* ========================================================
     DATA / BACKUP
     ======================================================== */
  function renderData() {
    return `
      <div class="card">
        <h2>Export a backup</h2>
        <p class="hint">Saves every grade, class, subject, student and mark into one file you can keep safe or move to another computer.</p>
        <button class="btn btn-primary" id="export-btn">⬇ Download backup (.json)</button>
      </div>
      <div class="card">
        <h2>Restore from a backup</h2>
        <p class="hint">Choose a previously exported file to replace everything currently stored here.</p>
        <input type="file" id="import-file" accept="application/json">
      </div>
      <div class="card">
        <h2>Start over</h2>
        <p class="hint">Permanently erase all classes, students and marks stored on this device.</p>
        <button class="btn btn-danger" id="reset-btn">Erase all data</button>
      </div>
    `;
  }

  function attachDataEvents() {
    document.getElementById("export-btn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `ubjmv-grade-tracker-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("Backup downloaded.");
    });

    document.getElementById("import-file").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!parsed.grades || !parsed.students || !parsed.marks) throw new Error("Invalid file");
          confirmModal("This will replace all current data with the contents of this backup. Continue?", () => {
            data = parsed;
            saveData(); render(); toast("Backup restored.");
          }, "Restore backup");
        } catch (err) {
          toast("That file doesn't look like a valid backup.", "error");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });

    document.getElementById("reset-btn").addEventListener("click", () => {
      confirmModal("Erase every grade, class, student and mark stored on this device? This cannot be undone.", () => {
        data = buildDefaultData();
        saveData(); render(); toast("All data erased.");
      }, "Erase everything");
    });
  }

  /* ---------- Boot ---------- */
  function init() {
    document.querySelectorAll(".nav button").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.view));
    });
    render();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").catch((err) => console.warn("SW registration failed", err));
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
