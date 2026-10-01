(async function () {
  "use strict";
  const Store = window.KhatmaData;
  const Auth = window.KhatmaAuth;
  const { JUZ_COUNT, loadData, getParticipant, getTodayAssignments, getProgress, getActiveParticipants,
    addParticipant, removeParticipant, assignJuz, reserveDailyJuz, reassignJuz, generateAssignments, setAssignmentRequest, getAssignmentRequest,
    resetTodayAssignments, completeJuz, importLegacyData, regenerateParticipantPin, reactivateParticipant, subscribe } = Store;
  // Keep the signed-out/loading state on the same shape as KhatmaData.loadData().
  // render() runs before session loading finishes, including on a fresh visit.
  const emptyData = {
    version: 4, todayDate: null, dailyKhatmas: [], dailyJuzStatuses: [],
    history: [], participants: [], users: [], requests: [], auditLog: [], khatmas: [
    { id: "khatma-1", name: "الختمة الأولى", dailyAssignments: {} },
    { id: "khatma-2", name: "الختمة الثانية", dailyAssignments: {} }
  ] };
  let data = emptyData;
  let userContext = null;
  let mode = "participant";
  let activeKhatmaId = "khatma-1";
  let participantKhatmaId = "khatma-1";
  let selectedReadingDate = null;
  let knownToday = null;
  let unsubscribe = null;
  let toastTimer = null;
  let refreshPromise = null;
  let refreshAgain = false;
  let realtimeRefreshTimer = null;
  const $ = (selector) => document.querySelector(selector);
  const tabs = $("#khatma-tabs"), board = $("#khatma-board"), participantsList = $("#participants-list");
  const form = $("#participation-form"), selfSelect = $("#self-participant-select");
  const authDialog = $("#auth-dialog"), authForm = $("#auth-form");

  window.KhatmaMode = { getMode: () => mode, getParticipantId: () => userContext?.profile.participant_id || null };

  async function refreshData(notifyHistory = true) {
    if (refreshPromise) {
      refreshAgain = true;
      return refreshPromise;
    }
    refreshPromise = (async () => {
      do {
        refreshAgain = false;
        const latest = await loadData();
        data = latest;
        setSyncStatus("");
        if (!selectedReadingDate || !data.dailyKhatmas.some((day) => day.date === selectedReadingDate) || selectedReadingDate === knownToday) selectedReadingDate = data.todayDate;
        knownToday = data.todayDate;
        render();
        if (notifyHistory) window.dispatchEvent(new CustomEvent("khatma:datachange"));
      } while (refreshAgain);
    })();
    try { await refreshPromise; }
    finally { refreshPromise = null; }
  }
  function setSyncStatus(message) {
    document.querySelectorAll(".sync-status").forEach((element) => {
      element.textContent = message;
      element.hidden = !message;
    });
  }
  function scheduleAuthoritativeRefresh() {
    window.clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = window.setTimeout(() => {
      if (userContext) refreshData().catch(() => setSyncStatus("تعذر تحديث البيانات الآن. ستُعاد المزامنة تلقائيًا عند عودة الاتصال."));
    }, 120);
  }
  function render() {
    document.body.classList.toggle("admin-mode", mode === "admin");
    const isAdmin = userContext?.profile.role === "admin";
    const adminView = Boolean(isAdmin && mode === "admin");
    const participantView = Boolean(userContext && !isAdmin && mode === "participant");
    $("#admin-sidebar").hidden = !adminView;
    $("#admin-dashboard").hidden = !adminView;
    $("#participant-dashboard").hidden = !participantView;
    $("#dashboard").hidden = true;
    $("#participant-self-service").hidden = !userContext;
    $("#khatmas").hidden = !adminView;
    $("#join").hidden = !adminView;
    $("#participants-section").hidden = !adminView;
    $("#profile-form").hidden = !userContext;
    if (userContext) {
      $("#profile-email").textContent = userContext.profile.email || userContext.user.email || "";
      $("#profile-display-name").value = userContext.profile.display_name || "";
      $("#profile-role").textContent = userContext.profile.role === "admin" ? "مشرف النظام" : (userContext.participant ? `مشارك مرتبط: ${userContext.participant.name}` : "مشارك — بانتظار ربط ملفك من الإدارة");
    }
    const nameInput = form.querySelector('[name="name"]');
    if (userContext?.profile.role === "participant") {
      nameInput.value = userContext.participant?.name || "";
      nameInput.readOnly = true;
    } else {
      nameInput.value = "";
      nameInput.readOnly = false;
    }
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === mode);
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
      button.disabled = !userContext || (isAdmin && button.dataset.mode === "participant") || (!isAdmin && button.dataset.mode === "admin");
    });
    document.querySelectorAll(".auth-button").forEach((button) => {
      button.textContent = userContext ? "تسجيل الخروج" : "تسجيل الدخول";
    });
    const heroLink = document.querySelector(".hero-link");
    heroLink.href = adminView ? "#admin-dashboard" : "#participant-dashboard";
    heroLink.innerHTML = adminView ? 'لوحة الإدارة <span>↓</span>' : 'تابع وردك اليوم <span>↓</span>';
    renderDashboard(); renderAdminDashboard(); renderTabs(); renderDateSelector(); renderBoard(); renderParticipantDashboard(); renderSelfService(); renderParticipants();
  }
  function renderAdminDashboard() {
    if (!data.todayDate) return;
    const todayAssignments = data.khatmas.flatMap((khatma) => Object.values(getTodayAssignments(khatma, data.todayDate)));
    const completedPerKhatma = data.khatmas.map((khatma) => Object.values(getTodayAssignments(khatma, data.todayDate)).filter((item) => item.status === "completed").length);
    const assignments = todayAssignments.filter((item) => item.status === "assigned").length;
    const completed = todayAssignments.filter((item) => item.status === "completed").length;
    const expired = todayAssignments.filter((item) => item.status === "expired").length;
    const stats = [
      ["عدد المشاركين", data.participants.length, "كل الملفات"],
      ["الختمة الأولى", `${completedPerKhatma[0] || 0} / ٣٠`, "تمت القراءة"],
      ["الختمة الثانية", `${completedPerKhatma[1] || 0} / ٣٠`, "تمت القراءة"],
      ["الأجزاء المخصصة", assignments, "بانتظار القراءة"],
      ["تمت قراءتها", completed, "من الختمتين"],
      ["انتهى وقتها", expired, "لم تُحتسب في الدورات"],
      ["المشاركون النشطون", getActiveParticipants(data).length, "ملفات فعالة"]
    ];
    $("#admin-dashboard-date").textContent = `ختمة يوم ${formatFullDate(data.todayDate)}`;
    $("#admin-dashboard-stats").innerHTML = stats.map(([label, value, note]) => `<article class="admin-stat-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join("");
    const auditLabels = { participant_created: "إضافة مشارك", participant_deactivated: "إيقاف مشارك", participant_reactivated: "إعادة تفعيل مشارك", pin_regenerated: "تجديد رقم سري" };
    const recent = (data.auditLog || []).slice(0, 8);
    $("#admin-audit-list").innerHTML = recent.length ? recent.map((event) => `<article><span>${escapeHtml(auditLabels[event.action] || "إجراء إداري")} · ${escapeHtml(event.participant_name)}</span><time>${formatDate(event.created_at)}، ${formatTime(event.created_at)}</time></article>`).join("") : '<p class="empty-state">لا توجد إجراءات إدارية مسجلة بعد.</p>';
    $("#generate-both-khatmas").onclick = () => {
      const hasAssignments = todayAssignments.some((item) => ["assigned", "completed"].includes(item.status));
      if (hasAssignments && !window.confirm("توجد إسنادات بالفعل. سيُكمل النظام توزيع الأجزاء المتاحة فقط ويحافظ على الإسنادات الحالية. هل تريد المتابعة؟")) return;
      mutate(async () => {
        let count = 0;
        for (const khatma of data.khatmas) count += (await generateAssignments(data, khatma.id)).length;
        return count ? `تم توزيع ${count} جزءًا جديدًا على الختمتين.` : "لا توجد أجزاء جديدة متاحة للتوزيع.";
      });
    };
  }
  function renderDashboard() {
    const totals = data.khatmas.map((khatma) => Object.values(getTodayAssignments(khatma)).filter((item) => item.status === "completed").length);
    const completed = totals.reduce((sum, count) => sum + count, 0);
    const stats = [
      { label: "الختمة الأولى", value: `${totals[0]} / ٣٠`, note: "جزء مكتمل اليوم", icon: "١" },
      { label: "الختمة الثانية", value: `${totals[1]} / ٣٠`, note: "جزء مكتمل اليوم", icon: "٢" },
      { label: "الأجزاء المكتملة", value: completed, note: "من أصل ٦٠ جزءًا", icon: "✓" },
      { label: "الأجزاء المتبقية", value: 60 - completed, note: "في ختمتي اليوم", icon: "◷" },
      { label: "عدد المشاركين", value: getActiveParticipants(data).length, note: "قارئًا وقارئة", icon: "♧" }
    ];
    $("#dashboard-stats").innerHTML = stats.map((item) => `<article class="stat-card"><span class="stat-icon" aria-hidden="true">${item.icon}</span><span class="stat-label">${item.label}</span><strong>${item.value}</strong><span class="stat-note">${item.note}</span></article>`).join("");
    $("#dashboard-date").textContent = formatToday();
    $("#today").textContent = formatToday();
  }
  function renderParticipantDashboard() {
    const root = $("#participant-dashboard-content");
    const person = userContext?.participant;
    $("#participant-dashboard-date").textContent = data.todayDate ? `ختمة يوم ${formatFullDate(data.todayDate)}` : "";
    if (!person || !person.active) {
      root.innerHTML = '<div class="participant-empty-card">تعذر العثور على ملف مشارك نشط لهذا الدخول. تواصل مع المشرف.</div>';
      return;
    }

    if (!data.khatmas.some((khatma) => khatma.id === participantKhatmaId)) participantKhatmaId = "khatma-1";
    const participantKhatmaTabs = data.khatmas.map((khatma) => `<button type="button" class="participant-khatma-tab ${khatma.id === participantKhatmaId ? "active" : ""}" role="tab" aria-selected="${khatma.id === participantKhatmaId}" data-participant-khatma="${khatma.id}">${escapeHtml(khatma.name)}</button>`).join("");
    const selectedKhatmas = data.khatmas.filter((khatma) => khatma.id === participantKhatmaId);
    const khatmaCards = selectedKhatmas.map((khatma) => {
      const khatmaNumber = khatma.id === "khatma-1" ? 1 : 2;
      const dailyKhatma = data.dailyKhatmas.find((day) => day.date === data.todayDate && day.number === khatmaNumber);
      const publicStatus = new Map((data.dailyJuzStatuses || []).filter((row) => row.dailyKhatmaId === dailyKhatma?.id)
        .map((row) => [row.juzNumber, row]));
      const ownAssignments = getTodayAssignments(khatma, data.todayDate);
      const bookingJuzGrid = Array.from({ length: JUZ_COUNT }, (_, index) => {
        const juz = index + 1, statusRow = publicStatus.get(juz) || { status: "available", reservedByName: null };
        const record = ownAssignments[juz];
        const completedInCycle = person.completedJuz.includes(juz);
        const reservedByMe = Boolean(statusRow.reservedByMe)
          || Boolean(record && ["assigned", "completed"].includes(record.status));
        const myStatus = record?.status || statusRow.status;
        const isAvailable = !completedInCycle && !reservedByMe && ["available", "expired"].includes(statusRow.status);
        let stateClass, stateLabel, ownerLabel = "", action = "";
        if (completedInCycle) {
          stateClass = "cycle-completed";
          stateLabel = "أتممته في دورتك الحالية — لا يمكن حجزه";
        } else if (reservedByMe) {
          stateClass = `reserved-by-me status-${myStatus}`;
          stateLabel = myStatus === "assigned" ? "محجوز لك · بانتظار القراءة" : myStatus === "completed" ? "محجوز لك · تمت القراءة" : "انتهى اليوم ولم تتم القراءة";
          if (myStatus === "assigned" && record?.id) action = `<button type="button" class="participant-complete-button" data-personal-complete="${khatma.id}|${juz}">تمت القراءة</button>`;
          else if (myStatus === "completed") stateLabel += " في هذه الختمة";
        } else if (statusRow.status === "assigned" || statusRow.status === "completed") {
          stateClass = `reserved-by-other status-${statusRow.status}`;
          stateLabel = statusRow.status === "completed" ? "تمت القراءة" : "محجوز";
          ownerLabel = statusRow.reservedByName ? `<small class="booking-owner">حجزه: ${escapeHtml(statusRow.reservedByName)}</small>` : "";
        } else {
          stateClass = "available";
          stateLabel = statusRow.status === "expired" ? "متاح بعد انتهاء الإسناد السابق" : "متاح للحجز";
          action = `<label class="booking-select"><input type="checkbox" name="juz" value="${juz}" data-booking-juz><span>اختيار</span></label>`;
        }
        return `<article class="booking-juz-card ${stateClass}"><div class="booking-juz-heading"><strong>الجزء ${juz}</strong><span class="booking-juz-status">${stateLabel}</span>${ownerLabel}</div>${action}</article>`;
      }).join("");
      const assignments = Object.entries(getTodayAssignments(khatma, data.todayDate))
        .map(([juz, record]) => ({ juz: Number(juz), record }))
        .filter(({ record }) => record.participantId === person.id && ["assigned", "completed", "expired"].includes(record.status))
        .sort((a, b) => a.juz - b.juz);
      const items = assignments.map(({ juz, record }) => {
        const complete = record.status === "completed";
        const expired = record.status === "expired";
        const status = complete ? "تمت القراءة ✅" : expired ? "انتهى اليوم ولم تتم القراءة" : "مخصص لك";
        const action = record.status === "assigned" ? `<button type="button" class="participant-complete-button" data-personal-complete="${khatma.id}|${juz}">تمت القراءة</button>` : "";
        return `<article class="participant-assignment-card ${complete ? "is-completed" : expired ? "is-expired" : "is-assigned"}"><div class="participant-assignment-copy"><strong>📖 الجزء ${juz}</strong><span class="participant-assignment-status">${status}</span><span class="participant-assignment-time">وُزّع الساعة ${formatTime(record.assignedAt)}</span><span class="participant-assignment-khatma">${escapeHtml(khatma.name)}</span></div>${action}</article>`;
      }).join("");
      return `<section class="participant-khatma-card"><h3>${escapeHtml(khatma.name)}</h3><div class="participant-assignment-list">${items || '<p class="participant-no-khatma-assignments">لا توجد أجزاء مخصصة لك في هذه الختمة اليوم.</p>'}</div><form class="manual-booking-form" data-booking-form="${escapeHtml(dailyKhatma?.id || "")}"><div class="booking-grid" aria-label="الأجزاء المتاحة والمحجوزة في ${escapeHtml(khatma.name)}">${bookingJuzGrid}</div><p class="booking-hint">اختر جزءًا أو أكثر من الأجزاء المتاحة. سيُتحقق من الحجز والدورة الحالية في قاعدة البيانات.</p><button class="submit-button booking-submit" type="submit" disabled>حجز الأجزاء المحددة</button></form></section>`;
    }).join("");

    const hasAssignmentsToday = data.khatmas.flatMap((khatma) => Object.values(getTodayAssignments(khatma, data.todayDate)))
      .some((record) => record.participantId === person.id && ["assigned", "completed", "expired"].includes(record.status));
    const noAssignments = !hasAssignmentsToday
      ? '<p class="participant-no-assignments" role="status">لا توجد أجزاء مخصصة لك اليوم.</p>' : "";
    const progress = getProgress(person);
    const completedToday = (person.cycleHistory || []).find((cycle) => cycle.completedAt && Store.getTodayKey(new Date(cycle.completedAt)) === data.todayDate);
    const cycleMessage = completedToday
      ? '<div class="participant-cycle-success" role="status"><strong>ما شاء الله 🤍</strong><span>أتممت قراءة القرآن في دورتك الحالية.</span><span>بدأت دورة جديدة</span></div>' : "";
    const history = data.history.filter((event) => event.participantId === person.id && event.juzNumber && ["completed", "expired"].includes(event.status))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 12);
    const historyRows = history.length ? history.map((event) => {
      const khatma = getParticipantKhatmaName(event.khatmaId);
      const label = event.status === "completed" ? "تمت القراءة" : "انتهى اليوم ولم تتم القراءة";
      return `<li class="participant-history-row"><time>${formatFullDate(event.date)}</time><span>${escapeHtml(khatma)} · الجزء ${event.juzNumber}</span><strong class="history-status-${event.status}">${label}</strong></li>`;
    }).join("") : '<li class="participant-history-empty">لا يوجد سجل قراءة سابق بعد.</li>';

    root.innerHTML = `${cycleMessage}<section class="participant-progress-card"><div class="participant-progress-heading"><div><span>الدورة الحالية</span><strong>الدورة الحالية: ${person.cycle}</strong></div><b>${progress.percentage}٪</b></div><div class="progress-track" role="progressbar" aria-label="تقدم الدورة الحالية" aria-valuenow="${progress.percentage}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${progress.percentage}%"></div></div><div class="participant-progress-count">${progress.completed} / 30 جزء · متبقٍ ${progress.remaining}</div><div class="participant-completed-juz"><strong>الأجزاء التي قرأتها في دورتك الحالية</strong><span>${formatJuz(person.completedJuz)}</span></div></section><section class="participant-today-section"><h3>أجزاء اليوم</h3>${noAssignments}<div class="participant-khatma-tabs" role="tablist" aria-label="اختيار الختمة اليومية">${participantKhatmaTabs}</div><div class="participant-khatma-grid">${khatmaCards}</div></section><section class="participant-personal-history"><div class="participant-history-heading"><h3>سجلي الشخصي</h3><a href="#history">عرض سجل الدورات الكامل</a></div><ul>${historyRows}</ul></section>`;
    root.querySelectorAll("[data-participant-khatma]").forEach((button) => button.addEventListener("click", () => {
      participantKhatmaId = button.dataset.participantKhatma;
      renderParticipantDashboard();
    }));
    root.querySelectorAll("[data-personal-complete]").forEach((button) => button.addEventListener("click", () => {
      const [khatmaId, juz] = button.dataset.personalComplete.split("|");
      activeKhatmaId = khatmaId;
      markComplete(Number(juz));
    }));
    root.querySelectorAll("[data-booking-form]").forEach((bookingForm) => {
      const button = bookingForm.querySelector(".booking-submit");
      bookingForm.querySelectorAll("[data-booking-juz]").forEach((checkbox) => checkbox.addEventListener("change", () => {
        button.disabled = !bookingForm.querySelector("[data-booking-juz]:checked");
      }));
      bookingForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const dailyKhatmaId = bookingForm.dataset.bookingForm;
        const selectedJuz = [...bookingForm.querySelectorAll("[data-booking-juz]:checked")].map((checkbox) => Number(checkbox.value));
        if (!selectedJuz.length) return showMessage("اختر جزءًا واحدًا على الأقل للحجز.", true);
        mutate(async () => {
          const result = await reserveDailyJuz(dailyKhatmaId, selectedJuz);
          const booked = result.booked || [], unavailable = result.unavailable || [];
          const bookedText = booked.length ? `تم حجز الأجزاء ${booked.map((item) => item.juz_number).join("، ")} لك.` : "لم يُحجز أي جزء.";
          const unavailableText = unavailable.length ? ` تعذر حجز: ${unavailable.map((item) => `الجزء ${item.juz_number} (${item.reason || "أصبح غير متاح"})`).join("، ")}.` : "";
          return bookedText + unavailableText;
        }, "تعذر إتمام الحجز الآن. حدّث الصفحة وحاول مرة أخرى.");
      });
    });
  }
  function getParticipantKhatmaName(khatmaId) {
    return data.khatmas.find((khatma) => khatma.id === khatmaId)?.name || "الختمة";
  }
  function renderTabs() {
    tabs.innerHTML = data.khatmas.map((khatma) => `<button class="khatma-tab ${khatma.id === activeKhatmaId ? "active" : ""}" role="tab" id="tab-${khatma.id}" aria-selected="${khatma.id === activeKhatmaId}" aria-controls="khatma-board" data-khatma="${khatma.id}">${escapeHtml(khatma.name)}</button>`).join("");
    tabs.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      activeKhatmaId = button.dataset.khatma; form.elements.khatmaId.value = activeKhatmaId; renderTabs(); renderBoard();
    }));
  }
  function renderDateSelector() {
    const select = $("#daily-date-select");
    const dates = [...new Set((data.dailyKhatmas || []).map((day) => day.date))].sort((a, b) => b.localeCompare(a));
    if (data.todayDate && !dates.includes(data.todayDate)) dates.unshift(data.todayDate);
    select.innerHTML = dates.map((date) => `<option value="${date}">${formatFullDate(date)}</option>`).join("");
    select.value = selectedReadingDate || data.todayDate;
    select.onchange = () => { selectedReadingDate = select.value; renderBoard(); };
    const archived = selectedReadingDate !== data.todayDate;
    $("#daily-archive-label").hidden = !archived;
    $("#daily-archive-label").textContent = archived ? "أرشيف يوم سابق" : "ختمة اليوم";
  }
  function renderBoard() {
    const khatma = data.khatmas.find((item) => item.id === activeKhatmaId);
    const khatmaDate = selectedReadingDate || data.todayDate;
    // The initial signed-out state has no authoritative date yet. Wait for
    // loadData() to obtain it from ensure_daily_khatmas in the Cairo timezone.
    if (!khatmaDate) {
      board.innerHTML = '<p class="empty-state" role="status">جارٍ تحميل ختمة اليوم من قاعدة البيانات…</p>';
      return;
    }
    const assignments = getTodayAssignments(khatma, khatmaDate);
    const dailyRecord = data.dailyKhatmas.find((day) => day.date === khatmaDate && day.number === (activeKhatmaId === "khatma-1" ? 1 : 2));
    const isArchived = khatmaDate !== data.todayDate || dailyRecord?.status === "closed";
    const completed = Object.values(assignments).filter((item) => item.status === "completed").length;
    const assigned = Object.values(assignments).filter((item) => item.status === "assigned").length;
    const percent = Math.round(completed / JUZ_COUNT * 100);
    const people = getActiveParticipants(data);
    const participantId = userContext?.profile.participant_id;
    const tiles = Array.from({ length: JUZ_COUNT }, (_, index) => {
      const juz = index + 1, saved = assignments[juz], record = saved?.status !== "cancelled" ? saved : null;
      const person = record && getParticipant(data, record.participantId);
      const status = record ? record.status : "available";
      const statusText = status === "completed" ? "تمت القراءة" : status === "assigned" ? "مخصص" : status === "expired" ? "انتهى اليوم ولم تتم القراءة" : status === "cancelled" ? "أُلغي الإسناد" : "متاح";
      const canComplete = !isArchived && (mode === "admin" || (mode === "participant" && participantId && record?.participantId === participantId));
      const action = status === "assigned" && canComplete ? `<button class="complete-button" data-complete="${juz}" aria-label="تسجيل إكمال الجزء ${juz}">تمت القراءة</button>` : "";
      const change = !isArchived && mode === "admin" && status === "assigned" ? `<div class="reassign-controls"><select aria-label="تغيير قارئ الجزء ${juz}" data-reassign-select="${juz}"><option value="">اختر قارئًا آخر</option>${people.filter((candidate) => candidate.id !== record.participantId).map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.name)}</option>`).join("")}</select><button type="button" class="reassign-button" data-reassign="${juz}">تغيير الإسناد</button></div>` : "";
      const assignmentDate = record ? `<time class="assignment-date" datetime="${escapeHtml(record.assignedAt)}">${formatFullDate(record.date)} · ${formatTime(record.assignedAt)}</time>` : "";
      return `<article class="juz-tile status-${status}"><div class="juz-tile-top"><span class="juz-number">الجزء ${juz}</span><span class="juz-status"><i aria-hidden="true"></i>${statusText}</span></div><div class="juz-reader"><span>اسم المشارك</span><strong>${person ? escapeHtml(person.name) : "—"}</strong></div>${assignmentDate}${action}${change}</article>`;
    }).join("");
    const expired = Object.values(assignments).filter((item) => item.status === "expired").length;
    const availableJuz = Array.from({ length: JUZ_COUNT }, (_, index) => index + 1)
      .filter((juz) => !["assigned", "completed"].includes(assignments[juz]?.status));
    const manualOptions = availableJuz.length
      ? `<form id="manual-assignment-form" class="manual-assignment-form"><strong>إسناد يدوي</strong><label>الجزء<select name="juz" required>${availableJuz.map((juz) => `<option value="${juz}">الجزء ${juz}</option>`).join("")}</select></label><label>المشارك<select name="participantId" required><option value="">اختر مشاركًا نشطًا</option>${people.map((candidate) => `<option value="${candidate.id}">${escapeHtml(candidate.name)}</option>`).join("")}</select></label><button type="submit" class="secondary-button">إسناد الجزء</button></form>`
      : '<p class="manual-assignment-empty">لا توجد أجزاء متاحة للإسناد في هذا اليوم.</p>';
    const controls = mode === "admin" && !isArchived ? `<div class="admin-board-actions"><div class="admin-board-assign-actions"><button type="button" class="secondary-button" id="generate-assignments">توزيع أجزاء الختمة المحددة</button><span>يستخدم محرك التوزيع الحالي ويحافظ على الطلبات والعدالة.</span></div>${manualOptions}<button type="button" class="reset-button" id="reset-assignments">إلغاء إسنادات اليوم غير المكتملة</button></div>` : "";
    board.innerHTML = `<div class="board-summary"><div><h3>${escapeHtml(khatma.name)}</h3><span class="board-date">ختمة يوم ${formatFullDate(khatmaDate)}${isArchived ? " · سجل مؤرشف" : ""}</span></div><div class="board-stats"><span><b>${completed}</b> تمت القراءة</span><span><b>${assigned}</b> مخصص</span><span><b>${Math.max(0, JUZ_COUNT - completed - assigned - expired)}</b> متاح</span></div></div><div class="progress-track board-progress" role="progressbar" aria-label="تقدم ${escapeHtml(khatma.name)}" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${percent}%"></div></div>${controls}<div class="juz-grid">${tiles}</div>`;
    board.querySelectorAll("[data-complete]").forEach((button) => button.addEventListener("click", () => markComplete(Number(button.dataset.complete))));
    board.querySelectorAll("[data-reassign]").forEach((button) => button.addEventListener("click", () => mutate(async () => {
      const juz = Number(button.dataset.reassign), select = board.querySelector(`[data-reassign-select="${juz}"]`);
      if (!select.value) throw new Error("اختر مشاركًا جديدًا أولًا.");
      const result = await reassignJuz(data, activeKhatmaId, juz, select.value);
      return `تم تغيير إسناد الجزء ${juz} إلى ${result.person?.name || "المشارك الجديد"}.`;
    })));
    const generate = $("#generate-assignments");
    if (generate) generate.addEventListener("click", () => {
      if (!people.length) return showMessage("أضف مشاركًا واحدًا على الأقل قبل توليد الإسنادات.", true);
      const existing = Object.values(assignments).filter((item) => ["assigned", "completed"].includes(item.status)).length;
      if (existing && !window.confirm("توجد إسنادات بالفعل في هذه الختمة. سيضيف المحرك الأجزاء المتاحة فقط دون تكرارها. هل تريد المتابعة؟")) return;
      mutate(async () => {
      const created = await generateAssignments(data, activeKhatmaId);
      return created.length ? `تم توليد ${created.length} إسنادًا للأجزاء المتاحة.` : "لا توجد أجزاء متاحة أو لا يوجد مشارك مؤهل لها.";
      });
    });
    const manualForm = $("#manual-assignment-form");
    if (manualForm) manualForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = new FormData(manualForm), juz = Number(values.get("juz")), participantId = values.get("participantId");
      const participant = getParticipant(data, participantId);
      if (isArchived) return showMessage("اليوم المؤرشف للقراءة فقط.", true);
      const available = getTodayAssignments(khatma, khatmaDate)[juz];
      if (available && ["assigned", "completed"].includes(available.status)) return showMessage("هذا الجزء ليس متاحًا للإسناد.", true);
      const check = Store.canAssignJuz(data, participantId, juz);
      if (!check.allowed) return showMessage(check.reason, true);
      mutate(async () => {
        await assignJuz(data, participantId, activeKhatmaId, juz);
        return `تم إسناد الجزء ${juz} إلى ${participant.name}.`;
      });
    });
    const reset = $("#reset-assignments");
    if (reset) reset.addEventListener("click", () => {
      if (window.confirm("سيتم إلغاء جميع الإسنادات غير المكتملة في الختمتين لهذا اليوم مع الاحتفاظ بسجلها. هل تريد المتابعة؟")) {
        mutate(async () => `تم إلغاء ${await resetTodayAssignments(data)} إسناد غير مكتمل، وبقي السجل محفوظًا.`);
      }
    });
  }
  async function markComplete(juz) {
    const record = getTodayAssignments(data.khatmas.find((item) => item.id === activeKhatmaId))[juz];
    if (!record) return showMessage("لا يوجد إسناد لهذا الجزء اليوم.", true);
    if (mode === "participant" && record.participantId !== userContext?.profile.participant_id) return showMessage("يمكنك إكمال الأجزاء المسندة إلى ملفك فقط.", true);
    await mutate(async () => {
      const result = await completeJuz(data, activeKhatmaId, juz);
      return result.cycleCompleted
        ? `ما شاء الله 🤍 أتممت قراءة القرآن في دورتك الحالية. بدأت دورة جديدة (${result.completedCycle + 1}).`
        : `تقبّل الله منك، تم إكمال الجزء ${juz}.`;
    });
  }
  function renderSelfService() {
    const people = mode === "admin" ? getActiveParticipants(data) : (userContext?.participant ? [userContext.participant] : []);
    $(".self-select-label").textContent = mode === "admin" ? "اختر مشاركًا لإدارة طلبه وتقدمه" : "ملفك الشخصي";
    const prior = selfSelect.value;
    selfSelect.innerHTML = people.length ? people.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join("") : '<option value="">أضف ملف مشارك من الإدارة</option>';
    if (people.some((person) => person.id === prior)) selfSelect.value = prior;
    else if (userContext?.participant) selfSelect.value = userContext.participant.id;
    const person = getParticipant(data, selfSelect.value), content = $("#self-participant-content"), badge = $("#self-cycle-badge");
    const requestForm = $("#assignment-request-form");
    if (!person) { requestForm.hidden = true; badge.textContent = ""; content.innerHTML = '<div class="empty-state">لا يوجد ملف مشارك نشط.</div>'; return; }
    requestForm.hidden = mode !== "admin";
    const requestKhatmaId = requestForm.elements.khatmaId.value || activeKhatmaId;
    requestForm.elements.count.value = getAssignmentRequest(data, person.id, requestKhatmaId);
    const progress = getProgress(person); badge.textContent = `الدورة ${person.cycle}`;
    const assignedRows = data.khatmas.flatMap((item) => Object.entries(getTodayAssignments(item, data.todayDate)).map(([juz, record]) => ({ khatma: item, juz: Number(juz), record }))).filter((item) => item.record.participantId === person.id && item.record.status === "assigned");
    const assignedHtml = assignedRows.length ? assignedRows.map((item) => `<article class="self-assignment"><div><span class="self-assignment-khatma">${escapeHtml(item.khatma.name)}</span><strong>الجزء ${item.juz}</strong><span class="juz-status assigned-badge">مُسند إليك</span></div><button type="button" class="complete-button" data-self-complete="${item.khatma.id}|${item.juz}">تمت القراءة</button></article>`).join("") : '<div class="empty-state">لا توجد أجزاء مسندة إليك اليوم.</div>';
    const events = data.history.filter((event) => event.participantId === person.id).slice(0, 6);
    const historyHtml = events.length ? events.map((event) => `<li><span>${formatDate(event.date)}</span><strong>${historyEventLabel(event)}</strong></li>`).join("") : '<li class="personal-history-empty">لا يوجد سجل قراءة بعد.</li>';
    content.innerHTML = `<div class="self-progress-card"><div class="self-progress-top"><div><span class="self-person-name">${escapeHtml(person.name)}</span><span class="self-progress-caption">نسبة إتمام دورتك</span></div><strong>${progress.percentage}٪</strong></div><div class="progress-track"><div class="progress-fill" style="width:${progress.percentage}%"></div></div><div class="self-progress-meta"><span>${progress.completed} من ٣٠ جزءًا</span><span>متبقٍ ${progress.remaining}</span></div><div class="participant-read"><b>الأجزاء التي قرأتها في هذه الدورة</b><span>${formatJuz(person.completedJuz)}</span></div></div><div class="self-assigned-section"><h3>أجزائي المسندة اليوم</h3><div class="self-assignment-list">${assignedHtml}</div></div><div class="self-history-preview"><div><h3>آخر سجل القراءة</h3><a href="#history">عرض السجل الكامل ←</a></div><ul>${historyHtml}</ul></div>`;
    content.querySelectorAll("[data-self-complete]").forEach((button) => button.addEventListener("click", () => {
      const [khatmaId, juz] = button.dataset.selfComplete.split("|"); activeKhatmaId = khatmaId; markComplete(Number(juz));
    }));
  }
  function renderParticipants() {
    const people = data.participants.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ar"));
    const count = $("#participants-count");
    count.textContent = `${getActiveParticipants(data).length} نشط · ${people.length} إجمالي`;
    if (!people.length) {
      participantsList.innerHTML = '<div class="empty-state">لم يُسجّل أحد بعد. أضف أول المشاركين لبدء الإسناد.</div><button type="button" id="import-local-data" class="secondary-button">استيراد بيانات النسخة المحلية</button>';
      const importButton = $("#import-local-data");
      if (!data.participants.length) importButton.addEventListener("click", () => {
        if (window.confirm("سيتم استيراد البيانات المحلية من هذا المتصفح إلى قاعدة البيانات المشتركة. ستبقى النسخة المحلية دون حذف. استخدم هذا الخيار مرة واحدة قبل إضافة مشاركين جدد. هل تريد المتابعة؟")) {
          mutate(async () => `تم استيراد ${await importLegacyData()} مشاركًا. أنشئ لكل مشارك رقمًا سريًا من بطاقته قبل تسليمه بيانات الدخول.`);
        }
      });
      else importButton.hidden = true;
      return;
    }
    participantsList.innerHTML = people.map((person) => {
      const progress = getProgress(person);
      const cycles = person.cycleHistory.map((cycle) => `<li><strong>الدورة ${cycle.number} — مكتملة</strong><span>${formatJuz(cycle.completedJuz)}</span><time>${formatDate(cycle.completedAt)}</time></li>`).join("");
      const current = `<li><strong>الدورة ${person.cycle} — جارية</strong><span>${formatJuz(person.completedJuz)}</span></li>`;
      const requestSummary = `طلب اليوم: ${getAssignmentRequest(data, person.id, "khatma-1")} للأولى · ${getAssignmentRequest(data, person.id, "khatma-2")} للثانية`;
      const stateLabel = person.active ? "نشط" : "موقوف";
      const adminAction = person.active
        ? `<button class="remove-participant" data-remove-participant="${person.id}">إيقاف</button><button type="button" class="secondary-button pin-regenerate" data-regenerate-pin="${person.id}">تجديد الرقم السري</button>`
        : `<button type="button" class="secondary-button" data-reactivate-participant="${person.id}">إعادة تفعيل وإنشاء PIN</button>`;
      return `<article class="participant ${person.active ? "" : "is-inactive"}"><div class="participant-heading"><span class="participant-label">اسم المشارك</span><span class="participant-name">${escapeHtml(person.name)}</span><span class="participant-active-badge ${person.active ? "" : "is-inactive"}">${stateLabel}</span></div>${adminAction}<span class="participant-progress">${progress.percentage}٪</span><div class="participant-details"><span><b>الدورة الحالية</b> ${person.cycle}</span><span><b>قرأ في الدورة</b> ${progress.completed} جزء</span><span><b>الأجزاء المتبقية</b> ${progress.remaining}</span></div><div class="participant-track"><span style="width:${progress.percentage}%"></span></div><div class="participant-read"><b>الأجزاء التي قرأها</b><span>${formatJuz(person.completedJuz)}</span></div><div class="participant-meta">الإجمالي ${person.totalCompleted} جزء · ${requestSummary}</div><button type="button" class="secondary-button participant-detail-button" data-participant-details="${person.id}">تفاصيل وسجل القراءة</button><details class="reading-history"><summary>الدورات المكتملة (${person.cycleHistory.length})</summary><ul>${cycles}${current}</ul></details></article>`;
    }).join("");
    participantsList.querySelectorAll("[data-remove-participant]").forEach((button) => button.addEventListener("click", () => {
      const person = getParticipant(data, button.dataset.removeParticipant);
      if (person && window.confirm(`سيتم إيقاف ${person.name} وإبطال PIN والجلسات الحالية مع الاحتفاظ بسجله. هل تريد المتابعة؟`)) mutate(async () => {
        await removeParticipant(data, person.id); return `تمت إزالة ${person.name} مع الاحتفاظ بسجله.`;
      });
    }));
    participantsList.querySelectorAll("[data-regenerate-pin]").forEach((button) => button.addEventListener("click", () => {
      const person = getParticipant(data, button.dataset.regeneratePin);
      if (person && window.confirm(`سيُلغى الرقم الحالي لـ${person.name} ويُنشأ رقم جديد. دوّن الرقم الجديد وأوصله للمشارك مباشرة. هل تريد المتابعة؟`)) {
        showGeneratedPin(async () => {
          const result = await regenerateParticipantPin(person.id);
          return { name: person.name, pin: result.pin };
        });
      }
    }));
    participantsList.querySelectorAll("[data-reactivate-participant]").forEach((button) => button.addEventListener("click", () => {
      const person = getParticipant(data, button.dataset.reactivateParticipant);
      if (person && window.confirm(`سيُعاد تفعيل ${person.name} ويُنشأ له PIN جديد؛ لن يعمل رقمه السابق. هل تريد المتابعة؟`)) {
        showGeneratedPin(async () => {
          const result = await reactivateParticipant(person.id);
          return { name: result.name, pin: result.pin };
        });
      }
    }));
    participantsList.querySelectorAll("[data-participant-details]").forEach((button) => button.addEventListener("click", () => {
      const person = getParticipant(data, button.dataset.participantDetails);
      if (person) showParticipantDetails(person);
    }));
  }
  function showParticipantDetails(person) {
    const progress = getProgress(person);
    const today = data.khatmas.flatMap((khatma) => Object.entries(getTodayAssignments(khatma, data.todayDate))
      .filter(([, assignment]) => assignment.participantId === person.id)
      .map(([juz, assignment]) => `<li>${escapeHtml(khatma.name)} · الجزء ${juz} · ${statusLabel(assignment.status)} · ${formatTime(assignment.assignedAt)}</li>`));
    const previous = data.history.filter((event) => event.participantId === person.id && event.date < data.todayDate && event.juzNumber && ["assigned", "completed", "expired"].includes(event.status))
      .slice(0, 30).map((event) => `<li>${formatFullDate(event.date)} · ${escapeHtml(getParticipantKhatmaName(event.khatmaId))} · الجزء ${event.juzNumber} · ${statusLabel(event.status)}</li>`);
    const cycles = person.cycleHistory.map((cycle) => `<li>الدورة ${cycle.number} مكتملة · ٣٠/٣٠ · ${formatDate(cycle.completedAt)}</li>`);
    const history = data.history.filter((event) => event.participantId === person.id).slice(0, 60).map((event) => {
      const detail = event.juzNumber ? `الجزء ${event.juzNumber} · ${escapeHtml(getParticipantKhatmaName(event.khatmaId))}` : `الدورة ${event.cycleNumber}`;
      return `<li>${formatFullDate(event.date)} · ${detail} · ${historyEventLabel(event)}</li>`;
    });
    $("#participant-details-name").textContent = person.name;
    $("#participant-details-body").innerHTML = `<section class="detail-progress"><strong>الدورة ${person.cycle}</strong><span>${progress.completed} / ٣٠ · ${progress.percentage}٪</span><div class="progress-track"><div class="progress-fill" style="width:${progress.percentage}%"></div></div><p>الأجزاء المكتملة في الدورة: ${formatJuz(person.completedJuz)}</p></section><div class="participant-detail-columns"><section><h3>إسنادات اليوم</h3><ul>${today.join("") || "<li>لا توجد إسنادات اليوم.</li>"}</ul></section><section><h3>الإسنادات السابقة</h3><ul>${previous.join("") || "<li>لا توجد إسنادات سابقة.</li>"}</ul></section><section><h3>الدورات المكتملة</h3><ul>${cycles.join("") || "<li>لا توجد دورة مكتملة بعد.</li>"}</ul></section><section><h3>سجل القراءة</h3><ul>${history.join("") || "<li>لا يوجد سجل بعد.</li>"}</ul></section></div>`;
    $("#participant-details-dialog").showModal();
  }
  function statusLabel(status) { return status === "completed" ? "تمت القراءة" : status === "expired" ? "انتهى اليوم ولم تتم القراءة" : status === "assigned" ? "مخصص" : "متاح"; }
  async function mutate(operation, failureMessage = null) {
    try { const message = await operation(); await refreshData(); showMessage(message || "تم الحفظ."); }
    catch (error) { showMessage(failureMessage || error.message || "تعذر حفظ التغييرات.", true); }
  }
  function showMessage(text, isError = false) {
    const target = $("#form-message"); if (target) { target.textContent = text; target.classList.toggle("error", isError); }
    const toast = $("#app-toast"); toast.textContent = text; toast.classList.toggle("is-error", isError); toast.hidden = !text;
    window.clearTimeout(toastTimer); if (text) toastTimer = window.setTimeout(() => { toast.hidden = true; }, 5000);
  }
  async function showGeneratedPin(generate) {
    try {
      const credential = await generate();
      $("#pin-reveal-name").textContent = credential.name;
      $("#pin-reveal-value").textContent = credential.pin;
      $("#pin-reveal-dialog").showModal();
      refreshData().catch((error) => showMessage(error.message || "تم إنشاء الرقم؛ تعذر تحديث القائمة.", true));
    } catch (error) { showMessage(error.message || "تعذر إنشاء الرقم السري.", true); }
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]); }
  function friendlyAuthError(error) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("invalid login credentials")) return "بيانات دخول الإدارة غير صحيحة.";
    return error?.message || "تعذر إتمام العملية. حاول مرة أخرى.";
  }
  function formatJuz(parts) { return parts.length ? parts.map((part) => `الجزء ${part}`).join("، ") : "لا يوجد"; }
  function formatDate(value) { return value ? new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo" }).format(parseTimestamp(value)) : ""; }
  function formatToday() { return formatFullDate(data.todayDate || Store.getTodayKey()); }
  function formatFullDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("تاريخ الختمة غير صالح في بيانات التطبيق.");
    const date = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("تاريخ الختمة غير صالح في بيانات التطبيق.");
    return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo" }).format(date);
  }
  function parseTimestamp(value) {
    if (typeof value !== "string" || !value.trim()) throw new Error("التوقيت غير صالح في بيانات التطبيق.");
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("التوقيت غير صالح في بيانات التطبيق.");
    return date;
  }
  function formatTime(value) { return new Intl.DateTimeFormat("ar-EG", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" }).format(parseTimestamp(value)); }
  function historyEventLabel(event) { return event.juzNumber ? `${event.status === "completed" ? "أتممت" : event.status === "assigned" ? "أُسند إليك" : event.status === "expired" ? "انتهى دون قراءة" : event.status === "cancelled" ? "أُلغي إسناد" : event.status === "assignment_changed" ? "تغيّر إسناد" : "تحديث"} الجزء ${event.juzNumber}` : event.status === "cycle_completed" ? `اكتملت الدورة ${event.cycleNumber}` : `بدأت الدورة ${event.cycleNumber}`; }

  async function updateAuth() {
    userContext = await Auth.getContext();
    if (userContext) {
      mode = userContext.profile.role === "admin" ? "admin" : "participant";
      data = await loadData();
      if (userContext.profile.role === "participant") {
        const participant = getParticipant(data, userContext.profile.participant_id);
        if (!participant || !participant.active) {
          userContext = null;
          throw new Error("تعذر تحميل بيانات دورة المشارك من قاعدة البيانات.");
        }
        // Auth returns the RLS-verified identity row; the dashboard needs the
        // canonical participant model assembled from cycles and completions.
        userContext.participant = participant;
      }
      if (!selectedReadingDate || selectedReadingDate === knownToday) selectedReadingDate = data.todayDate;
      knownToday = data.todayDate;
      authDialog.close();
      if (unsubscribe) unsubscribe();
      unsubscribe = subscribe(scheduleAuthoritativeRefresh, (status) => {
        if (status === "SUBSCRIBED") scheduleAuthoritativeRefresh();
        else if (userContext && status !== "CLOSED") setSyncStatus("انقطع الاتصال المباشر. نحاول إعادة الاتصال ومزامنة البيانات.");
      }, userContext);
    }
    render();
    window.dispatchEvent(new CustomEvent("khatma:modechange"));
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.mode === "admin" && userContext?.profile.role !== "admin") return showMessage("هذا الحساب لا يملك صلاحية الإدارة.", true);
    mode = button.dataset.mode; render(); window.dispatchEvent(new CustomEvent("khatma:modechange"));
  }));
  document.querySelectorAll(".auth-button").forEach((button) => button.addEventListener("click", async () => {
    if (!userContext) { setAuthMode("participant"); authDialog.showModal(); return; }
    try {
      const result = await Auth.signOut(); userContext = null; data = emptyData; mode = "participant"; setAuthMode("participant");
      if (unsubscribe) unsubscribe(); render(); authDialog.showModal();
      if (!result.identityRevoked) showMessage("تم تسجيل الخروج من هذا الجهاز، لكن تعذر إبطال ربط الجلسة من قاعدة البيانات. تحقق من الاتصال.", true);
    }
    catch (error) { showMessage(error.message, true); }
  }));
  let authMode = "participant";
  function setAuthMode(nextMode) {
    authMode = nextMode;
    $("#participant-login-fields").hidden = authMode !== "participant";
    $("#admin-login-fields").hidden = authMode !== "admin";
    [$("#auth-name"), $("#auth-pin")].forEach((input) => { input.disabled = authMode !== "participant"; input.required = authMode === "participant"; });
    [$("#auth-email"), $("#auth-password")].forEach((input) => { input.disabled = authMode !== "admin"; input.required = authMode === "admin"; });
    $("#auth-title").textContent = authMode === "participant" ? "اكتب بيانات الدخول" : "دخول الإدارة";
    $("#auth-description").textContent = authMode === "participant" ? "اكتب اسمك والرقم السري المكوّن من أربعة أرقام." : "تسجيل دخول الإدارة بحساب Supabase المصرح له فقط.";
    $("#auth-switch").textContent = authMode === "participant" ? "دخول الإدارة" : "دخول المشارك";
    $("#auth-error").textContent = "";
  }
  $("#auth-switch").addEventListener("click", () => setAuthMode(authMode === "participant" ? "admin" : "participant"));
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault(); $("#auth-error").textContent = "";
    try {
      if (authMode === "participant") await Auth.signInParticipant($("#auth-name").value, $("#auth-pin").value);
      else await Auth.signInAdmin($("#auth-email").value.trim(), $("#auth-password").value);
      await updateAuth();
      if (!userContext) throw new Error("تعذر تحميل ملف حسابك. حاول تسجيل الدخول مجددًا.");
    } catch (error) { $("#auth-error").textContent = friendlyAuthError(error); }
  });
  $("#auth-dialog").addEventListener("cancel", (event) => { if (!userContext) event.preventDefault(); });
  $("#profile-form").addEventListener("submit", (event) => {
    event.preventDefault(); const displayName = $("#profile-display-name").value.trim();
    if (!displayName) return showMessage("اكتب اسم العرض قبل الحفظ.", true);
    mutate(async () => { await Auth.updateProfile(displayName); await updateAuth(); return "تم حفظ اسم العرض."; });
  });

  $("#add-participant-form").addEventListener("submit", (event) => {
    event.preventDefault(); const payload = new FormData(event.currentTarget);
    const currentForm = event.currentTarget;
    showGeneratedPin(async () => {
      const participant = await addParticipant(data, payload.get("name")); currentForm.reset();
      return { name: participant.name, pin: participant.pin };
    });
  });
  $("#pin-reveal-close").addEventListener("click", () => {
    $("#pin-reveal-value").textContent = "";
    $("#pin-reveal-dialog").close();
  });
  $("#pin-reveal-dialog").addEventListener("close", () => { $("#pin-reveal-value").textContent = ""; });
  $("#participant-details-close").addEventListener("click", () => $("#participant-details-dialog").close());
  $("#auth-pin").addEventListener("input", (event) => {
    event.currentTarget.value = event.currentTarget.value.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/\D/g, "").slice(0, 4);
  });
  selfSelect.addEventListener("change", renderSelfService);
  $("#assignment-request-form").elements.khatmaId.addEventListener("change", renderSelfService);
  $("#assignment-request-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const person = mode === "admin" ? getParticipant(data, selfSelect.value) : userContext?.participant;
    if (!person) return showMessage("لا يوجد ملف مشارك نشط.", true);
    const values = new FormData(event.currentTarget);
    mutate(async () => {
      await setAssignmentRequest(data, person.id, values.get("khatmaId"), values.get("count"));
      return `تم حفظ طلب ${values.get("count")} جزءًا لـ${person.name}.`;
    });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    mutate(async () => {
      const fields = new FormData(form), juz = Number(fields.get("juz")), khatmaId = fields.get("khatmaId");
      const participant = mode === "admin"
        ? data.participants.find((person) => person.active && person.name.trim().toLocaleLowerCase("ar") === String(fields.get("name") || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ar"))
        : userContext?.participant;
      if (!participant) throw new Error(mode === "admin" ? "أضف المشارك أولًا من قائمة المشاركين." : "لا يوجد ملف مشارك نشط لهذا الحساب.");
      const eligibility = Store.canAssignJuz(data, participant.id, juz);
      if (!eligibility.allowed) throw new Error(eligibility.reason);
      await assignJuz(data, participant.id, khatmaId, juz);
      activeKhatmaId = khatmaId; return `تم إسناد الجزء ${juz} إلى ${participant.name}.`;
    });
  });

  window.addEventListener("khatma:datachange", () => { if (location.hash === "#history") window.dispatchEvent(new CustomEvent("khatma:historyrefresh")); });
  window.addEventListener("online", scheduleAuthoritativeRefresh);
  window.addEventListener("offline", () => setSyncStatus("لا يوجد اتصال بالشبكة. قد تكون البيانات المعروضة قديمة حتى تعود المزامنة."));
  window.addEventListener("focus", scheduleAuthoritativeRefresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleAuthoritativeRefresh();
  });
  $("#today").textContent = formatToday();
  render();
  try {
    if (!window.KhatmaSupabase?.configured) throw new Error("أكمل إعداد Supabase في js/supabase-config.js ثم شغّل migration قاعدة البيانات.");
    await updateAuth();
    if (!userContext) authDialog.showModal();
  } catch (error) { showMessage(error.message || "تعذر الاتصال بالخدمة.", true); authDialog.showModal(); }
  window.setInterval(() => {
    if (userContext && document.visibilityState === "visible") refreshData().catch(() => setSyncStatus("تعذر تحديث البيانات الآن. ستُعاد المزامنة تلقائيًا عند عودة الاتصال."));
  }, 30000);
})().catch((error) => {
  const toast = document.getElementById("app-toast");
  if (toast) { toast.textContent = error.message || "تعذر بدء التطبيق."; toast.hidden = false; toast.classList.add("is-error"); }
});
