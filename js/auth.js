(function (global) {
  "use strict";
  function client() {
    if (!global.KhatmaSupabase?.client) throw new Error("اتصال Supabase غير مكتمل. راجع إعدادات المشروع.");
    return global.KhatmaSupabase.client;
  }
  async function getContext() {
    const db = client();
    const { data: sessionResult, error: sessionError } = await db.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionResult.session?.user;
    if (!user) return null;
    const { data: profile, error } = await db.from("app_users")
      .select("user_id,role,participant_id,display_name,email").eq("user_id", user.id).single();
    if (error) {
      if (error.code === "PGRST116") {
        await db.auth.signOut();
        throw new Error("لم يُجهّز هذا الحساب في قائمة مستخدمي التطبيق. تواصل مع الإدارة.");
      }
      throw error;
    }
    if (profile.role !== "admin") {
      // PIN participants keep app_users.participant_id NULL; their identity lives in
      // auth_participant_sessions and is resolved only by the database function.
      const { data: participantId, error: identityError } = await db.rpc("my_participant_id");
      if (identityError) throw identityError;
      if (participantId) {
        profile.participant_id = participantId;
      } else if (profile.role === "participant") {
        await db.auth.signOut();
        return null;
      }
    }
    let participant = null;
    if (profile.participant_id) {
      const result = await db.from("participants").select("id,name,active").eq("id", profile.participant_id).single();
      if (result.error?.code === "PGRST116") {
        await db.auth.signOut();
        return null;
      }
      if (result.error) throw result.error;
      participant = result.data;
    }
    return { user, profile, participant };
  }
  global.KhatmaAuth = {
    getContext,
    async signInParticipant(name, pin) {
      const db = client();
      const normalizedName = String(name || "").trim().replace(/\s+/g, " ");
      const cleanPin = String(pin || "").trim().replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
      if (!normalizedName) throw new Error("اكتب اسمك.");
      if (!/^\d{4}$/.test(cleanPin)) throw new Error("الرقم السري يتكون من أربعة أرقام.");

      // Supabase anonymous Auth issues a persistent JWT; the database RPC upgrades
      // that session to exactly one participant identity after checking the PIN.
      const { data: sessionData, error: sessionError } = await db.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        const { error } = await db.auth.signInAnonymously();
        if (error) throw new Error("تعذر بدء جلسة الدخول. تحقق من تفعيل الدخول المجهول في Supabase.");
      }
      const { data, error } = await db.rpc("participant_pin_login", { p_name: normalizedName, p_pin: cleanPin });
      if (error || !data?.success) {
        await db.auth.signOut();
        if (error?.message?.includes("تم تجاوز عدد المحاولات")) throw new Error("تم تجاوز عدد المحاولات. حاول بعد ١٥ دقيقة.");
        throw new Error("الاسم أو الرقم السري غير صحيح.");
      }
      return data;
    },
    async signInAdmin(email, password) {
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error) throw error;
      const context = await getContext();
      if (context?.profile.role !== "admin") {
        await client().auth.signOut();
        throw new Error("هذا الحساب ليس حساب إدارة.");
      }
      return data;
    },
    async signOut() {
      const db = client();
      const { error: identityError } = await db.rpc("participant_logout");
      const { error: signOutError } = await db.auth.signOut();
      if (signOutError) throw signOutError;
      return { identityRevoked: !identityError };
    }
  };
})(window);
