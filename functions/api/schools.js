/**
 * Cloudflare Pages Function: /api/schools
 * Master Data Sekolah per Puskesmas (Nama Sekolah & Alamat Sekolah)
 */

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

const DEFAULT_MOCK_SCHOOLS = [
  { id: 1, instansi: "Puskesmas Banjaran", nama_sekolah: "MIS PERSIS 278 PANGKALAN", alamat_sekolah: "Kp Taraju RT 02 RW 05 Tarajusari" },
  { id: 2, instansi: "Puskesmas Banjaran", nama_sekolah: "SDN BANJARAN 01", alamat_sekolah: "Jl. Raya Banjaran No. 12" },
  { id: 3, instansi: "Puskesmas Banjaran", nama_sekolah: "SMAN 1 BANJARAN", alamat_sekolah: "Jl. Ciapus No. 5" },
  { id: 4, instansi: "Puskesmas Cibinong", nama_sekolah: "SDN CIBINONG 01", alamat_sekolah: "Jl. Mayor Oking No. 10 Cibinong" },
  { id: 5, instansi: "Puskesmas Cibinong", nama_sekolah: "SMPN 1 CIBINONG", alamat_sekolah: "Jl. Raya Jakarta-Bogor Km. 42" }
];

export async function onRequestGet({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  const url = new URL(request.url);
  const instansi = (url.searchParams.get("instansi") || "").trim();
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();

  if (!env || !env.DB) {
    let list = [...DEFAULT_MOCK_SCHOOLS];
    if (instansi) list = list.filter(s => s.instansi.toLowerCase() === instansi.toLowerCase());
    if (search) {
      list = list.filter(s =>
        s.nama_sekolah.toLowerCase().includes(search) ||
        s.alamat_sekolah.toLowerCase().includes(search)
      );
    }
    return new Response(JSON.stringify({ status: "success", schools: list }), { status: 200, headers: corsHeaders });
  }

  try {
    let sql = "SELECT * FROM schools";
    let params = [];
    let where = [];

    if (instansi) {
      params.push(instansi);
      where.push(`instansi = ?${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      const p = params.length;
      where.push(`(LOWER(nama_sekolah) LIKE ?${p} OR LOWER(alamat_sekolah) LIKE ?${p})`);
    }

    if (where.length > 0) {
      sql += " WHERE " + where.join(" AND ");
    }

    sql += " ORDER BY nama_sekolah ASC";

    const { results } = await env.DB.prepare(sql).bind(...params).all();
    return new Response(JSON.stringify({ status: "success", schools: results || [] }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ status: "error", message: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const body = await request.json();

    // 1. Dukungan Bulk Import (Array data sekolah dari Excel / CSV)
    const isBulk = Array.isArray(body) || (body.bulk && Array.isArray(body.bulk));
    const items = isBulk ? (Array.isArray(body) ? body : body.bulk) : [body];

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ status: "error", message: "Data sekolah tidak boleh kosong!" }), { status: 400, headers: corsHeaders });
    }

    if (!env || !env.DB) {
      let inserted = 0;
      for (const item of items) {
        const instansi = (item.instansi || body.instansi || "Puskesmas").trim();
        const nama = (item.nama_sekolah || item.nama || item.name || "").trim();
        const alamat = (item.alamat_sekolah || item.alamat || item.address || "").trim();
        if (nama && alamat) {
          DEFAULT_MOCK_SCHOOLS.push({ id: Date.now() + Math.random(), instansi, nama_sekolah: nama, alamat_sekolah: alamat });
          inserted++;
        }
      }
      return new Response(JSON.stringify({ status: "success", message: `${inserted} data sekolah diproses (Mock Mode)`, total: inserted }), { status: 200, headers: corsHeaders });
    }

    // 2. Jika Single Insert (Bisa berikan notifikasi duplikat yang ramah pengguna)
    if (!isBulk) {
      const data = items[0];
      const instansi = (data.instansi || body.instansi || "").trim();
      const nama = (data.nama_sekolah || data.nama || data.name || "").trim();
      const alamat = (data.alamat_sekolah || data.alamat || data.address || "").trim();

      if (!instansi || !nama || !alamat) {
        return new Response(JSON.stringify({ status: "error", message: "Puskesmas, Nama Sekolah, dan Alamat Sekolah wajib diisi!" }), { status: 400, headers: corsHeaders });
      }

      // Cek apakah kombinasi instansi + nama_sekolah + alamat_sekolah sudah ada
      const existing = await env.DB.prepare(
        "SELECT id FROM schools WHERE LOWER(instansi) = LOWER(?1) AND LOWER(nama_sekolah) = LOWER(?2) AND LOWER(alamat_sekolah) = LOWER(?3)"
      ).bind(instansi, nama, alamat).first();

      if (existing) {
        return new Response(JSON.stringify({
          status: "error",
          message: `Sekolah "${nama}" dengan alamat "${alamat}" sudah terdaftar di ${instansi}. (Nama sama dengan alamat berbeda diperbolehkan).`
        }), { status: 409, headers: corsHeaders });
      }

      const res = await env.DB.prepare(
        "INSERT INTO schools (instansi, nama_sekolah, alamat_sekolah, updated_at) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)"
      ).bind(instansi, nama, alamat).run();

      return new Response(JSON.stringify({
        status: "success",
        message: `Sekolah "${nama}" berhasil ditambahkan ke ${instansi}.`,
        school: { id: res.meta?.last_row_id, instansi, nama_sekolah: nama, alamat_sekolah: alamat }
      }), { status: 200, headers: corsHeaders });
    }

    // 3. Jika Bulk Insert (Excel/CSV Ingestion)
    const fallbackInstansi = (body.instansi || (items[0] && items[0].instansi) || "").trim();
    const insertStmt = env.DB.prepare(`
      INSERT OR IGNORE INTO schools (instansi, nama_sekolah, alamat_sekolah, updated_at)
      VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
    `);

    const statements = [];
    let validCount = 0;

    for (const item of items) {
      const instansi = (item.instansi || fallbackInstansi).trim();
      const nama = (item.nama_sekolah || item.nama || item.name || "").trim();
      const alamat = (item.alamat_sekolah || item.alamat || item.address || "").trim();

      if (instansi && nama && alamat) {
        statements.push(insertStmt.bind(instansi, nama, alamat));
        validCount++;
      }
    }

    if (statements.length > 0) {
      await env.DB.batch(statements);
    }

    return new Response(JSON.stringify({
      status: "success",
      message: `Berhasil memproses ${validCount} data sekolah ke ${fallbackInstansi || 'Puskesmas'}`,
      total: validCount
    }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ status: "error", message: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestDelete({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const instansi = url.searchParams.get("instansi");

    if (!id) {
      return new Response(JSON.stringify({ status: "error", message: "ID Sekolah wajib disertakan!" }), { status: 400, headers: corsHeaders });
    }

    if (!env || !env.DB) {
      return new Response(JSON.stringify({ status: "success", message: "Sekolah berhasil dihapus (Mock Mode)" }), { status: 200, headers: corsHeaders });
    }

    let delSql = "DELETE FROM schools WHERE id = ?1";
    let params = [id];

    if (instansi && instansi.trim() !== "") {
      delSql += " AND instansi = ?2";
      params.push(instansi.trim());
    }

    await env.DB.prepare(delSql).bind(...params).run();
    return new Response(JSON.stringify({ status: "success", message: "Data sekolah berhasil dihapus." }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ status: "error", message: err.message }), { status: 500, headers: corsHeaders });
  }
}
