/* =========================================================
   U.B. Jayasooriya Maha Vidyalaya — Grade Tracker
   Application logic
   ========================================================= */
(function () {
  "use strict";

  /* ---------- Constants ---------- */
  const STORAGE_KEY = "ubjmv_gradetracker_data_v1";
  const SCHOOL_NAME = "U.B. Jayasooriya Maha Vidyalaya";
  const SCHOOL_NAME_SI = "යූ.බී. ජයසූරිය මහා විද්‍යාලය";
  const GRADES = ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11"];
  const TERMS = ["Term 1", "Term 2", "Term 3"];
  const PRIMARY_SUBJECTS = ["මව්බස", "ගණිතය", "පරිසරය", "බුද්ධ ධර්මය", "දෙමළ", "ඉංග්‍රීසි"];
  const JUNIOR_SUBJECTS = ["බුද්ධ ධර්මය", "සිංහල", "ගණිතය", "විද්‍යාව", "ඉංග්‍රීසි", "ඉතිහාසය", "භූගෝලය", "පුරවැසි අධ්‍යනය", "සෞන්දර්ය", "සෞඛ්‍ය", "තො.ස.තා", "ප්‍රා.තා.කු"];
  const SENIOR_SUBJECTS = ["බුද්ධ ධර්මය", "සිංහල", "ගණිතය", "විද්‍යාව", "ඉංග්‍රීසි", "ඉතිහාසය", "I කාණ්ඩ", "II කාණ්ඩය", "III කාණ්ඩය"];

  function defaultSubjectsForGrade(g) {
    const num = Number(String(g).replace(/\D/g, ""));
    if (num <= 5) return [...PRIMARY_SUBJECTS];
    if (num <= 9) return [...JUNIOR_SUBJECTS];
    return [...SENIOR_SUBJECTS];
  }

  // If the app later supports more grades than a school's saved/synced data
  // was created with (e.g. Grade 1-5 added after a school already set up
  // Grade 6-11), older data objects simply won't have those grade keys. Any
  // code that then does data.grades[g].subjects for the new grade throws and
  // silently blanks the whole app. This backfills anything missing, in
  // place, without touching grades that already exist.
  function ensureAllGradesExist(target) {
    let changed = false;
    GRADES.forEach((g) => {
      if (!target.grades[g]) {
        target.grades[g] = { classes: ["A"], subjects: defaultSubjectsForGrade(g) };
        changed = true;
      }
    });
    return changed;
  }

  const state = {
    view: "dashboard",
    reportsTab: "individual",
    selections: {} // scratch selections kept per view while navigating
  };

  /* ---------- Data layer ---------- */
  function buildDefaultData() {
    const grades = {};
    GRADES.forEach((g) => {
      grades[g] = {
        classes: ["A"],
        subjects: defaultSubjectsForGrade(g)
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
  if (data.__migrated) { delete data.__migrated; saveData(); }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return buildDefaultData();
      const parsed = JSON.parse(raw);
      if (!parsed.grades || !parsed.students || !parsed.marks) return buildDefaultData();
      if (ensureAllGradesExist(parsed)) parsed.__migrated = true;
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

  /* ========================================================
     CLOUD SYNC (optional — Firebase Firestore)
     Lets several teachers, each on their own phone, share one
     live class roster + mark sheet. Fully inert until a real
     FIREBASE_CONFIG is provided in js/firebase-config.js.
     ======================================================== */
  const SYNC_CODE_KEY = "ubjmv_sync_code";
  const SYNC_SKIPPED_KEY = "ubjmv_sync_skipped";

  let db = null;
  let syncCode = localStorage.getItem(SYNC_CODE_KEY) || "";
  let syncStatus = "off"; // off | connecting | connected | error
  let syncUnsubscribers = [];

  function isFirebaseConfigured() {
    return typeof FIREBASE_CONFIG !== "undefined" && FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith("PASTE_");
  }

  function isSyncActive() {
    return isFirebaseConfigured() && !!syncCode && !!db && syncStatus !== "error";
  }

  let syncLastError = "";

  function friendlySyncError(err) {
    const code = err && err.code;
    const map = {
      "permission-denied": "Firestore is blocking access. In the Firebase console, open Firestore Database \u2192 Rules, make sure they match the setup guide, and click Publish.",
      "unavailable": "Couldn't reach Firebase \u2014 check this device's internet connection and try again.",
      "not-found": "This Firebase project doesn't seem to have a Firestore database yet. In the console, open Firestore Database and click \"Create database\".",
      "failed-precondition": "Firestore isn't fully set up for this project yet \u2014 check that Firestore Database is created and the rules are published.",
      "unauthenticated": "Firebase rejected this device \u2014 double-check the values in js/firebase-config.js match your Firebase project exactly."
    };
    if (code && map[code]) return map[code];
    return (err && err.message) ? err.message : "Unknown error \u2014 please share this message so it can be diagnosed.";
  }

  function ensureFirebaseApp() {
    if (db) return;
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch((err) => console.warn("Offline persistence not enabled:", err.code));
  }

  function roomRef() { return db.collection("syncRooms").doc(syncCode); }
  function studentsCol() { return roomRef().collection("students"); }
  function marksCol() { return roomRef().collection("marks"); }
  function configDocRef() { return roomRef().collection("meta").doc("config"); }

  function stopSyncListeners() {
    syncUnsubscribers.forEach((u) => u());
    syncUnsubscribers = [];
  }

  function attachSyncListeners() {
    const unsubConfig = configDocRef().onSnapshot((doc) => {
      syncStatus = "connected";
      syncLastError = "";
      if (doc.exists && doc.data().grades) data.grades = doc.data().grades;
      const backfilled = ensureAllGradesExist(data);
      saveData(); updateSyncUI(); render();
      if (backfilled) syncPushConfig();
    }, (err) => { syncStatus = "error"; syncLastError = friendlySyncError(err); updateSyncUI(); console.error(err); });

    const unsubStudents = studentsCol().onSnapshot((snap) => {
      data.students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      saveData(); render();
    }, (err) => { syncStatus = "error"; syncLastError = friendlySyncError(err); updateSyncUI(); console.error(err); });

    const unsubMarks = marksCol().onSnapshot((snap) => {
      const marks = {};
      snap.docs.forEach((d) => { marks[d.id] = d.data(); });
      data.marks = marks;
      saveData(); render();
    }, (err) => { syncStatus = "error"; syncLastError = friendlySyncError(err); updateSyncUI(); console.error(err); });

    syncUnsubscribers = [unsubConfig, unsubStudents, unsubMarks];
  }

  async function syncFullReplace() {
    if (!isSyncActive()) return;
    const batch = db.batch();
    batch.set(configDocRef(), { grades: data.grades });
    const [existingStudents, existingMarks] = await Promise.all([studentsCol().get(), marksCol().get()]);
    const keepIds = new Set(data.students.map((s) => s.id));
    existingStudents.docs.forEach((d) => { if (!keepIds.has(d.id)) batch.delete(d.ref); });
    existingMarks.docs.forEach((d) => { if (!keepIds.has(d.id)) batch.delete(d.ref); });
    data.students.forEach((s) => batch.set(studentsCol().doc(s.id), s));
    Object.keys(data.marks).forEach((sid) => batch.set(marksCol().doc(sid), data.marks[sid] || {}));
    await batch.commit();
  }

  async function startSync(code) {
    if (!isFirebaseConfigured()) {
      toast("Cloud sync isn't set up yet for this school — see the Sync tab for setup steps.", "error");
      return;
    }
    const trimmed = code.trim();
    if (!trimmed) return toast("Enter a sync code first.", "error");

    stopSyncListeners();
    syncCode = trimmed;
    localStorage.setItem(SYNC_CODE_KEY, syncCode);
    localStorage.removeItem(SYNC_SKIPPED_KEY);
    syncStatus = "connecting";
    syncLastError = "";
    updateSyncUI();

    try {
      ensureFirebaseApp();
      const [configSnap, studentsSnap] = await Promise.all([configDocRef().get(), studentsCol().limit(1).get()]);
      const roomIsEmpty = !configSnap.exists && studentsSnap.empty;
      if (roomIsEmpty && (data.students.length || Object.keys(data.marks).length)) {
        await syncFullReplace();
        toast("Connected — your existing data is now shared with this code.");
      } else if (!roomIsEmpty) {
        toast("Connected — synced with the existing shared data.");
      } else {
        toast("Connected. Waiting for data from other devices...");
      }
      attachSyncListeners();
    } catch (e) {
      console.error(e);
      syncStatus = "error";
      syncLastError = friendlySyncError(e);
      updateSyncUI();
      toast("Could not connect — see the error details on the Data & Sync tab.", "error");
    }
  }

  function stopSync() {
    stopSyncListeners();
    syncCode = "";
    localStorage.removeItem(SYNC_CODE_KEY);
    syncStatus = "off";
    updateSyncUI();
    toast("Disconnected — this device now works offline-only again.");
  }

  function updateSyncUI() {
    const labels = { off: "Offline only", connecting: "Connecting…", connected: "Live sync on", error: "Sync error" };
    document.querySelectorAll("[data-sync-indicator]").forEach((badge) => {
      badge.className = "sync-badge sync-" + syncStatus;
      badge.setAttribute("data-sync-indicator", "");
      badge.innerHTML = `<span class="dot"></span> ${labels[syncStatus]}`;
    });
    if (state.view === "data") render();
  }

  function syncPushConfig(grade) {
    if (!isSyncActive()) return;
    const ref = configDocRef();
    if (!grade) {
      // Full replace — only used for initial connect / import / reset.
      ref.set({ grades: data.grades }).catch((e) => console.error(e));
      return;
    }
    // Scoped to just the one grade that changed, so a teacher editing Grade 6's
    // subjects can't overwrite another teacher's concurrent edit to Grade 9.
    ref.set({}, { merge: true })
      .then(() => ref.update({ [`grades.${grade}`]: data.grades[grade] }))
      .catch((e) => console.error(e));
  }
  function syncPushStudent(student) {
    if (isSyncActive()) studentsCol().doc(student.id).set(student).catch((e) => console.error(e));
  }
  function syncDeleteStudent(id) {
    if (isSyncActive()) {
      studentsCol().doc(id).delete().catch((e) => console.error(e));
      marksCol().doc(id).delete().catch((e) => console.error(e));
    }
  }
  function syncPushMark(studentId, term, subject, value) {
    if (!isSyncActive()) return;
    const ref = marksCol().doc(studentId);
    const fieldPath = `${term}.${subject}`;
    const fieldValue = (value === null || value === undefined) ? firebase.firestore.FieldValue.delete() : value;
    // set({}, {merge:true}) first guarantees the document exists (a no-op if it
    // already does), so the follow-up update() — which is what actually makes
    // Firestore treat the dotted key as a nested path instead of a literal
    // field name — never fails with "document not found" for a brand-new student.
    ref.set({}, { merge: true })
      .then(() => ref.update({ [fieldPath]: fieldValue }))
      .catch((e) => console.error(e));
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
    // Rank is computed above, but rows are returned in their original
    // (student-entry) order rather than sorted by rank — reports list
    // students the way they were added, with rank shown as a column.
    return rows;
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
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}/${m}/${day}`;
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

  function generateConfirmCode() {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // avoids O/0, I/1/l look-alikes
    let out = "";
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function confirmWithCode(message, onConfirm, confirmLabel) {
    const code = generateConfirmCode();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal">
      <h3>Please confirm</h3>
      <p style="margin:0 0 14px;color:var(--ink-soft);">${escapeHtml(message)}</p>
      <p class="hint" style="margin-bottom:6px;">Type this code to confirm:</p>
      <div style="font-family:monospace;font-size:1.4rem;font-weight:700;letter-spacing:.18em;background:var(--surface-alt);border-radius:8px;padding:10px 14px;text-align:center;margin-bottom:14px;color:var(--primary-dark);">${code}</div>
      <div class="field"><input type="text" id="confirm-code-input" placeholder="Type the code above" autocomplete="off"></div>
      <div id="confirm-code-error" style="color:var(--danger);font-size:0.82rem;min-height:18px;"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="confirm-code-cancel">Cancel</button>
        <button class="btn btn-danger" id="confirm-code-ok">${escapeHtml(confirmLabel || "Confirm")}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    const input = document.getElementById("confirm-code-input");
    const tryConfirm = () => {
      const val = input.value.trim().toUpperCase();
      if (val === code) {
        overlay.remove();
        onConfirm();
      } else {
        document.getElementById("confirm-code-error").textContent = "That code doesn't match — type it exactly as shown above.";
      }
    };
    document.getElementById("confirm-code-cancel").addEventListener("click", () => overlay.remove());
    document.getElementById("confirm-code-ok").addEventListener("click", tryConfirm);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryConfirm(); });
    input.focus();
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
    analysis: ["Insights", "Analysis"],
    data: ["Safety", "Data & Sync"]
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
    if (isFirebaseConfigured()) {
      const labels = { off: "Offline only", connecting: "Connecting…", connected: "Live sync on", error: "Sync error" };
      const badge = document.createElement("div");
      badge.className = "sync-badge sync-" + syncStatus;
      badge.setAttribute("data-sync-indicator", "");
      badge.innerHTML = `<span class="dot"></span> ${labels[syncStatus]}`;
      badge.title = isSyncActive() ? "Go to Data & Sync to manage" : "Go to Data & Sync to connect";
      badge.style.cursor = "pointer";
      badge.addEventListener("click", () => setView("data"));
      actions.appendChild(badge);
    }
    switch (state.view) {
      case "dashboard": root.innerHTML = renderDashboard(); break;
      case "setup": root.innerHTML = renderSetup(); attachSetupEvents(); break;
      case "students": root.innerHTML = renderStudents(); attachStudentsEvents(); break;
      case "marks": root.innerHTML = renderMarks(); attachMarksEvents(); break;
      case "reports": root.innerHTML = renderReports(); attachReportsEvents(); break;
      case "analysis": root.innerHTML = renderAnalysis(); attachAnalysisEvents(); break;
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
        <div class="stat"><div class="num">${gradesWithStudents}/${GRADES.length}</div><div class="label">Grades in use</div></div>
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
        saveData(); syncPushConfig(g); render(); toast(`Added class ${val} to ${g}.`);
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
            saveData(); syncPushConfig(g); render(); toast("Class removed.");
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
        saveData(); syncPushConfig(g); render(); toast(`Added ${val} to ${g}.`);
      });
    });
    document.querySelectorAll("[data-remove-subject]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [g, s] = btn.dataset.removeSubject.split("||");
        confirmModal(`Remove "${s}" from ${g}? Any marks already entered for this subject will no longer be shown.`, () => {
          data.grades[g].subjects = data.grades[g].subjects.filter((x) => x !== s);
          saveData(); syncPushConfig(g); render(); toast("Subject removed.");
        }, "Remove subject");
      });
    });
    document.querySelectorAll("[data-reset-subjects]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = btn.dataset.resetSubjects;
        confirmModal(`Reset ${g} subjects to the default list? Custom subjects you added will be removed.`, () => {
          data.grades[g].subjects = defaultSubjectsForGrade(g);
          saveData(); syncPushConfig(g); render(); toast("Subjects reset to default.");
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
    // Preserve the order students were added in (e.g. the order typed into
    // "Add several at once"), rather than forcing alphabetical order.

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
      syncPushStudent(data.students[data.students.length - 1]);
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
              names.forEach((name, i) => syncPushStudent(data.students[data.students.length - names.length + i]));
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
                saveData(); syncPushStudent(st); render(); toast("Student updated.");
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
          saveData(); syncDeleteStudent(st.id); render(); toast("Student deleted.");
        }, "Delete student");
      });
    });
  }

  /* ========================================================
     MARKS ENTRY
     ======================================================== */
  function renderMarks() {
    const sel = state.selections.marks || (state.selections.marks = { grade: GRADES[0], cls: data.grades[GRADES[0]].classes[0] || "", term: TERMS[0], subject: "" });
    if (!data.grades[sel.grade].classes.includes(sel.cls)) sel.cls = data.grades[sel.grade].classes[0] || "";

    const subjects = data.grades[sel.grade].subjects;
    if (!sel.subject || (sel.subject !== "ALL" && !subjects.includes(sel.subject))) sel.subject = subjects[0] || "ALL";
    const students = getStudentsFor(sel.grade, sel.cls);

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

    const isWide = sel.subject === "ALL";
    const subjectOptions = subjects.map((s) => `<option value="${escapeHtml(s)}" ${s === sel.subject ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")
      + `<option value="ALL" ${isWide ? "selected" : ""}>All subjects (wide view)</option>`;

    const headerCells = isWide
      ? subjects.map((s) => `<th style="min-width:88px;">${escapeHtml(s)}</th>`).join("")
      : `<th style="min-width:120px;">${escapeHtml(sel.subject)}</th>`;

    const rows = students.map((st) => {
      const marksObj = studentMarks(st.id, sel.term);
      const cells = isWide
        ? subjects.map((subj) => {
            const v = marksObj[subj];
            return `<td><input type="number" min="0" max="100" class="mark-input" data-student="${st.id}" data-subject="${escapeHtml(subj)}" value="${v !== undefined && v !== null ? v : ""}"></td>`;
          }).join("")
        : (() => {
            const v = marksObj[sel.subject];
            return `<td><input type="number" min="0" max="100" class="mark-input" data-student="${st.id}" data-subject="${escapeHtml(sel.subject)}" value="${v !== undefined && v !== null ? v : ""}"></td>`;
          })();
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
        <div class="field"><label>Subject</label><select id="marks-subject">${subjectOptions}</select></div>
      </div>
      <p class="hint">${isWide
        ? "Showing all subjects. Marks are out of 100 and save automatically. Blank cells count as 0 in the total."
        : `Entering marks for <b>${escapeHtml(sel.subject)}</b> only. Total/Average reflect every subject entered by all teachers for this class.`}</p>
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
      sel.subject = "";
      render();
    });
    const classSelect = document.getElementById("marks-class");
    if (classSelect) classSelect.addEventListener("change", (e) => { sel.cls = e.target.value; render(); });
    const termSelect = document.getElementById("marks-term");
    if (termSelect) termSelect.addEventListener("change", (e) => { sel.term = e.target.value; render(); });
    const subjectSelect = document.getElementById("marks-subject");
    if (subjectSelect) subjectSelect.addEventListener("change", (e) => { sel.subject = e.target.value; render(); });

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
        syncPushMark(studentId, sel.term, subject, val);
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
      const studentsInClass = getStudentsFor(selInd.grade, selInd.cls);
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
            <button class="btn btn-ghost" id="rep-ind-download-xlsx" ${!selInd.studentId ? "disabled" : ""}>⬇ Download Excel</button>
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
          <button class="btn btn-ghost" id="rep-cls-download-xlsx" ${!studentsForClassReport.length ? "disabled" : ""}>⬇ Download Excel</button>
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
      if (dl) dl.addEventListener("click", async () => {
        dl.disabled = true;
        toast("Preparing report…");
        try { await generateStudentReportPdf(selInd.studentId); } finally { dl.disabled = false; }
      });
      const dlXlsx = document.getElementById("rep-ind-download-xlsx");
      if (dlXlsx) dlXlsx.addEventListener("click", () => generateStudentReportExcel(selInd.studentId));
    } else {
      const selCls = state.selections.reportCls;
      document.getElementById("rep-cls-grade").addEventListener("change", (e) => {
        selCls.grade = e.target.value; selCls.cls = data.grades[selCls.grade].classes[0] || ""; render();
      });
      document.getElementById("rep-cls-class").addEventListener("change", (e) => { selCls.cls = e.target.value; render(); });
      document.getElementById("rep-cls-term").addEventListener("change", (e) => { selCls.term = e.target.value; render(); });
      const dl = document.getElementById("rep-cls-download");
      if (dl) dl.addEventListener("click", async () => {
        dl.disabled = true;
        toast("Preparing report…");
        try { await generateClassReportPdf(selCls.grade, selCls.cls, selCls.term); } finally { dl.disabled = false; }
      });
      const dlXlsx = document.getElementById("rep-cls-download-xlsx");
      if (dlXlsx) dlXlsx.addEventListener("click", () => generateClassReportExcel(selCls.grade, selCls.cls, selCls.term));
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

    // Total columns = student name + admission no. + one per subject + total + average + rank.
    // For print we force the table to a fixed layout that always sums to 100%
    // of the page width, so columns shrink to fit instead of being clipped
    // off the right edge when there are many subjects.
    const totalCols = 2 + subjects.length + 3;
    let printFontSize = "0.82rem", printPad = "8px 9px";
    if (forPrint) {
      if (totalCols > 15) { printFontSize = "6.6px"; printPad = "3px 3px"; }
      else if (totalCols > 12) { printFontSize = "7.5px"; printPad = "3px 4px"; }
      else if (totalCols > 9) { printFontSize = "8.5px"; printPad = "4px 5px"; }
      else { printFontSize = "9.5px"; printPad = "5px 6px"; }
    }
    const studentColPct = Math.max(10, Math.min(16, 100 / totalCols + 6));
    const admissionColPct = Math.max(8, Math.min(12, 100 / totalCols + 2));
    const otherColPct = (100 - studentColPct - admissionColPct) / (totalCols - 2);
    const printTableStyle = forPrint
      ? `style="table-layout:fixed;width:100%;font-size:${printFontSize};"`
      : "";
    const studentColStyle = forPrint ? `style="width:${studentColPct}%;padding:${printPad};word-break:break-word;"` : "";
    const admissionColStyle = forPrint ? `style="width:${admissionColPct}%;padding:${printPad};word-break:break-word;text-align:center;"` : "";
    const otherColStyle = forPrint ? `style="width:${otherColPct}%;padding:${printPad};word-break:break-word;text-align:center;"` : "";

    const rowsHtml = ranking.map((r) => {
      const marksObj = studentMarks(r.id, term);
      const cells = subjects.map((subj) => {
        const v = marksObj[subj];
        return `<td ${otherColStyle}>${v !== undefined && v !== null && v !== "" ? v : "—"}</td>`;
      }).join("");
      return `<tr>
        <td ${studentColStyle}>${escapeHtml(r.name)}</td>
        <td ${admissionColStyle || 'style="text-align:center;"'}>${escapeHtml(r.admissionNo || "—")}</td>
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
          <thead><tr><th ${studentColStyle || 'style="text-align:left;"'}>Student</th><th ${admissionColStyle || 'style="text-align:center;"'}>Admission No.</th>${subjects.map((s) => `<th ${otherColStyle}>${escapeHtml(s)}</th>`).join("")}<th ${otherColStyle}>Total</th><th ${otherColStyle}>Average</th><th ${otherColStyle}>Rank</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>
        ${forPrint ? `<p style="margin-top:18px;font-size:0.72rem;color:var(--muted);">Blank cells mean no mark recorded (counted as 0 in the total).</p>` : ""}
      </div>`;
  }

  const PDF_INK = [25, 25, 25];
  const PDF_MUTED = [110, 110, 110];

  const SI = {
    studentProgressReport: "ශිෂ්‍ය ප්‍රගති වාර්තාව",
    student: "ශිෂ්‍යයා",
    subject: "විෂය",
    grade: "පංතිය",
    admissionNo: "ඇතුලත්වීමේ අංකය",
    classLabel: "අංශය",
    total: "එකතුව",
    totalThreeTerms: "එකතුව (වාර 3)",
    average: "සාමාන්‍ය",
    overallAverage: "සමස්ත සාමාන්‍යය",
    rank: "ස්ථානය",
    overallRank: "සමස්ත ස්ථානය",
    termSummary: "වාර සාරාංශය",
    classMarksheet: "පන්ති ලකුණු ලේඛනය",
    classSummaryAllTerms: "පන්ති සාරාංශය — වාර 3ම",
    generated: "සකස් කළ දිනය",
    letterGrade: "ශ්‍රේණිය",
    footnoteMarks: "ලකුණු ඇතුළත් නොකළ විෂයයන් 0ක් ලෙස ගණන් කෙරේ.",
    footnoteGradeBands: "ශ්‍රේණි සීමා: A \u226575, B \u226565, C \u226550, S \u226535, W <35"
  };

  function termLabelSi(term) {
    const n = String(term).replace(/\D/g, "");
    return `${n} වන වාරය`;
  }

  function gradeClassLabelSi(gradeNum, cls) {
    return `${SI.grade} ${gradeNum}- ${cls}`;
  }

  function getPdfLib() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      toast("PDF tools haven't finished loading yet — please check your connection and try again in a moment.", "error");
      return null;
    }
    return window.jspdf.jsPDF;
  }

  function getXlsxLib() {
    if (!window.XLSX) {
      toast("Excel tools haven't finished loading yet — please check your connection and try again in a moment.", "error");
      return null;
    }
    return window.XLSX;
  }

  function generateStudentReportExcel(studentId) {
    const XLSX = getXlsxLib();
    if (!XLSX) return;
    const st = data.students.find((s) => s.id === studentId);
    if (!st) return toast("Select a student first.", "error");

    const subjects = data.grades[st.grade].subjects;
    const ranking = classRankingOverall(st.grade, st.cls);
    const overallRankRow = ranking.find((r) => r.id === studentId);
    const overall = computeStudentOverallStats(studentId, st.grade);
    const termStats = TERMS.map((t) => computeStudentTermStats(studentId, st.grade, t));
    const termRankings = TERMS.map((t) => classRankingForTerm(st.grade, st.cls, t));

    const rows = [];
    rows.push([SCHOOL_NAME_SI]);
    rows.push([`${SI.studentProgressReport} \u00b7 ${SI.generated} ${todayStr()}`]);
    rows.push([]);
    rows.push([SI.student, st.name, SI.admissionNo, st.admissionNo || ""]);
    rows.push([gradeClassLabelSi(st.grade.replace(/\D/g, ""), st.cls)]);
    rows.push([]);
    rows.push([SI.subject, ...TERMS.map(termLabelSi), SI.average, SI.letterGrade]);

    subjects.forEach((subj) => {
      const marksByTerm = TERMS.map((t) => studentMarks(studentId, t)[subj]);
      const validMarks = marksByTerm.filter((v) => v !== undefined && v !== null && v !== "");
      const subjAvg = validMarks.length ? validMarks.reduce((a, b) => a + Number(b), 0) / validMarks.length : null;
      const g = gradeLetter(subjAvg);
      rows.push([
        subj,
        ...marksByTerm.map((v) => (v !== undefined && v !== null && v !== "" ? Number(v) : "")),
        subjAvg !== null ? round1(subjAvg) : "",
        g || ""
      ]);
    });

    rows.push([]);
    rows.push([SI.termSummary]);
    rows.push(["", SI.total, SI.rank]);
    TERMS.forEach((t, i) => {
      const rankRow = termRankings[i].find((r) => r.id === studentId);
      rows.push([termLabelSi(t), termStats[i].total, rankRow ? `${rankRow.rank} / ${termRankings[i].length}` : "—"]);
    });
    rows.push([]);
    rows.push([SI.overallAverage, round1(overall.average) + "%", SI.overallRank, overallRankRow ? `${overallRankRow.rank} / ${ranking.length}` : "—"]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    const filename = `${safeFileToken(st.name)}_${gradeClassToken(st.grade, st.cls)}_Report.xlsx`;
    XLSX.writeFile(wb, filename);
    toast("Excel report downloaded.");
  }

  function generateClassReportExcel(grade, cls, term) {
    const XLSX = getXlsxLib();
    if (!XLSX) return;
    const students = getStudentsFor(grade, cls);
    if (!students.length) return toast("No students in this class yet.", "error");
    const subjects = data.grades[grade].subjects;
    const isAll = term === "ALL";
    const gradeNum = grade.replace(/\D/g, "");

    const rows = [];
    rows.push([SCHOOL_NAME_SI]);
    rows.push([`${isAll ? SI.classSummaryAllTerms : `${SI.classMarksheet} \u00b7 ${termLabelSi(term)}`} \u00b7 ${gradeClassLabelSi(gradeNum, cls)} \u00b7 ${SI.generated} ${todayStr()}`]);
    rows.push([]);

    const wb = XLSX.utils.book_new();
    let filename;

    if (isAll) {
      const ranking = classRankingOverall(grade, cls);
      rows.push([SI.student, SI.admissionNo, SI.totalThreeTerms, SI.overallAverage, SI.letterGrade, SI.rank]);
      ranking.forEach((r) => {
        rows.push([r.name, r.admissionNo || "", r.total, round1(r.average), gradeLetter(r.average) || "", r.rank]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 8 }];
      XLSX.utils.book_append_sheet(wb, ws, "Class Summary");
      filename = `${gradeClassToken(grade, cls)}_AllTerms_ClassReport.xlsx`;
    } else {
      const ranking = classRankingForTerm(grade, cls, term);
      rows.push([SI.student, SI.admissionNo, ...subjects, SI.total, SI.average, SI.rank]);
      ranking.forEach((r) => {
        const marksObj = studentMarks(r.id, term);
        const cells = subjects.map((subj) => {
          const v = marksObj[subj];
          return v !== undefined && v !== null && v !== "" ? Number(v) : "";
        });
        rows.push([r.name, r.admissionNo || "", ...cells, r.total, round1(r.average), r.rank]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 22 }, { wch: 14 }, ...subjects.map(() => ({ wch: 12 })), { wch: 10 }, { wch: 10 }, { wch: 8 }];
      XLSX.utils.book_append_sheet(wb, ws, "Class Marksheet");
      filename = `${gradeClassToken(grade, cls)}_${term.replace(/\s+/g, "")}_ClassReport.xlsx`;
    }

    XLSX.writeFile(wb, filename);
    toast("Excel report downloaded.");
  }

  function safeFileToken(str) {
    // Keep Unicode letters (Sinhala names, etc.) intact — only strip characters
    // that are genuinely unsafe in filenames, plus collapse whitespace.
    return String(str).trim()
      .replace(/[\/\\:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function gradeClassToken(grade, cls) {
    // "Grade 6", "A" -> "Grade6-A"
    return String(grade).replace(/\s+/g, "") + "-" + safeFileToken(cls);
  }

  // ---- Sinhala-aware text rendering ------------------------------------
  // jsPDF's built-in fonts only support Latin (WinAnsi) glyphs, and jsPDF has
  // no complex-script shaping engine, so Sinhala (which reorders certain
  // vowel signs before their consonant) cannot be drawn correctly with plain
  // doc.text(). Instead, any non-ASCII string is rendered to a small PNG
  // using the browser's own text engine (which shapes Sinhala correctly)
  // and that image is placed into the PDF. Plain ASCII/numeric text still
  // uses native vector text, which stays crisp and small.
  function needsImageRender(text) {
    return /[^\x00-\x7F]/.test(String(text));
  }

  function ensureSinhalaFontLoaded(sampleText) {
    const text = SCHOOL_NAME_SI + " " + Object.values(SI).join(" ") + " " + (sampleText || "") + " 0123456789";
    return (async () => {
      try {
        if (document.fonts && document.fonts.load) {
          await Promise.all([
            document.fonts.load('400 32px "Noto Sans Sinhala"', text),
            document.fonts.load('700 32px "Noto Sans Sinhala"', text)
          ]);
        }
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
      } catch (e) { console.warn("Sinhala font preload check failed", e); }
    })();
  }

  const _textImageCache = new Map();
  function renderTextToImage(text, ptSize, opts) {
    opts = opts || {};
    const weight = opts.weight || "400";
    const colorHex = opts.colorHex || "#16302C";
    const raw = text === "" || text === null || text === undefined ? " " : String(text);
    const key = raw + "|" + ptSize + "|" + weight + "|" + colorHex;
    if (_textImageCache.has(key)) return _textImageCache.get(key);

    const SCALE = 3; // supersample so the embedded image stays crisp when printed
    const fontPx = ptSize * (96 / 72) * SCALE;
    const family = '"Noto Sans Sinhala", "Iskoola Pota", "Nirmala UI", "Noto Sans", sans-serif';

    const mctx = document.createElement("canvas").getContext("2d");
    mctx.font = `${weight} ${fontPx}px ${family}`;
    const metrics = mctx.measureText(raw);
    const ascent = metrics.actualBoundingBoxAscent || fontPx * 0.85;
    const descent = metrics.actualBoundingBoxDescent || fontPx * 0.28;
    const textWidth = Math.max(1, metrics.width);
    const padX = fontPx * 0.08;
    const padY = fontPx * 0.14;

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(textWidth + padX * 2);
    canvas.height = Math.ceil(ascent + descent + padY * 2);
    const ctx = canvas.getContext("2d");
    ctx.font = `${weight} ${fontPx}px ${family}`;
    ctx.fillStyle = colorHex;
    ctx.textBaseline = "alphabetic";
    const baselineY = padY + ascent;
    ctx.fillText(raw, padX, baselineY);

    const mmPerPx = 0.264583 / SCALE;
    const result = {
      dataUrl: canvas.toDataURL("image/png"),
      widthMM: canvas.width * mmPerPx,
      heightMM: canvas.height * mmPerPx,
      baselineMM: baselineY * mmPerPx
    };
    _textImageCache.set(key, result);
    return result;
  }

  function rgbToHex(rgb) {
    return "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
  }

  // Draws one line of text at (x, y) — y is the baseline, matching doc.text().
  function drawText(doc, text, x, y, opts) {
    opts = opts || {};
    const align = opts.align || "left";
    const str = text === null || text === undefined ? "" : String(text);
    if (!needsImageRender(str)) {
      doc.setFont("helvetica", opts.weight === "700" ? "bold" : "normal");
      doc.setFontSize(opts.ptSize || 10);
      doc.setTextColor(...(opts.color || PDF_INK));
      doc.text(str, x, y, { align });
      return;
    }
    const img = renderTextToImage(str, opts.ptSize || 10, { weight: opts.weight || "400", colorHex: opts.colorHex || rgbToHex(opts.color || PDF_INK) });
    const pageWidth = doc.internal.pageSize.getWidth();
    const maxW = Math.max(10, pageWidth - x - 10);
    let w = img.widthMM, h = img.heightMM, baseline = img.baselineMM;
    if (w > maxW) {
      const scale = maxW / w;
      w *= scale; h *= scale; baseline *= scale;
    }
    let imgX = x;
    if (align === "center") imgX = x - w / 2;
    else if (align === "right") imgX = x - w;
    doc.addImage(img.dataUrl, "PNG", imgX, y - baseline, w, h);
  }

  // autoTable hooks: any cell whose raw value contains non-ASCII text is
  // blanked out by the library's own renderer and redrawn as a fitted image;
  // plain ASCII/number cells (marks, ranks, totals) render natively as usual.
  function sinhalaCellHooks(doc, baseFontSize) {
    return {
      didParseCell: (d) => {
        const raw = d.cell.raw;
        if (raw !== undefined && raw !== null && needsImageRender(String(raw))) d.cell.text = [];
      },
      didDrawCell: (d) => {
        const raw = d.cell.raw;
        if (raw === undefined || raw === null) return;
        const str = String(raw);
        if (!needsImageRender(str)) return;
        const isHead = d.section === "head";
        const weight = isHead || (d.cell.styles && d.cell.styles.fontStyle === "bold") ? "700" : "400";
        const colorHex = "#191919";
        const ptSize = (d.cell.styles && d.cell.styles.fontSize) || baseFontSize;
        const img = renderTextToImage(str, ptSize, { weight, colorHex });
        const padL = d.cell.padding("left");
        const padR = d.cell.padding("right");
        const padT = d.cell.padding("top");
        const padB = d.cell.padding("bottom");
        const maxW = d.cell.width - padL - padR;
        const maxH = d.cell.height - padT - padB;
        const scale = Math.min(1, maxW / img.widthMM, maxH / img.heightMM);
        const w = img.widthMM * scale, h = img.heightMM * scale;
        const halign = (d.cell.styles && d.cell.styles.halign) || "left";
        let x = d.cell.x + padL;
        if (halign === "center") x = d.cell.x + (d.cell.width - w) / 2;
        else if (halign === "right") x = d.cell.x + d.cell.width - padR - w;
        const y = d.cell.y + (d.cell.height - h) / 2;
        doc.addImage(img.dataUrl, "PNG", x, y, w, h);
      }
    };
  }

  function pdfHeader(doc, subtitle) {
    drawText(doc, SCHOOL_NAME_SI, 14, 16, { ptSize: 15, weight: "700", color: PDF_INK });
    drawText(doc, subtitle, 14, 22, { ptSize: 9.5, weight: "400", color: PDF_MUTED });
    doc.setDrawColor(...PDF_INK);
    doc.setLineWidth(0.5);
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.line(14, 26, pageWidth - 14, 26);
  }

  async function generateStudentReportPdf(studentId) {
    const jsPDFCtor = getPdfLib();
    if (!jsPDFCtor) return;
    const st = data.students.find((s) => s.id === studentId);
    if (!st) return toast("Select a student first.", "error");
    const subjects = data.grades[st.grade].subjects;
    await ensureSinhalaFontLoaded(subjects.join(" ") + " " + st.name + " " + (st.admissionNo || ""));

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
    pdfHeader(doc, `${SI.studentProgressReport} \u00b7 ${SI.generated} ${todayStr()}`);

    drawText(doc, st.name, 14, 34, { ptSize: 11, weight: "700", color: PDF_INK });
    drawText(doc, `${SI.admissionNo}: ${st.admissionNo || "—"}`, 14, 40, { ptSize: 9.5, weight: "400", color: PDF_INK });
    drawText(doc, gradeClassLabelSi(st.grade.replace(/\D/g, ""), st.cls), 110, 40, { ptSize: 9.5, weight: "400", color: PDF_INK });

    const usableW = doc.internal.pageSize.getWidth() - 28; // matches the 14mm left/right margin used throughout
    const subjColW = usableW * 0.34;
    const otherColW = (usableW - subjColW) / 5;

    doc.autoTable({
      startY: 46,
      head: [[SI.subject, ...TERMS.map(termLabelSi), SI.average, SI.letterGrade]],
      body,
      theme: "grid",
      tableWidth: usableW,
      styles: { fontSize: 9.5, cellPadding: 2.6, textColor: PDF_INK, lineColor: [190, 190, 190], lineWidth: 0.15, overflow: "linebreak" },
      headStyles: { textColor: PDF_INK, fontStyle: "bold", fontSize: 9.5 },
      columnStyles: {
        0: { halign: "left", cellWidth: subjColW },
        1: { halign: "center", cellWidth: otherColW },
        2: { halign: "center", cellWidth: otherColW },
        3: { halign: "center", cellWidth: otherColW },
        4: { halign: "center", cellWidth: otherColW, fontStyle: "bold" },
        5: { halign: "center", cellWidth: otherColW }
      },
      ...sinhalaCellHooks(doc, 9.5)
    });

    let y = doc.lastAutoTable.finalY + 9;
    drawText(doc, SI.termSummary, 14, y, { ptSize: 10, weight: "700", color: PDF_INK });
    y += 6;
    TERMS.forEach((t, i) => {
      const rankRow = termRankings[i].find((r) => r.id === studentId);
      drawText(doc, `${termLabelSi(t)}:  ${SI.total} ${termStats[i].total}  \u00b7  ${SI.rank} ${rankRow ? rankRow.rank : "—"} / ${termRankings[i].length}`, 14, y, { ptSize: 10, weight: "400", color: PDF_INK });
      y += 6;
    });
    drawText(doc, `${SI.overallAverage}: ${round1(overall.average)}%  \u00b7  ${SI.overallRank} ${overallRankRow ? overallRankRow.rank : "—"} / ${ranking.length}`, 14, y + 2, { ptSize: 10, weight: "700", color: PDF_INK });

    drawText(doc, SI.footnoteMarks + "  " + SI.footnoteGradeBands, 14, y + 10, { ptSize: 7.5, weight: "400", color: PDF_MUTED });

    const filename = `${safeFileToken(st.name)}_${gradeClassToken(st.grade, st.cls)}_Report.pdf`;
    doc.save(filename);
    toast("Report downloaded.");
  }

  async function generateClassReportPdf(grade, cls, term) {
    const jsPDFCtor = getPdfLib();
    if (!jsPDFCtor) return;
    const students = getStudentsFor(grade, cls);
    if (!students.length) return toast("No students in this class yet.", "error");
    const subjects = data.grades[grade].subjects;
    await ensureSinhalaFontLoaded(subjects.join(" ") + " " + students.map((s) => s.name).join(" "));

    const doc = new jsPDFCtor({ orientation: "landscape", unit: "mm", format: "a4" });
    const isAll = term === "ALL";
    const gradeNum = grade.replace(/\D/g, "");
    pdfHeader(doc, `${isAll ? SI.classSummaryAllTerms : `${SI.classMarksheet} \u00b7 ${termLabelSi(term)}`} \u00b7 ${gradeClassLabelSi(gradeNum, cls)} \u00b7 ${SI.generated} ${todayStr()}`);

    let head, body, columnStyles;
    if (isAll) {
      const ranking = classRankingOverall(grade, cls);
      head = [[SI.student, SI.admissionNo, SI.totalThreeTerms, SI.overallAverage, SI.letterGrade, SI.rank]];
      body = ranking.map((r) => [r.name, r.admissionNo || "—", String(r.total), round1(r.average) + "%", gradeLetter(r.average) || "—", String(r.rank)]);
      columnStyles = { 0: { halign: "left" } };
    } else {
      const ranking = classRankingForTerm(grade, cls, term);
      head = [[SI.student, SI.admissionNo, ...subjects, SI.total, SI.average, SI.rank]];
      body = ranking.map((r) => {
        const marksObj = studentMarks(r.id, term);
        const cells = subjects.map((subj) => {
          const v = marksObj[subj];
          return v !== undefined && v !== null && v !== "" ? String(v) : "—";
        });
        return [r.name, r.admissionNo || "—", ...cells, String(r.total), round1(r.average) + "%", String(r.rank)];
      });
      columnStyles = { 0: { halign: "left" }, 1: { halign: "center" } };
    }

    const colCount = head[0].length;
    const fontSize = colCount > 16 ? 6.5 : colCount > 13 ? 7.2 : colCount > 10 ? 8 : 9;
    const usableW = doc.internal.pageSize.getWidth() - 20; // matches margin left/right 10 below
    const studentColW = Math.max(usableW * 0.15, 24);
    const admissionColW = isAll ? 0 : Math.max(usableW * 0.09, 14);
    const remainingCols = isAll ? colCount - 1 : colCount - 2;
    const otherColW = (usableW - studentColW - admissionColW) / remainingCols;
    columnStyles[0] = { ...columnStyles[0], cellWidth: studentColW };
    if (!isAll) columnStyles[1] = { ...columnStyles[1], cellWidth: admissionColW };
    for (let i = isAll ? 1 : 2; i < colCount; i++) columnStyles[i] = { ...columnStyles[i], cellWidth: otherColW };

    doc.autoTable({
      startY: 32,
      head, body, columnStyles,
      theme: "grid",
      tableWidth: usableW,
      styles: { fontSize, cellPadding: 1.8, textColor: PDF_INK, halign: "center", overflow: "linebreak", lineColor: [190, 190, 190], lineWidth: 0.15 },
      headStyles: { textColor: PDF_INK, fontStyle: "bold", fontSize: Math.min(fontSize + 0.4, 8) },
      margin: { left: 10, right: 10 },
      ...sinhalaCellHooks(doc, fontSize)
    });

    const y = doc.lastAutoTable.finalY + 7;
    drawText(doc, isAll
      ? `${SI.totalThreeTerms} — ${subjects.length} \u00d7 3. ${SI.footnoteMarks}`
      : SI.footnoteMarks, 14, y, { ptSize: 7.5, weight: "400", color: PDF_MUTED });

    const filename = `${gradeClassToken(grade, cls)}_${isAll ? "AllTerms" : term.replace(/\s+/g, "")}_ClassReport.pdf`;
    doc.save(filename);
    toast("Report downloaded.");
  }

  /* ========================================================
     ANALYSIS
     ======================================================== */
  function computeMarkHistogram(grade, cls, term, subject) {
    const students = getStudentsFor(grade, cls);
    const bins = new Array(10).fill(0);
    const marked = [];
    students.forEach((st) => {
      const v = studentMarks(st.id, term)[subject];
      if (v !== undefined && v !== null && v !== "") {
        const n = Number(v);
        marked.push(n);
        let idx = Math.floor(n / 10);
        if (idx > 9) idx = 9;
        if (idx < 0) idx = 0;
        bins[idx]++;
      }
    });
    return { bins, marked, totalStudents: students.length };
  }

  function buildHistogramSvg(counts, labels) {
    const w = 760, h = 320;
    const padL = 14, padR = 14, padT = 30, padB = 54;
    const chartW = w - padL - padR;
    const chartH = h - padT - padB;
    const n = counts.length;
    const gap = 10;
    const barW = (chartW - gap * (n - 1)) / n;
    const maxCount = Math.max(1, ...counts);
    let bars = "";
    counts.forEach((c, i) => {
      const barH = (c / maxCount) * chartH;
      const x = padL + i * (barW + gap);
      const y = padT + (chartH - barH);
      bars += `
        <rect x="${x.toFixed(1)}" y="${(c > 0 ? y : padT + chartH - 2).toFixed(1)}" width="${barW.toFixed(1)}" height="${(c > 0 ? barH : 2).toFixed(1)}" rx="4" fill="var(--primary)" opacity="${c > 0 ? 1 : 0.25}" />
        ${c > 0 ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--primary-dark)" font-family="Work Sans, sans-serif">${c}</text>` : ""}
        <text x="${(x + barW / 2).toFixed(1)}" y="${(padT + chartH + 20).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="Work Sans, sans-serif">${escapeHtml(labels[i])}</text>
      `;
    });
    return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;">
      <line x1="${padL}" y1="${padT + chartH}" x2="${padL + chartW}" y2="${padT + chartH}" stroke="var(--border)" stroke-width="1.5" />
      ${bars}
    </svg>`;
  }

  function renderAnalysis() {
    const sel = state.selections.analysis || (state.selections.analysis = { grade: GRADES[0], cls: "", term: TERMS[0], subject: "" });
    if (!sel.cls || !data.grades[sel.grade].classes.includes(sel.cls)) sel.cls = data.grades[sel.grade].classes[0] || "";
    const subjects = data.grades[sel.grade].subjects;
    if (!sel.subject || !subjects.includes(sel.subject)) sel.subject = subjects[0] || "";

    const gradeSelector = `<div class="field"><label>Grade</label><select id="an-grade">${GRADES.map((g) => `<option ${g === sel.grade ? "selected" : ""}>${g}</option>`).join("")}</select></div>`;

    if (!sel.cls) {
      return `<div class="card"><h2>Mark distribution</h2><div class="inline-form">${gradeSelector}</div>
        <div class="empty-state"><p>No classes set up for ${escapeHtml(sel.grade)} yet. Add one under Setup first.</p></div></div>`;
    }
    if (!subjects.length) {
      return `<div class="card"><h2>Mark distribution</h2><div class="inline-form">${gradeSelector}</div>
        <div class="empty-state"><p>No subjects configured for ${escapeHtml(sel.grade)}. Add subjects under Setup first.</p></div></div>`;
    }

    const { bins, marked, totalStudents } = computeMarkHistogram(sel.grade, sel.cls, sel.term, sel.subject);
    const labels = ["0-10", "10-20", "20-30", "30-40", "40-50", "50-60", "60-70", "70-80", "80-90", "90-100"];
    const avg = marked.length ? round1(marked.reduce((a, b) => a + b, 0) / marked.length) : null;
    const highest = marked.length ? Math.max(...marked) : null;
    const lowest = marked.length ? Math.min(...marked) : null;

    return `
      <div class="card">
        <h2>Mark distribution</h2>
        <p class="hint">How marks for one subject spread across a class, in bands of 10.</p>
        <div class="report-toolbar">
          ${gradeSelector}
          <div class="field"><label>Class</label><select id="an-class">${data.grades[sel.grade].classes.map((c) => `<option ${c === sel.cls ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select></div>
          <div class="field"><label>Term</label><select id="an-term">${TERMS.map((t) => `<option ${t === sel.term ? "selected" : ""}>${t}</option>`).join("")}</select></div>
          <div class="field"><label>Subject</label><select id="an-subject">${subjects.map((s) => `<option ${s === sel.subject ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}</select></div>
        </div>
        ${marked.length ? `
          <div class="grid-stats" style="margin-bottom:18px;">
            <div class="stat"><div class="num">${marked.length}/${totalStudents}</div><div class="label">Students marked</div></div>
            <div class="stat"><div class="num">${avg}%</div><div class="label">Average</div></div>
            <div class="stat"><div class="num">${highest}</div><div class="label">Highest</div></div>
            <div class="stat"><div class="num">${lowest}</div><div class="label">Lowest</div></div>
          </div>
          <div>${buildHistogramSvg(bins, labels)}</div>
        ` : `<div class="empty-state"><p>No marks recorded yet for ${escapeHtml(sel.subject)} in ${escapeHtml(sel.term)}.</p></div>`}
      </div>
    `;
  }

  function attachAnalysisEvents() {
    const sel = state.selections.analysis;
    document.getElementById("an-grade").addEventListener("change", (e) => {
      sel.grade = e.target.value;
      sel.cls = data.grades[sel.grade].classes[0] || "";
      sel.subject = "";
      render();
    });
    const clsSel = document.getElementById("an-class");
    if (clsSel) clsSel.addEventListener("change", (e) => { sel.cls = e.target.value; render(); });
    const termSel = document.getElementById("an-term");
    if (termSel) termSel.addEventListener("change", (e) => { sel.term = e.target.value; render(); });
    const subjSel = document.getElementById("an-subject");
    if (subjSel) subjSel.addEventListener("change", (e) => { sel.subject = e.target.value; render(); });
  }

  /* ========================================================
     DATA / BACKUP / LIVE SYNC
     ======================================================== */
  function renderData() {
    const syncCard = renderSyncCard();
    return `
      ${syncCard}
      <div class="card">
        <h2>Export a backup</h2>
        <p class="hint">Saves every grade, class, subject, student and mark into one file you can keep safe or move to another computer.</p>
        <button class="btn btn-primary" id="export-btn">⬇ Download backup (.json)</button>
      </div>
      <div class="card">
        <h2>Restore from a backup</h2>
        <p class="hint">Choose a previously exported file to replace everything currently stored here${isSyncActive() ? ", and everyone sharing this sync code" : ""}.</p>
        <input type="file" id="import-file" accept="application/json">
      </div>
      <div class="card">
        <h2>Start over</h2>
        <p class="hint">Permanently erase all classes, students and marks${isSyncActive() ? " for everyone sharing this sync code" : " stored on this device"}.</p>
        <button class="btn btn-danger" id="reset-btn">Erase all data</button>
      </div>
    `;
  }

  function renderSyncCard() {
    if (!isFirebaseConfigured()) {
      return `
        <div class="card">
          <h2>Live sync with other teachers</h2>
          <p class="hint">Not set up yet for this school. Cloud sync lets every subject teacher enter marks on their own phone and see one shared, up-to-date class record.</p>
          <p class="hint">To turn it on, open <b>js/firebase-config.js</b> in the project files — it has a complete 5-minute setup guide (free, no coding). Once that file has your project's details, this card will let you connect.</p>
        </div>`;
    }
    if (isSyncActive()) {
      return `
        <div class="card">
          <h2>Live sync with other teachers</h2>
          <div class="sync-badge sync-${syncStatus}" data-sync-indicator><span class="dot"></span> ${{ off: "Offline only", connecting: "Connecting…", connected: "Live sync on", error: "Sync error" }[syncStatus]}</div>
          <p class="hint" style="margin-top:12px;">This device is sharing live data using the code below. Give the same code to every teacher who should see and add to this class's marks — whatever any of you enters appears on everyone's phone automatically.</p>
          <div class="field" style="max-width:280px;">
            <label>Shared sync code</label>
            <input type="text" id="sync-code-display" value="${escapeHtml(syncCode)}" readonly>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button class="btn btn-ghost btn-sm" id="copy-sync-code">Copy code</button>
            <button class="btn btn-danger btn-sm" id="disconnect-sync">Disconnect this device</button>
          </div>
        </div>`;
    }
    return `
      <div class="card">
        <h2>Live sync with other teachers</h2>
        <div class="sync-badge sync-${syncStatus}" data-sync-indicator><span class="dot"></span> ${{ off: "Offline only", connecting: "Connecting…", connected: "Live sync on", error: "Sync error" }[syncStatus]}</div>
        <p class="hint" style="margin-top:12px;">Enter a shared code to connect this device to the rest of your teaching staff for this class. The first person to connect can share their existing data; everyone after that just joins in.</p>
        <div class="inline-form">
          <div class="field"><label>Class sync code</label><input type="text" id="sync-code-input" placeholder="e.g. ubjmv-grade6-2026"></div>
          <button class="btn btn-primary" id="connect-sync">Connect</button>
        </div>
        <p class="hint">Ask your grade coordinator for the code if one already exists — don't invent a new one, or you'll start a separate, empty room.</p>
      </div>`;
  }

  function attachDataEvents() {
    const connectBtn = document.getElementById("connect-sync");
    if (connectBtn) connectBtn.addEventListener("click", () => {
      startSync(document.getElementById("sync-code-input").value);
    });
    const disconnectBtn = document.getElementById("disconnect-sync");
    if (disconnectBtn) disconnectBtn.addEventListener("click", () => {
      confirmModal("Disconnect this device from live sync? You'll keep the data already on this device, but stop sending or receiving updates.", stopSync, "Disconnect");
    });
    const copyBtn = document.getElementById("copy-sync-code");
    if (copyBtn) copyBtn.addEventListener("click", () => {
      const input = document.getElementById("sync-code-display");
      input.select();
      navigator.clipboard && navigator.clipboard.writeText(syncCode).then(() => toast("Code copied.")).catch(() => toast("Couldn't copy — select and copy manually."));
    });

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
          confirmModal(
            isSyncActive()
              ? "This will replace all current data with the contents of this backup, for every teacher sharing this sync code. Continue?"
              : "This will replace all current data with the contents of this backup. Continue?",
            async () => {
              data = parsed;
              saveData(); render(); toast("Backup restored.");
              if (isSyncActive()) { await syncFullReplace(); toast("Shared data updated for everyone."); }
            },
            "Restore backup"
          );
        } catch (err) {
          toast("That file doesn't look like a valid backup.", "error");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });

    document.getElementById("reset-btn").addEventListener("click", () => {
      confirmWithCode(
        isSyncActive()
          ? "Erase every grade, class, student and mark — for every teacher sharing this sync code? This cannot be undone."
          : "Erase every grade, class, student and mark stored on this device? This cannot be undone.",
        async () => {
          data = buildDefaultData();
          saveData(); render(); toast("All data erased.");
          if (isSyncActive()) await syncFullReplace();
        },
        "Erase everything"
      );
    });
  }

  /* ---------- Boot ---------- */
  function reconnectSyncOnLaunch() {
    if (!isFirebaseConfigured() || !syncCode) return;
    syncStatus = "connecting";
    try {
      ensureFirebaseApp();
      attachSyncListeners();
    } catch (e) {
      console.error(e);
      syncStatus = "error";
      syncLastError = friendlySyncError(e);
      updateSyncUI();
    }
  }

  function init() {
    document.querySelectorAll(".nav button").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.view));
    });
    render();
    reconnectSyncOnLaunch();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").then((registration) => {
          // Force an immediate check for a newer service-worker.js instead of
          // waiting for the browser's own (sometimes lazy) periodic check.
          registration.update().catch(() => {});
          // If a new version is already waiting (e.g. this tab was open when
          // it arrived), nudge it to activate right away.
          if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                toast("A newer version is ready — refreshing…");
                setTimeout(() => window.location.reload(), 800);
              }
            });
          });
        }).catch((err) => console.warn("SW registration failed", err));
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
