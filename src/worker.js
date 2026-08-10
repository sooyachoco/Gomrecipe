const COOKIE_NAME = "gom_recipe_admin";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const ALLOWED_CATEGORIES = new Set(["한식", "양식", "중식", "기타"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }

      if (url.pathname.startsWith("/media/")) {
        return await handleMedia(request, env, url);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: "서버 처리 중 오류가 발생했습니다." }, 500);
    }
  },
};

async function handleApi(request, env, url) {
  if (!env.DB || !env.IMAGES) {
    return json({ error: "Cloudflare D1/R2 바인딩이 아직 설정되지 않았습니다." }, 503);
  }

  const method = request.method.toUpperCase();
  const path = url.pathname;

  if (path === "/api/auth/status" && method === "GET") {
    return json({ admin: await isAdmin(request, env) });
  }

  if (path === "/api/auth/login" && method === "POST") {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
      return json({ error: "관리자 비밀값이 설정되지 않았습니다." }, 503);
    }
    const body = await readJson(request);
    if (!body || typeof body.password !== "string") {
      return json({ error: "비밀번호를 입력해주세요." }, 400);
    }
    const ok = await safeEqualText(body.password, env.ADMIN_PASSWORD);
    if (!ok) return json({ error: "비밀번호가 올바르지 않습니다." }, 401);

    const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const payload = `${exp}`;
    const sig = await hmacHex(payload, env.SESSION_SECRET);
    const value = `${payload}.${sig}`;
    return new Response(JSON.stringify({ admin: true }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
        "cache-control": "no-store",
      },
    });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    return new Response(JSON.stringify({ admin: false }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
        "cache-control": "no-store",
      },
    });
  }

  if (path === "/api/recipes" && method === "GET") {
    const category = url.searchParams.get("category");
    let query = "SELECT id, category, title, ingredients, steps, image_key, created_at, updated_at FROM recipes";
    const binds = [];
    if (category && ALLOWED_CATEGORIES.has(category)) {
      query += " WHERE category = ?";
      binds.push(category);
    }
    query += " ORDER BY updated_at DESC";
    const stmt = env.DB.prepare(query);
    const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
    return json({ recipes: result.results.map(toRecipe) });
  }

  if (path === "/api/recipes" && method === "POST") {
    if (!(await isAdmin(request, env))) return json({ error: "관리자만 작성할 수 있습니다." }, 401);
    const body = await readJson(request);
    const validated = validateRecipe(body);
    if (validated.error) return json({ error: validated.error }, 400);

    const now = Date.now();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO recipes (id, category, title, ingredients, steps, image_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, validated.category, validated.title, validated.ingredients, validated.steps, validated.imageKey, now, now).run();

    const row = await env.DB.prepare("SELECT * FROM recipes WHERE id = ?").bind(id).first();
    return json({ recipe: toRecipe(row) }, 201);
  }

  if (path === "/api/upload" && method === "POST") {
    if (!(await isAdmin(request, env))) return json({ error: "관리자만 이미지를 업로드할 수 있습니다." }, 401);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "이미지 파일이 필요합니다." }, 400);
    if (!file.type.startsWith("image/")) return json({ error: "이미지 파일만 업로드할 수 있습니다." }, 400);
    if (file.size > MAX_IMAGE_BYTES) return json({ error: "이미지는 8MB 이하로 업로드해주세요." }, 413);

    const ext = extensionForType(file.type);
    const key = `recipes/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    await env.IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
    });
    return json({ key, url: `/media/${encodeURIComponentPath(key)}` }, 201);
  }

  const match = path.match(/^\/api\/recipes\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);

    if (method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM recipes WHERE id = ?").bind(id).first();
      if (!row) return json({ error: "레시피를 찾을 수 없습니다." }, 404);
      return json({ recipe: toRecipe(row) });
    }

    if (method === "PUT") {
      if (!(await isAdmin(request, env))) return json({ error: "관리자만 수정할 수 있습니다." }, 401);
      const old = await env.DB.prepare("SELECT * FROM recipes WHERE id = ?").bind(id).first();
      if (!old) return json({ error: "레시피를 찾을 수 없습니다." }, 404);
      const body = await readJson(request);
      const validated = validateRecipe(body);
      if (validated.error) return json({ error: validated.error }, 400);

      const now = Date.now();
      await env.DB.prepare(
        "UPDATE recipes SET category = ?, title = ?, ingredients = ?, steps = ?, image_key = ?, updated_at = ? WHERE id = ?"
      ).bind(validated.category, validated.title, validated.ingredients, validated.steps, validated.imageKey, now, id).run();

      if (old.image_key && old.image_key !== validated.imageKey) {
        await env.IMAGES.delete(old.image_key).catch(() => {});
      }
      const row = await env.DB.prepare("SELECT * FROM recipes WHERE id = ?").bind(id).first();
      return json({ recipe: toRecipe(row) });
    }

    if (method === "DELETE") {
      if (!(await isAdmin(request, env))) return json({ error: "관리자만 삭제할 수 있습니다." }, 401);
      const old = await env.DB.prepare("SELECT * FROM recipes WHERE id = ?").bind(id).first();
      if (!old) return json({ error: "레시피를 찾을 수 없습니다." }, 404);
      await env.DB.prepare("DELETE FROM recipes WHERE id = ?").bind(id).run();
      if (old.image_key) await env.IMAGES.delete(old.image_key).catch(() => {});
      return json({ ok: true });
    }
  }

  return json({ error: "API 경로를 찾을 수 없습니다." }, 404);
}

async function handleMedia(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
  const encoded = url.pathname.slice("/media/".length);
  if (!encoded) return new Response("Not Found", { status: 404 });
  const key = decodeURIComponent(encoded);
  const object = await env.IMAGES.get(key);
  if (!object) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", object.httpMetadata?.cacheControl || "public, max-age=86400");
  if (request.method === "HEAD") return new Response(null, { headers });
  return new Response(object.body, { headers });
}

function validateRecipe(body) {
  if (!body || typeof body !== "object") return { error: "잘못된 요청입니다." };
  const category = String(body.category || "").trim();
  const title = String(body.title || "").trim();
  const ingredients = String(body.ingredients || "").trim();
  const steps = String(body.steps || "").trim();
  const imageKey = body.imageKey ? String(body.imageKey) : null;
  if (!ALLOWED_CATEGORIES.has(category)) return { error: "카테고리를 확인해주세요." };
  if (!title) return { error: "제목을 입력해주세요." };
  if (title.length > 120) return { error: "제목은 120자 이하로 입력해주세요." };
  if (ingredients.length > 20000 || steps.length > 30000) return { error: "내용이 너무 깁니다." };
  if (imageKey && !imageKey.startsWith("recipes/")) return { error: "이미지 정보가 올바르지 않습니다." };
  return { category, title, ingredients, steps, imageKey };
}

function toRecipe(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    ingredients: row.ingredients || "",
    steps: row.steps || "",
    imageKey: row.image_key || null,
    imageUrl: row.image_key ? `/media/${encodeURIComponentPath(row.image_key)}` : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function isAdmin(request, env) {
  if (!env.SESSION_SECRET) return false;
  const cookie = request.headers.get("cookie") || "";
  const raw = cookie.split(/;\s*/).find((v) => v.startsWith(`${COOKIE_NAME}=`));
  if (!raw) return false;
  const value = raw.slice(COOKIE_NAME.length + 1);
  const [expText, sig] = value.split(".");
  const exp = Number(expText);
  if (!exp || !sig || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(expText, env.SESSION_SECRET);
  return safeEqualHex(sig, expected);
}

async function hmacHex(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length % 2) return false;
  const aa = Uint8Array.from(a.match(/../g).map((x) => parseInt(x, 16)));
  const bb = Uint8Array.from(b.match(/../g).map((x) => parseInt(x, 16)));
  return crypto.subtle.timingSafeEqual(aa, bb);
}

async function safeEqualText(a, b) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  return crypto.subtle.timingSafeEqual(aa, bb);
}

function extensionForType(type) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "jpg";
}

function encodeURIComponentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
