const plannerConfig = {
  home: {
    title: "Make a space your own",
    subtitle: "A considered starting point for the rooms you live in.",
    tag: "HOME INTERIORS",
    fields: [
      { name: "room", label: "Room to plan", type: "select", options: ["Living room", "Bedroom", "Kitchen", "Dining room", "Study", "Whole home"] },
      { name: "style", label: "Style direction", type: "select", options: ["Warm minimal", "Modern Indian", "Natural & organic", "Colorful eclectic", "Classic", "Help me decide"] },
      { name: "items", label: "What do you need?", type: "text", placeholder: "e.g. lighting, seating, dining table", full: true },
      { name: "notes", label: "Anything else to keep in mind?", type: "textarea", placeholder: "Room size, colors, pieces you already own...", full: true },
    ],
  },
  party: {
    title: "Bring the gathering together",
    subtitle: "A little structure for a day worth remembering.",
    tag: "PARTY PLANNER",
    fields: [
      { name: "event", label: "What's the occasion?", type: "select", options: ["Birthday", "Wedding", "Family gathering", "Corporate event", "Dinner party", "Other celebration"] },
      { name: "guests", label: "Number of guests", type: "number", min: 1, max: 10000, placeholder: "e.g. 30" },
      { name: "city", label: "City or neighborhood", type: "text", placeholder: "e.g. Chennai" },
      { name: "priorities", label: "What matters most?", type: "select", options: ["Great food", "A lovely venue", "Atmosphere & decor", "A bit of everything"] },
      { name: "notes", label: "Date or other details", type: "text", placeholder: "Optional", full: true },
    ],
  },
  jewelry: {
    title: "Find the right finishing touch",
    subtitle: "Thoughtful jewelry ideas, shaped around the occasion and your look.",
    tag: "JEWELRY EDIT",
    fields: [
      { name: "occasion", label: "What's the occasion?", type: "select", options: ["Everyday", "Wedding", "Festive celebration", "Work event", "Date night", "Gift"] },
      { name: "style", label: "Style direction", type: "select", options: ["Minimal", "Traditional", "Contemporary", "Statement", "Not sure yet"] },
      { name: "metal", label: "Metal preference", type: "select", options: ["Gold tone", "Silver tone", "Rose gold", "No preference"] },
      { name: "notes", label: "Outfit or other details", type: "text", placeholder: "Colors, neckline, pieces you love..." },
      { name: "outfit", label: "Match to an outfit photo", type: "file", full: true },
    ],
  },
};

const state = {
  planner: "home",
  token: localStorage.getItem("pocketsmart-token"),
  user: JSON.parse(localStorage.getItem("pocketsmart-user") || "null"),
  history: JSON.parse(localStorage.getItem("pocketsmart-history") || "[]"),
  imageData: null,
  authMode: "login",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = (amount) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(amount) || 0);
const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function renderField(field) {
  const full = field.full ? " full" : "";
  if (field.type === "select") {
    return `<label class="field${full}">${escapeHTML(field.label)}<select name="${field.name}" required>${field.options.map((option) => `<option>${escapeHTML(option)}</option>`).join("")}</select></label>`;
  }
  if (field.type === "file") {
    return `<label class="field${full}">${escapeHTML(field.label)}<span class="upload-control"><input name="outfit" id="outfit-file" type="file" accept="image/*"><span class="upload-icon">+</span><span class="upload-copy"><strong id="upload-title">Choose an outfit photo</strong><small id="upload-hint">Optional · JPG, PNG or WEBP · up to 5 MB</small></span><img class="upload-preview" id="upload-preview" alt="Outfit preview" hidden></span></label>`;
  }
  if (field.type === "textarea") {
    return `<label class="field${full}">${escapeHTML(field.label)}<textarea name="${field.name}" placeholder="${escapeHTML(field.placeholder)}"></textarea></label>`;
  }
  return `<label class="field${full}">${escapeHTML(field.label)}${field.name === "budget" ? `<span class="input-prefix"><b>Rs</b><input name="budget" type="number" min="300" max="100000000" step="100" placeholder="e.g. 25000" required></span>` : `<input name="${field.name}" type="${field.type}" ${field.min ? `min="${field.min}"` : ""} ${field.max ? `max="${field.max}"` : ""} placeholder="${escapeHTML(field.placeholder || "")}" ${field.type === "number" ? "required" : ""}>`}</label>`;
}

function selectPlanner(planner) {
  state.planner = plannerConfig[planner] ? planner : "home";
  state.imageData = null;
  $$("[data-planner]").forEach((button) => {
    const selected = button.dataset.planner === state.planner;
    button.classList.toggle("selected", selected);
    if (button.matches("[role='tab']")) button.setAttribute("aria-selected", String(selected));
  });
  renderPlannerForm();
}

function renderPlannerForm() {
  const planner = plannerConfig[state.planner];
  const panel = $("#form-panel");
  const fields = [{ name: "budget", label: "Your total budget (INR)", type: "number", full: true }, ...planner.fields];
  panel.innerHTML = `<div class="form-heading"><div><p class="eyebrow">A FEW DETAILS</p><h2>${escapeHTML(planner.title)}</h2><p>${escapeHTML(planner.subtitle)}</p></div><span class="planner-tag">${planner.tag}</span></div><form class="plan-form" id="plan-form">${fields.map(renderField).join("")}<div class="form-actions"><span class="budget-note">We'll keep every suggestion within your total.</span><button class="button button-dark" type="submit">Find my options <span aria-hidden="true">&#8594;</span></button></div></form>`;
  $("#results-panel").hidden = true;
  $("#plan-form").addEventListener("submit", submitPlan);
  $("#outfit-file")?.addEventListener("change", handleOutfitUpload);
}

async function handleOutfitUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) return showFormError("Choose an image file to match your outfit.");
  if (file.size > 5 * 1024 * 1024) return showFormError("Please choose an image under 5 MB.");
  const image = new Image();
  const reader = new FileReader();
  reader.onload = () => {
    image.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      state.imageData = canvas.toDataURL("image/jpeg", 0.76);
      $("#upload-preview").src = state.imageData;
      $("#upload-preview").hidden = false;
      $("#upload-title").textContent = file.name;
      $("#upload-hint").textContent = "Ready to use for color matching";
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function showFormError(message) {
  const form = $("#plan-form");
  let error = $(".form-error", form);
  if (!error) {
    error = document.createElement("p");
    error.className = "form-error";
    error.setAttribute("role", "alert");
    error.style.cssText = "grid-column:1/-1;margin:0;color:#a84936;font-size:10px";
    form.insertBefore(error, $(".form-actions", form));
  }
  error.textContent = message;
}

async function submitPlan(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const budget = Number(values.budget);
  if (!Number.isFinite(budget) || budget < 300) return showFormError("Enter a budget of at least Rs 300.");
  delete values.budget;
  delete values.outfit;
  const submit = $("button[type='submit']", form);
  submit.textContent = "Finding thoughtful options...";
  form.classList.add("loading");
  try {
    const headers = { "Content-Type": "application/json" };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(`/generate-${state.planner}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ budget, details: values, image_data: state.imageData }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "We couldn't make that plan just yet.");
    rememberResult(result);
    renderResults(result);
  } catch (error) {
    showFormError(error.message || "The planner could not connect. Please try again.");
  } finally {
    submit.innerHTML = 'Find my options <span aria-hidden="true">&#8594;</span>';
    form.classList.remove("loading");
  }
}

function renderResults(result) {
  const panel = $("#results-panel");
  const items = Array.isArray(result.items) ? result.items : [];
  panel.innerHTML = `<div class="results-heading"><div><p class="eyebrow">YOUR ${escapeHTML(result.planner.toUpperCase())} EDIT</p><h2>A few good places to start.</h2><p>Three options, with room left in the budget.</p></div><div class="results-total"><strong>${money(result.total)}</strong><small>of ${money(result.budget)}</small></div></div><div class="result-cards">${items.map((item) => `<article class="result-card"><img src="${escapeHTML(item.image)}" alt="${escapeHTML(item.category)} idea" loading="lazy"><div class="result-card-body"><span class="result-category">${escapeHTML(item.category)}</span><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.description)}</p><div class="result-card-foot"><strong>${money(item.price)}</strong><a href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">Explore ${escapeHTML(item.vendor)} &#8599;</a></div></div></article>`).join("")}</div><p class="source-note"><span class="source-badge">${result.source === "gemini" ? "Gemini AI" : "Sample ideas"}</span>${result.source === "gemini" ? "AI suggestions are a starting point. Check current price and availability with the seller." : "Sample marketplace suggestions. Add a Gemini API key to personalize recommendations."}</p>`;
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function rememberResult(result) {
  state.history = [result, ...state.history.filter((item) => item.id !== result.id)].slice(0, 20);
  localStorage.setItem("pocketsmart-history", JSON.stringify(state.history));
  renderHistory();
  renderOverview();
}

function renderOverview() {
  $("#plan-total").textContent = state.history.length;
  $("#history-count").textContent = state.history.length;
  const recent = $("#recent-list");
  if (!state.history.length) {
    recent.innerHTML = '<div class="empty-inline"><span class="empty-dash"></span><span>Your first plan will show up here.</span></div>';
    return;
  }
  recent.innerHTML = state.history.slice(0, 2).map((item) => `<div class="recent-item" data-open-result="${escapeHTML(item.id)}"><span class="recent-symbol">${plannerLetter(item.planner)}</span><span class="recent-detail"><strong>${plannerName(item.planner)} plan</strong><small>${new Date(item.created_at * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</small></span><span class="recent-price">${money(item.total)}</span></div>`).join("");
  $$('[data-open-result]', recent).forEach((row) => row.addEventListener("click", () => openHistoryResult(row.dataset.openResult)));
}

function renderHistory() {
  const grid = $("#history-grid");
  $("#history-total").textContent = `${state.history.length} ${state.history.length === 1 ? "plan" : "plans"}`;
  $("#history-count").textContent = state.history.length;
  if (!state.history.length) {
    grid.innerHTML = '<div class="history-empty"><strong>There is room for a first idea.</strong><span>Your saved plans will gather here.</span><button class="text-button" data-page="planner">Start planning &#8594;</button></div>';
    $$("[data-page='planner']", grid).forEach((button) => button.addEventListener("click", () => navigate("planner")));
    return;
  }
  grid.innerHTML = state.history.map((item) => {
    const detail = item.items?.[0]?.title || "A few options to explore";
    const date = item.created_at ? new Date(item.created_at * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Saved plan";
    return `<article class="history-card"><span class="history-stamp">${plannerLetter(item.planner)}</span><div class="history-card-main"><h3>${plannerName(item.planner)} plan</h3><p>${escapeHTML(detail)} · ${date}</p></div><div class="history-price"><strong>${money(item.total)}</strong><small>of ${money(item.budget)}</small></div></article>`;
  }).join("");
}

function openHistoryResult(id) {
  const result = state.history.find((item) => item.id === id);
  if (!result) return;
  navigate("planner");
  selectPlanner(result.planner);
  renderResults(result);
}

function plannerLetter(planner) { return ({ home: "H", party: "P", jewelry: "J" })[planner] || "P"; }
function plannerName(planner) { return ({ home: "Home", party: "Party", jewelry: "Jewelry" })[planner] || "PocketSmart"; }

function navigate(page) {
  const target = $(`#${page}-page`);
  if (!target) return;
  $$(".page-view").forEach((view) => view.classList.toggle("active", view === target));
  $$(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  $("#crumb-current").textContent = ({ overview: "Overview", planner: "Smart planner", history: "Saved plans" })[page];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateAccount() {
  const user = state.user;
  $("#account-name").textContent = user?.name || "Guest planner";
  $("#account-status").textContent = user ? "Your plans are synced" : "Your plans stay here";
  $("#avatar-initials").textContent = user?.name?.trim()?.[0]?.toUpperCase() || "G";
}

function openAuth(mode = "login") {
  state.authMode = mode;
  const register = mode === "register";
  $("#auth-title").textContent = register ? "Start with your name." : "Welcome back.";
  $("#auth-copy").textContent = register ? "Create an account to keep your plans together." : "Sign in to keep your plans together.";
  $("#name-field").hidden = !register;
  $("#name-field input").required = register;
  $("#auth-submit").innerHTML = `${register ? "Create account" : "Sign in"} <span aria-hidden="true">&#8594;</span>`;
  $("#auth-switch").textContent = register ? "Already have an account? Sign in" : "New to PocketSmart? Create an account";
  $("#auth-error").textContent = "";
  $("#auth-dialog").showModal();
}

async function refreshSession() {
  if (!state.token) return updateAccount();
  try {
    const response = await fetch("/session-info", { headers: { Authorization: `Bearer ${state.token}` } });
    const data = await response.json();
    if (!data.authenticated) throw new Error("No active session");
    state.user = data.user;
    localStorage.setItem("pocketsmart-user", JSON.stringify(state.user));
    const historyResponse = await fetch("/history", { headers: { Authorization: `Bearer ${state.token}` } });
    const history = await historyResponse.json();
    if (history.history?.length) {
      state.history = [...history.history, ...state.history.filter((item) => !history.history.some((saved) => saved.id === item.id))].slice(0, 20);
      localStorage.setItem("pocketsmart-history", JSON.stringify(state.history));
    }
  } catch {
    state.token = null;
    state.user = null;
    localStorage.removeItem("pocketsmart-token");
    localStorage.removeItem("pocketsmart-user");
  }
  updateAccount();
  renderOverview();
  renderHistory();
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  const endpoint = state.authMode === "register" ? "/register" : "/login";
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "We couldn't complete that request.");
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("pocketsmart-token", state.token);
    localStorage.setItem("pocketsmart-user", JSON.stringify(state.user));
    $("#auth-dialog").close();
    updateAccount();
    refreshSession();
  } catch (error) {
    $("#auth-error").textContent = error.message;
  }
}

function init() {
  $("#today-label").textContent = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }).format(new Date());
  $$("[data-page]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.page)));
  $$("[data-planner]").forEach((button) => button.addEventListener("click", () => {
    navigate("planner");
    selectPlanner(button.dataset.planner);
  }));
  $("#top-new-plan").addEventListener("click", () => navigate("planner"));
  $("#hero-new-plan").addEventListener("click", () => navigate("planner"));
  $("#history-new-plan").addEventListener("click", () => navigate("planner"));
  $("#account-button").addEventListener("click", () => state.user ? signOut() : openAuth());
  $("#auth-form").addEventListener("submit", handleAuthSubmit);
  $("#auth-switch").addEventListener("click", () => openAuth(state.authMode === "register" ? "login" : "register"));
  $("#auth-dialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  selectPlanner("home");
  updateAccount();
  renderOverview();
  renderHistory();
  refreshSession();
}

async function signOut() {
  if (state.token) await fetch("/logout", { method: "POST", headers: { Authorization: `Bearer ${state.token}` } }).catch(() => {});
  state.token = null;
  state.user = null;
  localStorage.removeItem("pocketsmart-token");
  localStorage.removeItem("pocketsmart-user");
  updateAccount();
}

document.addEventListener("DOMContentLoaded", init);