(function (global) {
  "use strict";
  // These two public project values are safe in browser code when every table uses RLS.
  const SUPABASE_URL = "https://menhdahlagsncoehipkb.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mhC_J7JF1uVJ6ht1gKfLpQ_giD3iBRR";
  const configured = !SUPABASE_URL.includes("YOUR_PROJECT_ID") && !SUPABASE_PUBLISHABLE_KEY.includes("YOUR_");
  global.KhatmaSupabase = {
    configured,
    client: configured && global.supabase ? global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null
  };
})(window);
