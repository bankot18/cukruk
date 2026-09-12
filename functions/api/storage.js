/**
 * Cloudflare Pages Function: /api/storage
 * Menangani Backup CSV Ringan ke Cloudflare R2 & Unduh Arsip Laporan
 */

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

/**
 * GET /api/storage
 * 1. Jika ada parameter ?file=xxx -> Mengunduh file CSV dari R2
 * 2. Jika tanpa parameter -> Menampilkan daftar riwayat backup di R2
 */
export async function onRequestGet({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  const url = new URL(request.url);
  const requestedFile = url.searchParams.get("file");

  if (!env || !env.BUCKET) {
    if (requestedFile) {
      return new Response(generateMockCsv(), {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${requestedFile}"`
        }
      });
    }

    // Mock daftar file backup
    return new Response(
      JSON.stringify({
        status: "success",
        backups: [
          { key: "backup/backup_SEKOLAH_2026-09-12.csv", size: 4096, uploaded: new Date().toISOString() },
          { key: "backup/backup_UMUM_2026-09-11.csv", size: 3120, uploaded: new Date(Date.now() - 86400000).toISOString() }
        ]
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  try {
    // 1. Download file dari R2
    if (requestedFile) {
      const object = await env.BUCKET.get(requestedFile);
      if (!object) {
        return new Response(
          JSON.stringify({ status: "error", message: "File backup tidak ditemukan di R2!" }),
          { status: 404, headers: corsHeaders }
        );
      }

      const headers = new Headers();
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Content-Type", object.httpMetadata?.contentType || "text/csv; charset=utf-8");
      headers.set("Content-Disposition", `attachment; filename="${requestedFile.split("/").pop()}"`);

      return new Response(object.body, { status: 200, headers });
    }

    // 2. List daftar file backup di R2
    const listed = await env.BUCKET.list({ prefix: "backup/" });
    const backups = (listed.objects || []).map((o) => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded
    }));

    return new Response(JSON.stringify({ status: "success", backups }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "R2 Storage Error: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * POST /api/storage
 * Memicu snapshot backup data dari D1 ke file .csv ringan di R2
 */
export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const body = await request.json().catch(() => ({}));
    const category = (body.category || "ALL").toUpperCase();
    const dateStr = new Date().toISOString().split("T")[0];
    const timeStr = Date.now();
    const filename = `backup/backup_${category}_${dateStr}_${timeStr}.csv`;

    if (!env || !env.DB || !env.BUCKET) {
      return new Response(
        JSON.stringify({
          status: "success",
          message: `Snapshot backup CSV berhasil disimpan ke R2 (Mode Mock): ${filename}`,
          filename
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // Ambil data dari D1
    let sql = "SELECT * FROM records";
    const params = [];
    if (category !== "ALL") {
      sql += " WHERE category = ?1";
      params.push(category);
    }
    sql += " ORDER BY category ASC, updated_at DESC";

    const { results } = await env.DB.prepare(sql).bind(...params).all();

    if (!results || results.length === 0) {
      return new Response(
        JSON.stringify({ status: "error", message: "Tidak ada data untuk dibackup ke R2!" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Bangun teks CSV
    const headers = Object.keys(results[0]);
    const csvLines = [headers.join(",")];

    for (const row of results) {
      const line = headers.map((h) => {
        let val = row[h];
        if (val === null || val === undefined) return '""';
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      }).join(",");
      csvLines.push(line);
    }

    const csvContent = "\uFEFF" + csvLines.join("\r\n"); // UTF-8 BOM

    // Simpan ke R2
    await env.BUCKET.put(filename, csvContent, {
      httpMetadata: {
        contentType: "text/csv; charset=utf-8"
      },
      customMetadata: {
        category,
        totalRecords: String(results.length),
        createdAt: new Date().toISOString()
      }
    });

    return new Response(
      JSON.stringify({
        status: "success",
        message: `Snapshot data berhasil diarsipkan ke Cloudflare R2 (${results.length} baris)`,
        filename,
        totalRecords: results.length
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "Gagal backup ke R2: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

function generateMockCsv() {
  return `"nik","nama","category","sekolah","kelas","bb","tb","lp","sistol","diastol","gula","hb","karies","kacamata","menstruasi","kebugaran","status"\r\n"3201015408100001","Siti Rahmadani","SEKOLAH","SMPN 1 Cibinong","8B","45.5","153.0","68.0","110","70","95","12.8","1","Tidak","Teratur","Baik","SELESAI_PEMERIKSAAN"`;
}
