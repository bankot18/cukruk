/**
 * ==========================================================================
 * CLOUDFLARE WORKER ROUTER & STATIC ASSETS HANDLER - ENCO (Entry CKG Otomatis)
 * File: worker.js (Root Repository)
 * ==========================================================================
 */

import * as authHandler from "./functions/api/auth.js";
import * as usersHandler from "./functions/api/users.js";
import * as recordsHandler from "./functions/api/records.js";
import * as storageHandler from "./functions/api/storage.js";
import * as botHandler from "./functions/api/bot.js";
import * as faskesHandler from "./functions/api/faskes.js";
import * as schoolsHandler from "./functions/api/schools.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. ROUTING API /api/auth
    if (pathname === "/api/auth") {
      if (request.method === "OPTIONS") return authHandler.onRequestOptions({ request, env });
      if (request.method === "POST") return authHandler.onRequestPost({ request, env });
    }

    // 2. ROUTING API /api/users
    if (pathname === "/api/users") {
      if (request.method === "OPTIONS") return usersHandler.onRequestOptions({ request, env });
      if (request.method === "GET") return usersHandler.onRequestGet({ request, env });
      if (request.method === "POST") return usersHandler.onRequestPost({ request, env });
      if (request.method === "PATCH" || request.method === "PUT") return usersHandler.onRequestPatch({ request, env });
      if (request.method === "DELETE") return usersHandler.onRequestDelete({ request, env });
    }

    // 3. ROUTING API /api/records
    if (pathname === "/api/records") {
      if (request.method === "OPTIONS") return recordsHandler.onRequestOptions({ request, env });
      if (request.method === "GET") return recordsHandler.onRequestGet({ request, env });
      if (request.method === "POST") return recordsHandler.onRequestPost({ request, env });
      if (request.method === "PATCH" || request.method === "PUT") return recordsHandler.onRequestPatch({ request, env });
      if (request.method === "DELETE") return recordsHandler.onRequestDelete({ request, env });
    }

    // 4. ROUTING API /api/bot (Telemetry, Re-queue, Speed Control)
    if (pathname === "/api/bot") {
      if (request.method === "OPTIONS") return botHandler.onRequestOptions({ request, env });
      if (request.method === "GET") return botHandler.onRequestGet({ request, env });
      if (request.method === "POST") return botHandler.onRequestPost({ request, env });
    }

    // 5. ROUTING API /api/storage
    if (pathname === "/api/storage") {
      if (request.method === "OPTIONS") return storageHandler.onRequestOptions({ request, env });
      if (request.method === "GET") return storageHandler.onRequestGet({ request, env });
      if (request.method === "POST") return storageHandler.onRequestPost({ request, env });
    }

    // 6. ROUTING API /api/faskes (Master Data Faskes - Puskesmas & Rumah Sakit)
    if (pathname === "/api/faskes") {
      if (request.method === "OPTIONS") return faskesHandler.onRequestOptions({ request, env });
      if (request.method === "GET") return faskesHandler.onRequestGet({ request, env });
      if (request.method === "POST") return faskesHandler.onRequestPost({ request, env });
      if (request.method === "DELETE") return faskesHandler.onRequestDelete({ request, env });
    }

    // 7. ROUTING API /api/schools (Master Data Sekolah per Puskesmas)
    if (pathname === "/api/schools") {
      if (request.method === "OPTIONS") return schoolsHandler.onRequestOptions({ request, env });
      if (request.method === "GET") return schoolsHandler.onRequestGet({ request, env });
      if (request.method === "POST") return schoolsHandler.onRequestPost({ request, env });
      if (request.method === "DELETE") return schoolsHandler.onRequestDelete({ request, env });
    }

    // 8. STATIC ASSETS (index.html, style.css, app.js dari folder public/)
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
