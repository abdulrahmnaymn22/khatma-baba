(function (global) {
  "use strict";
  const JUZ_COUNT = 30;
  const REALTIME_TABLES = ["daily_khatmas", "daily_khatma_juz", "assignments", "completions", "reading_cycles", "participants", "activity", "app_users", "assignment_requests", "admin_audit_log"];
  let serverToday = null;

  function normalizeDateOnly(value, source) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`أعاد Supabase تاريخًا غير صالح للحقل ${source}.`);
    }
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error(`أعاد Supabase تاريخًا غير صالح للحقل ${source}.`);
    }
    return value;
  }

  function normalizeTimestamp(value, source, nullable = false) {
    if (value == null && nullable) return null;
    if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
      throw new Error(`أعاد Supabase توقيتًا غير صالح للحقل ${source}.`);
    }
    return value;
  }

  function client() {
    if (!global.KhatmaSupabase || !global.KhatmaSupabase.client) {
      throw new Error("أدخل رابط Supabase ومفتاح النشر في js/supabase-config.js أولًا.");
    }
    return global.KhatmaSupabase.client;
  }

  function getTodayKey(date = new Date()) {
    if (arguments.length === 0 && serverToday) return serverToday;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  async function readAll(db, table, columns, orderBy, secondaryOrderBy = "id") {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      let query = db.from(table).select(columns);
      if (orderBy) {
        query = query.order(orderBy, { ascending: table !== "activity" });
        if (secondaryOrderBy && orderBy !== secondaryOrderBy) query = query.order(secondaryOrderBy);
      }
      const { data, error } = await query.range(offset, offset + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }

  async function loadData() {
    const db = client();
    const dailyRows = await rpc("ensure_daily_khatmas", {});
    if (!Array.isArray(dailyRows)) throw new Error("لم تُرجع قاعدة البيانات قائمة الختمتين اليومية.");
    const todayRows = [1, 2].map((number) => dailyRows.find((row) => Number(row.khatma_number) === number));
    if (todayRows.some((row) => !row)) throw new Error("لم تُرجع قاعدة البيانات ختمتي اليوم معًا.");
    const todayDates = todayRows.map((row, index) => normalizeDateOnly(row.khatma_date, `daily_khatmas.khatma_date (${index + 1})`));
    if (todayDates[0] !== todayDates[1]) throw new Error("تاريخ ختمتي اليوم غير متطابق في قاعدة البيانات.");
    serverToday = todayDates[0];
    const today = serverToday;
    const [khatmas, dailyKhatmas, dailyJuzRows, people, cycles, completions, assignments, activity, users, requests, auditLog, bookingBoards] = await Promise.all([
      readAll(db, "khatmas", "id,name", "id"),
      readAll(db, "daily_khatmas", "id,khatma_date,khatma_number,status,created_at,closed_at", "khatma_date", "khatma_number"),
      readAll(db, "daily_khatma_juz", "daily_khatma_id,juz_number,status", "daily_khatma_id", "juz_number"),
      readAll(db, "participants", "id,name,active,total_completed,created_at,removed_at", "name"),
      readAll(db, "reading_cycles", "id,participant_id,cycle_number,status,started_at,completed_at", "cycle_number"),
      readAll(db, "completions", "id,assignment_id,participant_id,cycle_id,juz_number,completed_at", "id"),
      readAll(db, "assignments", "id,khatma_id,daily_khatma_id,juz_number,participant_id,cycle_id,reading_date,status,assigned_at,completed_at,expired_at,cancelled_at", "assigned_at"),
      readAll(db, "activity", "id,participant_id,participant_name,assignment_id,khatma_id,juz_number,cycle_number,status,event_date,timestamp", "timestamp"),
      readAll(db, "app_users", "user_id,role,participant_id,email,display_name,created_at", "created_at", "user_id"),
      db.from("assignment_requests").select("participant_id,khatma_id,reading_date,requested_count")
        .eq("reading_date", today).then(({ data, error }) => { if (error) throw error; return data || []; }),
      readAll(db, "admin_audit_log", "id,actor_user_id,participant_id,participant_name,action,created_at", "created_at"),
      Promise.all(todayRows.map((row) => rpc("get_daily_juz_board", { p_daily_khatma_id: row.id })))
    ]);
    if (bookingBoards.some((rows) => !Array.isArray(rows) || rows.length !== JUZ_COUNT
      || new Set(rows.map((row) => Number(row.juz_number)).values()).size !== JUZ_COUNT)) {
      throw new Error("لم تُرجع قاعدة البيانات الأجزاء الثلاثين لكل ختمة يومية.");
    }

    const completedByCycle = new Map();
    completions.forEach((row) => {
      if (!completedByCycle.has(row.cycle_id)) completedByCycle.set(row.cycle_id, []);
      completedByCycle.get(row.cycle_id).push(Number(row.juz_number));
    });
    const cyclesByPerson = new Map();
    cycles.forEach((row) => {
      if (!cyclesByPerson.has(row.participant_id)) cyclesByPerson.set(row.participant_id, []);
      cyclesByPerson.get(row.participant_id).push(row);
    });
    const participants = people.map((person) => {
      const personCycles = cyclesByPerson.get(person.id) || [];
      const current = personCycles.find((row) => row.status === "in_progress");
      return {
        id: person.id, name: person.name, active: person.active, totalCompleted: person.total_completed,
        cycle: current ? current.cycle_number : ((personCycles[personCycles.length - 1] || {}).cycle_number || 1),
        currentCycleId: current?.id || null,
        completedJuz: current ? (completedByCycle.get(current.id) || []).sort((a, b) => a - b) : [],
        cycleHistory: personCycles.filter((row) => row.status === "completed").map((row) => ({
          number: row.cycle_number, completedJuz: (completedByCycle.get(row.id) || []).sort((a, b) => a - b), completedAt: normalizeTimestamp(row.completed_at, "reading_cycles.completed_at", true)
        }))
      };
    });
    const khatmaRows = khatmas.map((row) => ({ id: row.id, name: row.name, dailyAssignments: {} }));
    assignments.forEach((row) => {
      const khatma = khatmaRows.find((item) => item.id === row.khatma_id);
      if (!khatma) return;
      if (!khatma.dailyAssignments[row.reading_date]) khatma.dailyAssignments[row.reading_date] = {};
      khatma.dailyAssignments[row.reading_date][row.juz_number] = {
        id: row.id, participantId: row.participant_id,
        cycleNumber: cycles.find((cycle) => cycle.id === row.cycle_id)?.cycle_number || 1,
        status: row.status, assignedAt: normalizeTimestamp(row.assigned_at, "assignments.assigned_at"), completedAt: normalizeTimestamp(row.completed_at, "assignments.completed_at", true),
        expiredAt: normalizeTimestamp(row.expired_at, "assignments.expired_at", true), date: normalizeDateOnly(row.reading_date, "assignments.reading_date"),
        dailyKhatmaId: row.daily_khatma_id || null
      };
    });
    const bookingBoardBySlot = new Map(bookingBoards.flat().map((row) => [`${row.daily_khatma_id}:${row.juz_number}`, row]));
    return {
      version: 4, todayDate: today,
      dailyKhatmas: dailyKhatmas.map((row) => ({ id: row.id, date: normalizeDateOnly(row.khatma_date, "daily_khatmas.khatma_date"), number: Number(row.khatma_number), status: row.status, closedAt: normalizeTimestamp(row.closed_at, "daily_khatmas.closed_at", true) })),
      dailyJuzStatuses: dailyJuzRows.map((row) => {
        const boardRow = bookingBoardBySlot.get(`${row.daily_khatma_id}:${row.juz_number}`);
        return { dailyKhatmaId: row.daily_khatma_id, juzNumber: Number(row.juz_number), status: row.status,
          reservedByName: boardRow?.participant_name || null, reservedByMe: boardRow?.reserved_by_me || false };
      }),
      participants, users, requests, khatmas: khatmaRows,
      history: activity.map((row) => ({
        id: row.id, participantId: row.participant_id, participantName: row.participant_name,
        juzNumber: row.juz_number, khatmaId: row.khatma_id, date: normalizeDateOnly(row.event_date, "activity.event_date"),
        cycleNumber: row.cycle_number, status: row.status, timestamp: normalizeTimestamp(row.timestamp, "activity.timestamp")
      })),
      auditLog: auditLog.map((row) => ({ ...row, created_at: normalizeTimestamp(row.created_at, "admin_audit_log.created_at") }))
    };
  }

  function getKhatma(data, id) { return data.khatmas.find((item) => item.id === id); }
  function getParticipant(data, id) { return data.participants.find((item) => item.id === id); }
  function getActiveParticipants(data) { return data.participants.filter((item) => item.active); }
  function getTodayAssignments(khatma, date = getTodayKey()) { return khatma?.dailyAssignments[date] || {}; }
  function getProgress(person) {
    const completed = person.completedJuz.length;
    return { completed, remaining: Math.max(0, JUZ_COUNT - completed), percentage: Math.round(completed / JUZ_COUNT * 100) };
  }
  function messageFrom(error) {
    const message = error && error.message ? error.message : "تعذر الاتصال بقاعدة البيانات.";
    return message.replace(/^.*?\|\s*/, "");
  }
  async function rpc(name, args = {}) {
    const { data, error } = await client().rpc(name, args);
    if (error) throw new Error(messageFrom(error));
    return data;
  }

  async function importLegacyData() {
    let raw;
    try {
      raw = global.localStorage.getItem("khatma-baba:data") || global.localStorage.getItem("khatma-baba:data:v1");
    } catch (_error) {
      throw new Error("تعذر قراءة بيانات هذا المتصفح. صدّر النسخة القديمة ثم حاول من الجهاز الذي يحتويها.");
    }
    if (!raw) throw new Error("لم نعثر على بيانات محلية قديمة في هذا المتصفح.");
    let state;
    try { state = JSON.parse(raw); }
    catch (_error) { throw new Error("البيانات المحلية القديمة غير صالحة بصيغة JSON."); }
    return rpc("import_legacy_state", { p_state: state });
  }

  async function addParticipant(_data, name) {
    const clean = String(name || "").trim().replace(/\s+/g, " ");
    if (!clean) throw new Error("يرجى كتابة اسم المشارك.");
    return rpc("create_participant", { p_name: clean });
  }
  async function regenerateParticipantPin(participantId) {
    return rpc("regenerate_participant_pin", { p_participant_id: participantId });
  }
  function canAssignJuz(data, participantId, juzNumber) {
    const person = getParticipant(data, participantId);
    const juz = Number(juzNumber);
    if (!person || !person.active) return { allowed: false, reason: "لم يتم العثور على ملف مشارك نشط." };
    if (!Number.isInteger(juz) || juz < 1 || juz > JUZ_COUNT) return { allowed: false, reason: "رقم الجزء يجب أن يكون من ١ إلى ٣٠." };
    if (person.completedJuz.includes(juz)) return { allowed: false, reason: `سبق أن أتممت الجزء ${juz} في دورتك الحالية.` };
    return { allowed: true, reason: "يمكن إسناد هذا الجزء." };
  }
  async function assignJuz(_data, participantId, khatmaId, juzNumber) {
    await rpc("assign_juz", { p_participant_id: participantId, p_khatma_id: khatmaId, p_juz_number: Number(juzNumber), p_reading_date: getTodayKey() });
    return { person: { id: participantId }, khatma: { id: khatmaId }, juz: Number(juzNumber) };
  }
  async function reserveDailyJuz(dailyKhatmaId, juzNumbers) {
    if (!Array.isArray(juzNumbers) || !juzNumbers.length) throw new Error("اختر جزءًا واحدًا على الأقل للحجز.");
    return rpc("reserve_daily_juz", { p_daily_khatma_id: dailyKhatmaId, p_juz_numbers: juzNumbers.map(Number) });
  }
  async function completeJuz(data, khatmaId, juzNumber) {
    const assignment = getTodayAssignments(getKhatma(data, khatmaId))[juzNumber];
    if (!assignment?.id) throw new Error("لا يوجد إسناد لهذا الجزء اليوم.");
    const result = await rpc("complete_juz", { p_assignment_id: assignment.id });
    const person = getParticipant(data, result.participant_id);
    return { person, khatma: getKhatma(data, khatmaId), juz: Number(juzNumber), cycleCompleted: result.cycle_completed, completedCycle: result.cycle_number };
  }
  async function removeParticipant(_data, participantId) { await rpc("remove_participant", { p_participant_id: participantId }); }
  async function reactivateParticipant(participantId) { return rpc("reactivate_participant", { p_participant_id: participantId }); }
  async function linkParticipantAccount(userId, participantId) {
    await rpc("link_participant_account", { p_user_id: userId, p_participant_id: participantId || null });
  }
  async function reassignJuz(data, khatmaId, juzNumber, participantId) {
    const assignment = getTodayAssignments(getKhatma(data, khatmaId))[juzNumber];
    if (!assignment?.id) throw new Error("لا يوجد إسناد نشط لتغييره.");
    await rpc("reassign_juz", { p_assignment_id: assignment.id, p_new_participant_id: participantId });
    return { person: getParticipant(data, participantId), khatma: getKhatma(data, khatmaId), juz: Number(juzNumber) };
  }
  async function generateAssignments(_data, khatmaId) {
    const result = await rpc("generate_assignments", { p_khatma_id: khatmaId, p_reading_date: getTodayKey() });
    return (result?.assignments || []).map((item) => Number(item.juz_number));
  }
  async function setAssignmentRequest(_data, participantId, khatmaId, requestedCount) {
    const count = Number(requestedCount);
    if (!Number.isInteger(count) || count < 0 || count > JUZ_COUNT) throw new Error("عدد الأجزاء المطلوبة يجب أن يكون من ٠ إلى ٣٠.");
    await rpc("set_assignment_request", {
      p_participant_id: participantId, p_khatma_id: khatmaId,
      p_requested_count: count, p_reading_date: getTodayKey()
    });
  }
  function getAssignmentRequest(data, participantId, khatmaId) {
    return data.requests?.find((request) => request.participant_id === participantId && request.khatma_id === khatmaId)?.requested_count ?? 30;
  }
  async function resetTodayAssignments(_data) { return rpc("reset_today_assignments", { p_reading_date: getTodayKey() }); }
  function subscribe(onChange, onStatus, context) {
    const db = client();
    const isAdmin = context?.profile?.role === "admin";
    const participantId = isAdmin ? null : context?.profile?.participant_id;
    const filters = {
      assignments: participantId ? `participant_id=eq.${participantId}` : null,
      completions: participantId ? `participant_id=eq.${participantId}` : null,
      reading_cycles: participantId ? `participant_id=eq.${participantId}` : null,
      participants: participantId ? `id=eq.${participantId}` : null,
      activity: participantId ? `participant_id=eq.${participantId}` : null,
      assignment_requests: participantId ? `participant_id=eq.${participantId}` : null,
      app_users: isAdmin ? null : `user_id=eq.${context?.user?.id || ""}`,
      admin_audit_log: isAdmin ? null : "id=eq.-1"
    };
    const channel = db.channel(`khatma-shared-${context?.user?.id || "session"}`);
    let changeTimer = null;
    REALTIME_TABLES.forEach((table) => {
      const filter = filters[table];
      if (filter === "id=eq.-1") return;
      const config = { event: "*", schema: "public", table };
      if (filter) config.filter = filter;
      ["INSERT", "UPDATE"].forEach((event) => channel.on("postgres_changes", { ...config, event }, () => {
        global.clearTimeout(changeTimer);
        changeTimer = global.setTimeout(() => onChange?.(table), 100);
      }));
    });
    channel.subscribe((status, error) => onStatus?.(status, error));
    return () => {
      global.clearTimeout(changeTimer);
      return db.removeChannel(channel);
    };
  }

  global.KhatmaData = { JUZ_COUNT, loadData, getKhatma, getParticipant, getActiveParticipants, getTodayKey, getTodayAssignments,
    getProgress, getAssignmentRequest, addParticipant, removeParticipant, canAssignJuz, assignJuz, reassignJuz,
    generateAssignments, setAssignmentRequest, reserveDailyJuz, resetTodayAssignments, completeJuz, importLegacyData, linkParticipantAccount, regenerateParticipantPin, reactivateParticipant, subscribe };
})(window);
