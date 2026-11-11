/* Head to Head online: accounts, one company per account, invites by email, crew folders, and jobs
   saved online so they show up on every phone signed into the company (Zach 2026-11-10).
   Jobs still live on the phone first, so the app works with no signal; this file copies them up and
   pulls everyone else's changes down. With no config (js/config.js empty) it stays off. */
(function () {
  "use strict";

  const cfg = window.H2H_CLOUD || {};
  const enabled = !!(cfg.url && cfg.anonKey && window.supabase);
  const SYNC_KEY = "headtohead.sync.v1"; // {companyId, lastPull, dirty:[ids], gone:[ids]}

  let sb = null;
  let session = null;
  let company = null; // {id, name, role, settings}
  let companies = [];
  let listeners = [];
  let pushTimer = null;
  let pulling = false;

  const state = (() => {
    try {
      return JSON.parse(localStorage.getItem(SYNC_KEY)) || {};
    } catch (e) {
      console.warn("Sync state unreadable, starting fresh", e);
      return {};
    }
  })();
  state.dirty = state.dirty || [];
  state.gone = state.gone || [];
  function saveState() {
    try {
      localStorage.setItem(SYNC_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Sync state not saved", e);
    }
  }
  const emit = (what) => listeners.forEach((fn) => fn(what));

  async function start() {
    if (!enabled) return null;
    // Sessions persist on the phone and refresh themselves, so you stay signed in until you sign out.
    // PKCE keeps the Google sign-in return in the query string, away from the app's #/ routes.
    sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
    const { data } = await sb.auth.getSession();
    session = data.session;
    sb.auth.onAuthStateChange((event, s) => {
      session = s;
      if (event === "SIGNED_OUT") {
        company = null;
        emit("signedOut");
      }
    });
    // tidy the ?code= the Google return leaves behind
    if (/[?&]code=/.test(location.search))
      history.replaceState(null, "", location.pathname + location.hash);
    if (session) await loadCompany();
    return session;
  }

  /* ---------- signing in ---------- */

  async function sendCode(email) {
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    });
    if (error) throw error;
  }
  async function verifyCode(email, code) {
    const { data, error } = await sb.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    });
    if (error) throw error;
    session = data.session;
    await loadCompany();
    return session;
  }
  async function signInWith(provider) {
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  }
  async function signOut() {
    await pushNow();
    await sb.auth.signOut();
    session = null;
    company = null;
    state.companyId = null;
    state.lastPull = null;
    state.dirty = [];
    state.gone = [];
    saveState();
  }

  /* ---------- company ---------- */

  // Invites wait for a yes: the person sees each one and taps Join (security review 2026-11-10).
  async function myInvites() {
    const { data, error } = await sb.rpc("my_invites");
    if (error) throw error;
    return data || [];
  }
  async function acceptInvite(id) {
    const { data, error } = await sb.rpc("accept_invite", { invite_id: id });
    if (error) throw error;
    await loadCompany();
    if (data) await switchCompany(data);
  }
  async function declineInvite(id) {
    const { error } = await sb.rpc("decline_invite", { invite_id: id });
    if (error) throw error;
  }
  async function leaveCompany() {
    const { error } = await sb
      .from("members")
      .delete()
      .eq("company_id", company.id)
      .eq("user_id", session.user.id);
    if (error) throw error;
    state.companyId = null;
    state.lastPull = null;
    saveState();
    await loadCompany();
  }
  // Jobs on the phone belong to the company it last synced with; switching starts a fresh pull.
  async function switchCompany(id) {
    await pushNow();
    state.companyId = id;
    state.lastPull = null;
    state.dirty = [];
    state.gone = [];
    saveState();
    company = companies.find((c) => c.id === id) || company;
  }

  async function loadCompany() {
    const { data, error } = await sb
      .from("members")
      .select("role, company:companies(id, name, settings)")
      .eq("user_id", session.user.id);
    if (error) throw error;
    companies = (data || [])
      .filter((m) => m.company)
      .map((m) => Object.assign({ role: m.role }, m.company));
    company =
      companies.find((c) => c.id === state.companyId) || companies[0] || null;
    if (company && state.companyId !== company.id) {
      // a different company than this phone last synced with: pull everything fresh
      state.companyId = company.id;
      state.lastPull = null;
      saveState();
    }
    return company;
  }
  async function createCompany(name) {
    const { data, error } = await sb.rpc("create_company", {
      company_name: name.trim(),
    });
    if (error) throw error;
    state.companyId = data;
    state.lastPull = null;
    saveState();
    await loadCompany();
    return company;
  }
  async function members() {
    const { data, error } = await sb
      .from("members")
      .select("user_id, email, role, created_at")
      .eq("company_id", company.id)
      .order("created_at");
    if (error) throw error;
    return data;
  }
  async function invites() {
    const { data, error } = await sb
      .from("invites")
      .select("id, email, created_at, accepted_at")
      .eq("company_id", company.id)
      .is("accepted_at", null)
      .order("created_at");
    if (error) throw error;
    return data;
  }
  async function invite(email) {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      throw new Error("That doesn't look like an email address.");
    const { error } = await sb.from("invites").insert({
      company_id: company.id,
      email: e,
      invited_by: session.user.id,
    });
    if (error && error.code === "23505")
      throw new Error("That email is already invited.");
    if (error) throw error;
  }
  async function cancelInvite(id) {
    const { error } = await sb.from("invites").delete().eq("id", id);
    if (error) throw error;
  }
  async function removeMember(userId) {
    const { error } = await sb
      .from("members")
      .delete()
      .eq("company_id", company.id)
      .eq("user_id", userId);
    if (error) throw error;
  }
  async function saveSettings(settings) {
    const { error } = await sb.rpc("save_company_settings", {
      cid: company.id,
      new_settings: settings,
    });
    if (error) throw error;
    company.settings = settings;
  }

  /* ---------- folders ---------- */

  async function folders() {
    const { data, error } = await sb
      .from("folders")
      .select("id, name")
      .eq("company_id", company.id)
      .order("name");
    if (error) throw error;
    return data;
  }
  async function addFolder(name) {
    const { data, error } = await sb
      .from("folders")
      .insert({ company_id: company.id, name: name.trim() })
      .select("id, name")
      .single();
    if (error) throw error;
    return data;
  }
  async function renameFolder(id, name) {
    const { error } = await sb
      .from("folders")
      .update({ name: name.trim() })
      .eq("id", id);
    if (error) throw error;
  }
  async function deleteFolder(id) {
    // jobs in it fall back to no folder (on delete set null), they're never lost
    const { error } = await sb.from("folders").delete().eq("id", id);
    if (error) throw error;
  }

  /* ---------- jobs ---------- */

  // A job changed on this phone: remember it and send it up shortly after the last change.
  function queueJob(id) {
    if (!enabled || !session || !company) return;
    if (!state.dirty.includes(id)) state.dirty.push(id);
    saveState();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 1500);
  }
  function queueDelete(id) {
    if (!enabled || !session || !company) return;
    if (!state.gone.includes(id)) state.gone.push(id);
    state.dirty = state.dirty.filter((x) => x !== id);
    saveState();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 500);
  }

  let getLocalJobs = () => [];
  async function pushNow() {
    if (!enabled || !session || !company) return;
    const local = getLocalJobs();
    const rows = state.dirty
      .map((id) => local.find((j) => j.id === id))
      .filter(Boolean)
      .map((j) => ({
        id: j.id,
        company_id: company.id,
        folder_id: j.folderId || null,
        data: j,
        deleted: false,
      }));
    const gone = state.gone.map((id) => ({
      id,
      company_id: company.id,
      data: {},
      deleted: true,
    }));
    const all = rows.concat(gone);
    if (!all.length) return;
    const { error } = await sb.from("jobs").upsert(all, { onConflict: "company_id,id" });
    if (error) {
      // no signal or a hiccup: keep them queued and try again on the next change or pull
      console.warn("Jobs not sent yet", error);
      emit("offline");
      return;
    }
    const sent = new Set(all.map((r) => r.id));
    state.dirty = state.dirty.filter((id) => !sent.has(id));
    state.gone = state.gone.filter((id) => !sent.has(id));
    saveState();
    emit("pushed");
  }

  // Everything other phones changed since the last pull. Returns {changed:[job], removed:[id]}.
  async function pull() {
    if (!enabled || !session || !company || pulling)
      return { changed: [], removed: [] };
    pulling = true;
    try {
      await pushNow();
      let q = sb
        .from("jobs")
        .select("id, folder_id, data, deleted, updated_at")
        .eq("company_id", company.id)
        .order("updated_at")
        .limit(1000);
      // gte, not gt: two saves in the same instant would otherwise lose the second; a repeat is harmless
      if (state.lastPull) q = q.gte("updated_at", state.lastPull);
      const { data, error } = await q;
      if (error) {
        console.warn("Couldn't pull jobs", error);
        emit("offline");
        return { changed: [], removed: [] };
      }
      const changed = [],
        removed = [];
      (data || []).forEach((r) => {
        // a job edited here and not sent yet wins over an older copy from the server
        if (state.dirty.includes(r.id)) return;
        if (r.deleted) removed.push(r.id);
        else
          // the row's own id, not whatever id the stored data claims
          changed.push(
            Object.assign({}, r.data, {
              id: r.id,
              folderId: r.folder_id || null,
            }),
          );
      });
      if (data && data.length) {
        state.lastPull = data[data.length - 1].updated_at;
        saveState();
      }
      return { changed, removed };
    } finally {
      pulling = false;
    }
  }

  window.H2HCloud = {
    enabled,
    start,
    on: (fn) => listeners.push(fn),
    setLocalJobs: (fn) => (getLocalJobs = fn),
    get session() {
      return session;
    },
    get email() {
      return session && session.user ? session.user.email : null;
    },
    get company() {
      return company;
    },
    sendCode,
    verifyCode,
    signInWith,
    signOut,
    createCompany,
    myInvites,
    acceptInvite,
    declineInvite,
    leaveCompany,
    switchCompany,
    get companies() {
      return companies;
    },
    members,
    invites,
    invite,
    cancelInvite,
    removeMember,
    saveSettings,
    folders,
    addFolder,
    renameFolder,
    deleteFolder,
    queueJob,
    queueDelete,
    pushNow,
    pull,
    get pending() {
      return state.dirty.length + state.gone.length;
    },
    get hasSynced() {
      return !!state.lastPull;
    },
  };
})();
