const CATS = ["전체", "한식", "양식", "중식", "기타"];
let recipes = [];
let activeCat = "전체";
let currentId = null;
let editingId = null;
let currentImageKey = null;
let pendingImageFile = null;
let isAdmin = false;
const adminMode = new URLSearchParams(location.search).get("admin") === "1";
const $ = (s) => document.querySelector(s);

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $("#" + id).classList.add("active");
  window.scrollTo(0, 0);
}

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { "content-type": "application/json", ...(options.headers || {}) },
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || "요청을 처리하지 못했습니다.");
  return data;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add("hidden"), 2200);
}

async function loadAuth() {
  try {
    const data = await api("/api/auth/status");
    isAdmin = !!data.admin;
  } catch { isAdmin = false; }
  updateAdminUi();
}

function updateAdminUi() {
  $("#addBtn").classList.toggle("hidden", !isAdmin);
  $("#editBtn").classList.toggle("hidden", !isAdmin);
  $("#editSpacer").classList.toggle("hidden", isAdmin);
  $("#logoutBtn").classList.toggle("hidden", !isAdmin || !adminMode);
  $("#loginBtn").classList.toggle("hidden", isAdmin || !adminMode);
}

function renderTabs() {
  $("#tabs").innerHTML = CATS.map((c) => `<button class="tab ${activeCat === c ? "active" : ""}" data-cat="${c}">${c}</button>`).join("");
  document.querySelectorAll(".tab").forEach((b) => b.onclick = () => {
    activeCat = b.dataset.cat;
    renderTabs();
    renderList();
  });
}

function renderList() {
  const list = activeCat === "전체" ? recipes : recipes.filter((r) => r.category === activeCat);
  $("#loading").classList.add("hidden");
  $("#empty").classList.toggle("hidden", list.length > 0);
  $("#recipeList").innerHTML = list.map((r) => `
    <article class="card" data-id="${esc(r.id)}">
      <div class="thumb">${r.imageUrl ? `<img src="${esc(r.imageUrl)}" alt="">` : "사진 없음"}</div>
      <div class="meta"><div class="cat">${esc(r.category)}</div><h3>${esc(r.title)}</h3></div>
      <button class="chev" aria-label="열기">›</button>
    </article>`).join("");
  document.querySelectorAll(".card").forEach((c) => c.onclick = () => openDetail(c.dataset.id));
}

async function loadRecipes() {
  $("#loading").classList.remove("hidden");
  try {
    const data = await api("/api/recipes");
    recipes = data.recipes || [];
    renderList();
  } catch (e) {
    $("#loading").textContent = e.message;
  }
}

function openDetail(id) {
  const r = recipes.find((x) => x.id === id);
  if (!r) return;
  currentId = id;
  $("#detailHero").innerHTML = r.imageUrl ? `<img src="${esc(r.imageUrl)}" alt="">` : "썸네일 없음";
  $("#detailCat").textContent = r.category;
  $("#detailTitle").textContent = r.title;
  $("#detailIngredients").textContent = r.ingredients || "기록 없음";
  $("#detailSteps").textContent = r.steps || "기록 없음";
  updateAdminUi();
  show("detail");
}

function clearForm() {
  editingId = null;
  currentImageKey = null;
  pendingImageFile = null;
  $("#editHeading").textContent = "새 레시피";
  $("#deleteBtn").classList.add("hidden");
  $("#categoryInput").value = "한식";
  $("#titleInput").value = "";
  $("#ingredientsInput").value = "";
  $("#stepsInput").value = "";
  $("#imageInput").value = "";
  $("#preview").textContent = "사진을 올려주세요";
  $("#removeImageBtn").classList.add("hidden");
}

function openNew() {
  if (!isAdmin) return;
  clearForm();
  show("edit");
}

function openEdit() {
  if (!isAdmin) return;
  const r = recipes.find((x) => x.id === currentId);
  if (!r) return;
  editingId = r.id;
  currentImageKey = r.imageKey || null;
  pendingImageFile = null;
  $("#editHeading").textContent = "레시피 편집";
  $("#deleteBtn").classList.remove("hidden");
  $("#categoryInput").value = r.category;
  $("#titleInput").value = r.title;
  $("#ingredientsInput").value = r.ingredients || "";
  $("#stepsInput").value = r.steps || "";
  $("#preview").innerHTML = r.imageUrl ? `<img src="${esc(r.imageUrl)}" alt="">` : "사진을 올려주세요";
  $("#removeImageBtn").classList.toggle("hidden", !r.imageUrl);
  show("edit");
}

$("#imageInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  pendingImageFile = await compressImage(file);
  const url = URL.createObjectURL(pendingImageFile);
  $("#preview").innerHTML = `<img src="${url}" alt="">`;
  $("#removeImageBtn").classList.remove("hidden");
});

$("#removeImageBtn").onclick = () => {
  pendingImageFile = null;
  currentImageKey = null;
  $("#imageInput").value = "";
  $("#preview").textContent = "사진을 올려주세요";
  $("#removeImageBtn").classList.add("hidden");
};

async function compressImage(file) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 2_500_000) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .84));
  bitmap.close();
  return blob || file;
}

async function uploadPendingImage() {
  if (!pendingImageFile) return currentImageKey;
  const fd = new FormData();
  const filename = pendingImageFile.name || "recipe.jpg";
  fd.append("file", pendingImageFile, filename);
  const data = await api("/api/upload", { method: "POST", body: fd });
  return data.key;
}

$("#saveBtn").onclick = async () => {
  const title = $("#titleInput").value.trim();
  if (!title) { alert("제목을 입력해주세요."); return; }
  const btn = $("#saveBtn");
  btn.disabled = true;
  btn.textContent = "저장 중…";
  try {
    const imageKey = await uploadPendingImage();
    const body = {
      category: $("#categoryInput").value,
      title,
      ingredients: $("#ingredientsInput").value.trim(),
      steps: $("#stepsInput").value.trim(),
      imageKey,
    };
    const data = editingId
      ? await api(`/api/recipes/${encodeURIComponent(editingId)}`, { method: "PUT", body: JSON.stringify(body) })
      : await api("/api/recipes", { method: "POST", body: JSON.stringify(body) });
    await loadRecipes();
    currentId = data.recipe.id;
    openDetail(currentId);
    toast("저장했어요 ♡");
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "저장";
  }
};

$("#deleteBtn").onclick = async () => {
  if (!editingId || !confirm("이 레시피를 삭제할까요?")) return;
  try {
    await api(`/api/recipes/${encodeURIComponent(editingId)}`, { method: "DELETE" });
    await loadRecipes();
    show("home");
    toast("삭제했어요.");
  } catch (e) { alert(e.message); }
};

$("#loginBtn").onclick = () => {
  $("#passwordInput").value = "";
  $("#loginError").textContent = "";
  $("#loginModal").classList.remove("hidden");
  setTimeout(() => $("#passwordInput").focus(), 50);
};
$("#closeLoginBtn").onclick = () => $("#loginModal").classList.add("hidden");
$("#submitLoginBtn").onclick = submitLogin;
$("#passwordInput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitLogin(); });

async function submitLogin() {
  const password = $("#passwordInput").value;
  $("#loginError").textContent = "";
  try {
    await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
    isAdmin = true;
    updateAdminUi();
    $("#loginModal").classList.add("hidden");
    toast("관리자 모드가 열렸어요.");
  } catch (e) { $("#loginError").textContent = e.message; }
}

$("#logoutBtn").onclick = async () => {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  isAdmin = false;
  updateAdminUi();
  toast("로그아웃했어요.");
};

$("#addBtn").onclick = openNew;
$("#editBtn").onclick = openEdit;
$("#backFromDetail").onclick = () => show("home");
$("#backFromEdit").onclick = () => editingId ? openDetail(editingId) : show("home");
$("#cancelBtn").onclick = () => editingId ? openDetail(editingId) : show("home");

renderTabs();
Promise.all([loadAuth(), loadRecipes()]);
