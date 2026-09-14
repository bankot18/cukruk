/**
 * Cloudflare Pages Function: /api/faskes
 * Master Data Fasilitas Kesehatan (Puskesmas & Rumah Sakit) Terpisah
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

const DEFAULT_MOCK_FASKES = [
  { id: 1, nama: "Puskesmas Cibinong", tipe: "PUSKESMAS", provinsi: "Jawa Barat", kab_kota: "Kab. Bogor", kecamatan: "Cibinong" },
  { id: 2, nama: "Puskesmas Banjaran", tipe: "PUSKESMAS", provinsi: "Jawa Barat", kab_kota: "Kab. Bandung", kecamatan: "Banjaran" },
  { id: 3, nama: "Puskesmas Ciawi", tipe: "PUSKESMAS", provinsi: "Jawa Barat", kab_kota: "Kab. Bogor", kecamatan: "Ciawi" },
  { id: 4, nama: "RSUD Ciawi", tipe: "RUMAH_SAKIT", provinsi: "Jawa Barat", kab_kota: "Kab. Bogor", kecamatan: "Ciawi" },
  { id: 5, nama: "RSUD Cibinong", tipe: "RUMAH_SAKIT", provinsi: "Jawa Barat", kab_kota: "Kab. Bogor", kecamatan: "Cibinong" }
];

export async function onRequestGet({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  const url = new URL(request.url);
  const tipe = (url.searchParams.get("tipe") || "").toUpperCase();
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();

  if (!env || !env.DB) {
    let list = [...DEFAULT_MOCK_FASKES];
    if (tipe) list = list.filter(f => f.tipe === tipe);
    if (search) {
      list = list.filter(f =>
        f.nama.toLowerCase().includes(search) ||
        f.kecamatan.toLowerCase().includes(search) ||
        f.kab_kota.toLowerCase().includes(search)
      );
    }
    return new Response(JSON.stringify({ status: "success", faskes: list }), { status: 200, headers: corsHeaders });
  }

  try {
    let sql = "SELECT * FROM faskes";
    let params = [];
    let where = [];

    if (tipe && (tipe === "PUSKESMAS" || tipe === "RUMAH_SAKIT")) {
      params.push(tipe);
      where.push(`tipe = ?${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      const p = params.length;
      where.push(`(LOWER(nama) LIKE ?${p} OR LOWER(kecamatan) LIKE ?${p} OR LOWER(kab_kota) LIKE ?${p})`);
    }

    if (where.length > 0) {
      sql += " WHERE " + where.join(" AND ");
    }

    sql += " ORDER BY nama ASC";

    const { results } = await env.DB.prepare(sql).bind(...params).all();
    return new Response(JSON.stringify({ status: "success", faskes: results || [] }), { status: 200, headers: corsHeaders });
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
    const nama = (body.nama || "").trim();
    const tipe = (body.tipe || "PUSKESMAS").toUpperCase();
    const provinsi = (body.provinsi || "Jawa Barat").trim();
    const kabKota = (body.kab_kota || body.kabKota || "").trim();
    const kecamatan = (body.kecamatan || "").trim();

    if (!nama) {
      return new Response(JSON.stringify({ status: "error", message: "Nama Puskesmas / Rumah Sakit tidak boleh kosong!" }), { status: 400, headers: corsHeaders });
    }
    if (tipe !== "PUSKESMAS" && tipe !== "RUMAH_SAKIT") {
      return new Response(JSON.stringify({ status: "error", message: "Tipe faskes harus PUSKESMAS atau RUMAH_SAKIT!" }), { status: 400, headers: corsHeaders });
    }
    if (!kabKota || !kecamatan) {
      return new Response(JSON.stringify({ status: "error", message: "Kab/Kota dan Kecamatan wajib diisi!" }), { status: 400, headers: corsHeaders });
    }

    if (!env || !env.DB) {
      const newMock = { id: Date.now(), nama, tipe, provinsi, kab_kota: kabKota, kecamatan };
      DEFAULT_MOCK_FASKES.push(newMock);
      return new Response(JSON.stringify({ status: "success", message: "Faskes berhasil ditambahkan (Mock Mode)", faskes: newMock }), { status: 200, headers: corsHeaders });
    }

    // Cek duplikasi faskes
    const existing = await env.DB.prepare(
      "SELECT id, nama FROM faskes WHERE LOWER(nama) = LOWER(?1) AND tipe = ?2 AND LOWER(kab_kota) = LOWER(?3) AND LOWER(kecamatan) = LOWER(?4)"
    ).bind(nama, tipe, kabKota, kecamatan).first();

    if (existing) {
      return new Response(JSON.stringify({
        status: "error",
        message: `${tipe === "PUSKESMAS" ? "Puskesmas" : "Rumah Sakit"} "${nama}" di Kecamatan ${kecamatan}, ${kabKota} sudah terdaftar di database!`
      }), { status: 409, headers: corsHeaders });
    }

    const insertSql = `
      INSERT INTO faskes (nama, tipe, provinsi, kab_kota, kecamatan, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
    `;
    const res = await env.DB.prepare(insertSql).bind(nama, tipe, provinsi, kabKota, kecamatan).run();

    return new Response(JSON.stringify({
      status: "success",
      message: `${tipe === "PUSKESMAS" ? "Puskesmas" : "Rumah Sakit"} "${nama}" berhasil didaftarkan.`,
      faskes: { id: res.meta?.last_row_id, nama, tipe, provinsi, kab_kota: kabKota, kecamatan }
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

    if (!id) {
      return new Response(JSON.stringify({ status: "error", message: "ID Faskes wajib disertakan!" }), { status: 400, headers: corsHeaders });
    }

    if (!env || !env.DB) {
      return new Response(JSON.stringify({ status: "success", message: "Faskes berhasil dihapus (Mock Mode)" }), { status: 200, headers: corsHeaders });
    }

    await env.DB.prepare("DELETE FROM faskes WHERE id = ?1").bind(id).run();
    return new Response(JSON.stringify({ status: "success", message: "Data Faskes berhasil dihapus." }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ status: "error", message: err.message }), { status: 500, headers: corsHeaders });
  }
}
