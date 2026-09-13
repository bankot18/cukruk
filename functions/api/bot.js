/**
 * Cloudflare Pages Function: /api/bot
 * Bot Command Center & Telemetry Handler for ENCO Extension Bot
 */

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

// In-memory state untuk bot telemetry sederhana jika D1 belum memiliki tabel bot_telemetry
let inMemoryBotState = {
  status: "ONLINE", // ONLINE, IDLE, OFFLINE
  activeWorkers: 1,
  currentTask: "Siap melakukan automasi",
  delayMs: 1500,
  lastHeartbeat: new Date().toISOString(),
  logs: [
    { time: new Date().toLocaleTimeString("id-ID"), type: "info", message: "Bot Telemetry Service aktif di Cloudflare Edge." }
  ]
};

export async function onRequestGet({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  const url = new URL(request.url);

  // Hitung queue stats dari database D1 jika tersedia
  let queueStats = {
    queued: 0,
    synced: 0,
    failed: 0,
    total: 0
  };

  if (env && env.DB) {
    try {
      const total = await env.DB.prepare("SELECT COUNT(*) as c FROM records").first("c") || 0;
      const selesai = await env.DB.prepare("SELECT COUNT(*) as c FROM records WHERE status = 'SELESAI_PEMERIKSAAN'").first("c") || 0;
      const terdaftar = await env.DB.prepare("SELECT COUNT(*) as c FROM records WHERE status = 'TERDAFTAR'").first("c") || 0;
      
      queueStats.total = total;
      queueStats.synced = selesai;
      queueStats.queued = terdaftar;
      queueStats.failed = 0;
    } catch (e) {
      console.error("Failed to query queue stats:", e);
    }
  }

  // Cek apakah bot masih dianggap online (dalam 5 menit terakhir)
  const lastActiveTime = new Date(inMemoryBotState.lastHeartbeat).getTime();
  const now = Date.now();
  const isOnline = (now - lastActiveTime) < 5 * 60 * 1000;
  inMemoryBotState.status = isOnline ? "ONLINE" : "IDLE";

  return new Response(
    JSON.stringify({
      status: "success",
      bot: {
        ...inMemoryBotState,
        queue: queueStats
      }
    }),
    { status: 200, headers: corsHeaders }
  );
}

export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const body = await request.json();
    const action = body.action || "heartbeat";

    // 1. HEARTBEAT / PING DARI EXTENSION BOT
    if (action === "heartbeat" || action === "ping") {
      inMemoryBotState.lastHeartbeat = new Date().toISOString();
      inMemoryBotState.status = "ONLINE";
      if (body.worker) inMemoryBotState.lastWorker = body.worker;
      if (body.currentTask) inMemoryBotState.currentTask = body.currentTask;
      if (body.activeWorkers !== undefined) inMemoryBotState.activeWorkers = body.activeWorkers;

      if (body.log) {
        inMemoryBotState.logs.unshift({
          time: new Date().toLocaleTimeString("id-ID"),
          type: body.logType || "info",
          message: body.log
        });
        if (inMemoryBotState.logs.length > 50) inMemoryBotState.logs.pop();
      }

      return new Response(
        JSON.stringify({ status: "success", message: "Heartbeat acknowledged", delayMs: inMemoryBotState.delayMs }),
        { status: 200, headers: corsHeaders }
      );
    }

    // 2. REMOTE DELAY / SPEED SETTING DARI WEB PANEL
    if (action === "update_speed") {
      const delay = parseInt(body.delayMs, 10);
      if (delay >= 500 && delay <= 10000) {
        inMemoryBotState.delayMs = delay;
        inMemoryBotState.logs.unshift({
          time: new Date().toLocaleTimeString("id-ID"),
          type: "system",
          message: `Kecepatan jeda bot diatur menjadi ${delay}ms`
        });
        return new Response(
          JSON.stringify({ status: "success", message: `Jeda bot berhasil diperbarui ke ${delay}ms`, delayMs: delay }),
          { status: 200, headers: corsHeaders }
        );
      } else {
        return new Response(
          JSON.stringify({ status: "error", message: "Jeda harus antara 500ms sampai 10000ms" }),
          { status: 400, headers: corsHeaders }
        );
      }
    }

    // 3. RE-QUEUE FAILED / ALL RECORDS
    if (action === "requeue") {
      const category = (body.category || "SEKOLAH").toUpperCase();
      const targetNiks = body.niks || [];

      if (env && env.DB) {
        if (targetNiks.length > 0) {
          const placeholders = targetNiks.map((_, i) => `?${i + 1}`).join(",");
          await env.DB.prepare(
            `UPDATE records SET status = 'TERDAFTAR', updated_at = CURRENT_TIMESTAMP WHERE nik IN (${placeholders})`
          ).bind(...targetNiks).run();
        } else {
          await env.DB.prepare(
            `UPDATE records SET status = 'TERDAFTAR', updated_at = CURRENT_TIMESTAMP WHERE category = ?1`
          ).bind(category).run();
        }
      }

      inMemoryBotState.logs.unshift({
        time: new Date().toLocaleTimeString("id-ID"),
        type: "action",
        message: `Perintah Re-Queue dieksekusi untuk kategori ${category}`
      });

      return new Response(
        JSON.stringify({ status: "success", message: "Data berhasil dimasukkan kembali ke antrean bot!" }),
        { status: 200, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ status: "error", message: `Aksi '${action}' tidak dikenali` }),
      { status: 400, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}
