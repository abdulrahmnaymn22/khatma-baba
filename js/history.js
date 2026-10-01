(function () {
  "use strict";
  const { loadData, getTodayKey, getKhatma } = window.KhatmaData;
  let data = { participants: [], khatmas: [], history: [] };
  let displayedHistory = [];
  const participantSelect = document.getElementById("participant-history-select");
  const statusNames = { assigned: "مخصص", completed: "تمت القراءة", expired: "انتهى اليوم ولم تتم القراءة", cycle_completed: "اكتملت الدورة", cycle_started: "بدأت دورة جديدة", cancelled: "تم إلغاء الإسناد", assignment_changed: "تغيير الإسناد" };

  participantSelect.addEventListener("change", renderHistoryPage);
  document.querySelectorAll("#admin-history-filters input,#admin-history-filters select").forEach((input) => input.addEventListener("change", renderHistoryPage));
  document.getElementById("clear-history-filters").addEventListener("click", () => {
    document.getElementById("history-date-filter").value = "";
    document.getElementById("history-khatma-filter").value = "";
    document.getElementById("history-status-filter").value = "";
    document.getElementById("history-cycle-filter").value = "";
    renderHistoryPage();
  });
  window.addEventListener("hashchange", updatePageView);
  window.addEventListener("khatma:modechange", () => { if (window.location.hash === "#history") renderHistoryPage(); });
  updatePageView();
  window.addEventListener("khatma:historyrefresh", () => { if (window.location.hash === "#history") renderHistoryPage(); });

  function updatePageView() {
    const showHistory = window.location.hash === "#history";
    document.getElementById("home-view").hidden = showHistory;
    document.getElementById("history").hidden = !showHistory;
    if (showHistory) renderHistoryPage();
  }

  async function renderHistoryPage() {
    if (!window.KhatmaMode || !window.KhatmaMode.getParticipantId() && window.KhatmaMode.getMode() !== "admin") {
      document.getElementById("today-history").innerHTML = empty("سجّل الدخول لعرض السجل المشترك.");
      document.getElementById("previous-history").innerHTML = "";
      document.getElementById("participant-history").innerHTML = "";
      document.getElementById("completed-cycles").innerHTML = "";
      return;
    }
    try { data = await loadData(); }
    catch (error) {
      document.getElementById("today-history").innerHTML = empty("تعذر تحميل السجل. تحقق من الاتصال ثم أعد المحاولة.");
      return;
    }
    const isAdmin = window.KhatmaMode && window.KhatmaMode.getMode() === "admin";
    const previousSelection = participantSelect.value;
    participantSelect.innerHTML = `<option value="">كل المشاركين</option>${data.participants.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}${person.active ? "" : " (موقوف)"}</option>`).join("")}`;
    if (previousSelection && data.participants.some((person) => person.id === previousSelection)) participantSelect.value = previousSelection;
    document.getElementById("admin-history-filters").hidden = !isAdmin;
    fillCycleFilter();
    const today = getTodayKey();
    const selectedId = isAdmin ? participantSelect.value : window.KhatmaMode.getParticipantId();
    const dateFilter = document.getElementById("history-date-filter").value;
    const khatmaFilter = document.getElementById("history-khatma-filter").value;
    const statusFilter = document.getElementById("history-status-filter").value;
    const cycleFilter = document.getElementById("history-cycle-filter").value;
    displayedHistory = data.history.filter((event) => {
      if (selectedId && event.participantId !== selectedId) return false;
      if (dateFilter && event.date !== dateFilter) return false;
      if (khatmaFilter && event.khatmaId !== khatmaFilter) return false;
      if (statusFilter && event.status !== statusFilter) return false;
      if (cycleFilter && String(event.cycleNumber || "") !== cycleFilter) return false;
      return true;
    });
    const displayDate = dateFilter || today;
    document.getElementById("history-today-date").textContent = dateFilter ? `سجل يوم ${formatDate(dateFilter)}` : `اليوم · ${formatDate(today)}`;
    document.getElementById("today-history").innerHTML = renderEvents(displayedHistory.filter((event) => event.date === displayDate));
    const oldEvents = displayedHistory.filter((event) => event.date < displayDate).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const dayGroups = groupBy(oldEvents, (event) => event.date);
    const previous = [...dayGroups.entries()].map(([date, events]) => `<details class="history-day"><summary><span>${formatDate(date)}</span><span class="history-day-count">${events.length} حدث</span></summary>${renderEvents(events)}</details>`).join("");
    document.getElementById("previous-history").innerHTML = previous || empty("لا توجد أحداث محفوظة من الأيام السابقة بعد.");
    renderParticipantHistory();
    renderCompletedCycles();
  }

  function fillCycleFilter() {
    const select = document.getElementById("history-cycle-filter"), selected = select.value;
    const knownCycles = [...data.history.map((event) => event.cycleNumber), ...data.participants.flatMap((person) => [person.cycle, ...(person.cycleHistory || []).map((cycle) => cycle.number)])];
    const cycles = [...new Set(knownCycles.filter(Boolean))].sort((a, b) => a - b);
    select.innerHTML = '<option value="">كل الدورات</option>' + cycles.map((cycle) => `<option value="${cycle}">الدورة ${cycle}</option>`).join("");
    if (cycles.some((cycle) => String(cycle) === selected)) select.value = selected;
  }

  function renderEvents(events) {
    if (!events.length) return empty("لا توجد إسنادات أو إكمالات مسجلة هنا بعد.");
    return `<div class="history-events">${events.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map((event) => {
      const khatma = event.khatmaId ? getKhatma(data, event.khatmaId) : null;
      const juzText = event.juzNumber ? `الجزء ${event.juzNumber}` : `الدورة ${event.cycleNumber}`;
      return `<article class="history-event status-${event.status}"><span class="history-event-mark" aria-hidden="true">${event.status === "completed" || event.status === "cycle_completed" ? "✓" : event.status === "expired" ? "⌛" : "·"}</span><div class="history-event-main"><strong>${escapeHtml(event.participantName || "مشارك")}</strong><span>${juzText}${khatma ? ` · ${escapeHtml(khatma.name)}` : ""} · ${formatDate(event.date)}</span></div><span class="history-event-status">${statusNames[event.status] || "تحديث"}</span><time datetime="${escapeHtml(event.timestamp)}">${formatTime(event.timestamp)}</time></article>`;
    }).join("")}</div>`;
  }

  function renderParticipantHistory() {
    const isAdmin = window.KhatmaMode && window.KhatmaMode.getMode() === "admin";
    const selectedId = isAdmin ? participantSelect.value : (window.KhatmaMode && window.KhatmaMode.getParticipantId());
    const person = data.participants.find((item) => item.id === selectedId);
    const container = document.getElementById("participant-history");
    if (!person) { container.innerHTML = empty("أضف مشاركًا لتظهر رحلته هنا."); return; }
    const events = displayedHistory.filter((event) => event.participantId === person.id).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const byCycle = groupBy(events, (event) => event.cycleNumber || person.cycle);
    const cycles = [...byCycle.entries()].map(([cycleNumber, cycleEvents]) => {
      const dates = groupBy(cycleEvents, (event) => event.date);
      const dayRows = [...dates.entries()].map(([date, dayEvents]) => {
        const completions = dayEvents.filter((event) => event.status === "completed" && event.juzNumber);
        const assignments = dayEvents.filter((event) => event.status === "assigned" && event.juzNumber);
        const expired = dayEvents.filter((event) => event.status === "expired" && event.juzNumber);
        const cycleEventsForDay = dayEvents.filter((event) => event.status.startsWith("cycle_"));
        const parts = [completions.length && `قرأ: ${completions.map((event) => event.juzNumber).join("، ")}`, assignments.length && `مخصص: ${assignments.map((event) => event.juzNumber).join("، ")}`, expired.length && `انتهى دون قراءة: ${expired.map((event) => event.juzNumber).join("، ")}`, cycleEventsForDay.map((event) => statusNames[event.status]).join("، ")].filter(Boolean).join(" · ");
        const khatmas = [...new Set(dayEvents.filter((event) => event.khatmaId).map((event) => getKhatma(data, event.khatmaId)?.name).filter(Boolean))].join("، ");
        return `<div class="timeline-day"><time>${formatDate(date)}</time><div><strong>${parts || "تحديث الدورة"}</strong><span>${escapeHtml(khatmas)}</span></div></div>`;
      }).join("");
      const archived = (person.cycleHistory || []).find((cycle) => cycle.number === Number(cycleNumber));
      return `<article class="timeline-cycle"><header><strong>الدورة ${cycleNumber}</strong><span class="cycle-badge ${archived ? "is-complete" : ""}">${archived ? "مكتملة · ٣٠/٣٠" : "قيد القراءة"}</span></header><div class="timeline-days">${dayRows || '<p class="history-muted">لا توجد تفاصيل يومية محفوظة لهذه الدورة.</p>'}</div>${archived ? `<p class="cycle-next">اكتملت الدورة ${cycleNumber} · بدأت الدورة ${Number(cycleNumber) + 1}</p>` : ""}</article>`;
    }).join("");
    container.innerHTML = cycles || empty("لم تُسجل قراءات لهذا المشارك بعد.");
  }

  function renderCompletedCycles() {
    const isAdmin = window.KhatmaMode && window.KhatmaMode.getMode() === "admin";
    const selectedId = isAdmin ? participantSelect.value : (window.KhatmaMode && window.KhatmaMode.getParticipantId());
    const participants = isAdmin && !selectedId ? data.participants : data.participants.filter((person) => person.id === selectedId);
    const selectedCycle = document.getElementById("history-cycle-filter").value;
    const cycles = participants.flatMap((person) => (person.cycleHistory || []).filter((cycle) => !selectedCycle || String(cycle.number) === selectedCycle).map((cycle) => ({ person, cycle })));
    document.getElementById("completed-cycles-count").textContent = `${cycles.length} دورة`;
    document.getElementById("completed-cycles").innerHTML = cycles.length ? cycles.map(({ person, cycle }) => `<article class="completed-cycle"><span class="completed-check" aria-hidden="true">✓</span><div><strong>${escapeHtml(person.name)}</strong><span>الدورة ${cycle.number} · ٣٠ من ٣٠ جزءًا</span><time>${formatDate(getTodayKey(new Date(cycle.completedAt)))}</time></div><span class="cycle-badge is-complete">مكتملة</span></article>`).join("") : empty("لم تكتمل دورة بعد. ستظهر هنا الدورات المكتملة محفوظة.");
  }

  function groupBy(items, selector) {
    return items.reduce((groups, item) => {
      const key = selector(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
      return groups;
    }, new Map());
  }
  function empty(text) { return `<div class="empty-state">${text}</div>`; }
  function formatDate(value) {
    const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
    return new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo" }).format(date);
  }
  function formatTime(value) { return new Intl.DateTimeFormat("ar-EG", { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
})();
