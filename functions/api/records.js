/**
 * Cloudflare Pages Function: /api/records
 * Perekaman Data Terpadu, Pagination, Multi-Filter, Analitik Klinis & Bulk Ingestion
 */

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

export async function onRequestGet({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  const url = new URL(request.url);
  const category = (url.searchParams.get("category") || "SEKOLAH").toUpperCase();
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  const status = url.searchParams.get("status");
  const sekolah = url.searchParams.get("sekolah");
  const kelas = url.searchParams.get("kelas");
  const instansi = url.searchParams.get("instansi");
  const risk = url.searchParams.get("risk"); // hipertensi, gula_tinggi, anemia, karies, obesitas
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limitParam = url.searchParams.get("limit") || "25";
  const isExportAll = limitParam === "-1" || limitParam.toLowerCase() === "all";
  const limit = isExportAll ? 5000 : parseInt(limitParam, 10);
  const offset = (page - 1) * limit;

  if (!env || !env.DB) {
    // Mode Mock jika D1 belum terhubung di preview
    let sampleData = generateSampleData(category);

    if (instansi) sampleData = sampleData.filter(r => r.instansi === instansi);
    if (status) sampleData = sampleData.filter(r => r.status === status);
    if (sekolah && category === "SEKOLAH") sampleData = sampleData.filter(r => r.sekolah === sekolah);
    if (kelas && category === "SEKOLAH") sampleData = sampleData.filter(r => r.kelas === kelas);
    if (search) {
      sampleData = sampleData.filter(r => 
        (r.nik && r.nik.toLowerCase().includes(search)) ||
        (r.nama && r.nama.toLowerCase().includes(search)) ||
        (r.sekolah && r.sekolah.toLowerCase().includes(search)) ||
        (r.alamat && r.alamat.toLowerCase().includes(search))
      );
    }
    if (risk) {
      sampleData = sampleData.filter(r => filterByRisk(r, risk));
    }

    const totalCount = sampleData.length;
    const paginated = isExportAll ? sampleData : sampleData.slice(offset, offset + limit);

    return new Response(
      JSON.stringify({
        status: "success",
        category,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit) || 1
        },
        stats: calculateMockStats(sampleData),
        records: paginated
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  try {
    let whereClauses = ["category = ?1"];
    let params = [category];

    if (instansi && instansi.trim() !== "" && instansi.toUpperCase() !== "ALL") {
      params.push(instansi.trim());
      const pIdx = params.length;
      whereClauses.push(`(LOWER(instansi) = LOWER(?${pIdx}) OR instansi = 'Puskesmas' OR instansi IS NULL OR instansi = '')`);
    }

    if (status) {
      params.push(status);
      whereClauses.push(`status = ?${params.length}`);
    }

    if (sekolah && category === "SEKOLAH") {
      params.push(sekolah);
      whereClauses.push(`sekolah = ?${params.length}`);
    }

    if (kelas && category === "SEKOLAH") {
      params.push(kelas);
      whereClauses.push(`kelas = ?${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      const pIdx = params.length;
      if (category === "SEKOLAH") {
        whereClauses.push(`(LOWER(nik) LIKE ?${pIdx} OR LOWER(nama) LIKE ?${pIdx} OR LOWER(sekolah) LIKE ?${pIdx} OR LOWER(kelas) LIKE ?${pIdx})`);
      } else {
        whereClauses.push(`(LOWER(nik) LIKE ?${pIdx} OR LOWER(nama) LIKE ?${pIdx} OR LOWER(no_hp) LIKE ?${pIdx} OR LOWER(alamat) LIKE ?${pIdx})`);
      }
    }

    // Filter kondisi klinis risiko
    if (risk === "hipertensi") {
      whereClauses.push(`(td_sistolik >= 140 OR td_diastolik >= 90)`);
    } else if (risk === "gula_tinggi") {
      whereClauses.push(`(gula_darah >= 200)`);
    } else if (risk === "anemia" && category === "SEKOLAH") {
      whereClauses.push(`(hb IS NOT NULL AND hb > 0 AND hb < 12)`);
    } else if (risk === "karies" && category === "SEKOLAH") {
      whereClauses.push(`(karies IS NOT NULL AND karies != '' AND karies != 'Tidak' AND karies != '0')`);
    } else if (risk === "obesitas") {
      whereClauses.push(`(bb IS NOT NULL AND tb IS NOT NULL AND (bb / ((tb/100.0) * (tb/100.0))) >= 25.0)`);
    }

    const whereSql = whereClauses.join(" AND ");

    // 1. Hitung total data yang cocok dengan filter
    const countQuery = `SELECT COUNT(*) as c FROM records WHERE ${whereSql}`;
    const totalMatching = await env.DB.prepare(countQuery).bind(...params).first("c") || 0;

    // 2. Ambil statistik umum untuk dashboard (difilter per instansi jika ada)
    const baseStats = await getAggregatedStats(env.DB, category, instansi);

    // 3. Ambil daftar sekolah unik untuk dropdown filter (difilter per instansi jika ada)
    let sekolahList = [];
    if (category === "SEKOLAH") {
      let schSql = "SELECT DISTINCT sekolah FROM records WHERE category = 'SEKOLAH' AND sekolah IS NOT NULL AND sekolah != ''";
      let schParams = [];
      if (instansi && instansi.trim() !== "") {
        schSql += " AND instansi = ?1";
        schParams.push(instansi.trim());
      }
      schSql += " ORDER BY sekolah ASC";
      const schResults = await env.DB.prepare(schSql).bind(...schParams).all();
      sekolahList = (schResults.results || []).map(r => r.sekolah);
    }

    // 4. Ambil data dengan Pagination
    let dataSql = `SELECT * FROM records WHERE ${whereSql} ORDER BY updated_at DESC LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
    const dataParams = [...params, limit, offset];
    const { results } = await env.DB.prepare(dataSql).bind(...dataParams).all();

    return new Response(
      JSON.stringify({
        status: "success",
        category,
        pagination: {
          page,
          limit,
          total: totalMatching,
          totalPages: Math.ceil(totalMatching / limit) || 1
        },
        sekolahList,
        stats: baseStats,
        records: results || []
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

async function getAggregatedStats(db, category, instansi = null) {
  try {
    let whereBase = "category = ?1";
    let params = [category];
    if (instansi && instansi.trim() !== "" && instansi.toUpperCase() !== "ALL") {
      whereBase += " AND (LOWER(instansi) = LOWER(?2) OR instansi = 'Puskesmas' OR instansi IS NULL OR instansi = '')";
      params.push(instansi.trim());
    }

    const total = await db.prepare(`SELECT COUNT(*) as c FROM records WHERE ${whereBase}`).bind(...params).first("c") || 0;
    const selesai = await db.prepare(`SELECT COUNT(*) as c FROM records WHERE ${whereBase} AND status = 'SELESAI_PEMERIKSAAN'`).bind(...params).first("c") || 0;
    const terdaftar = await db.prepare(`SELECT COUNT(*) as c FROM records WHERE ${whereBase} AND status = 'TERDAFTAR'`).bind(...params).first("c") || 0;

    // Statistik klinis
    const hipertensi = await db.prepare(`SELECT COUNT(*) as c FROM records WHERE ${whereBase} AND (td_sistolik >= 140 OR td_diastolik >= 90)`).bind(...params).first("c") || 0;
    const gulaTinggi = await db.prepare(`SELECT COUNT(*) as c FROM records WHERE ${whereBase} AND gula_darah >= 200`).bind(...params).first("c") || 0;
    
    let anemia = 0;
    let karies = 0;
    if (category === "SEKOLAH") {
      let whereAnemia = `${whereBase} AND hb IS NOT NULL AND hb > 0 AND hb < 12`;
      let whereKaries = `${whereBase} AND karies IS NOT NULL AND karies != '' AND karies != 'Tidak' AND karies != '0'`;
      anemia = await db.prepare(`SELECT COUNT(*) as c FROM records WHERE ${whereAnemia}`).bind(...params).first("c") || 0;
      karies = await db.prepare(`SELECT COUNT(*) as c FROM records WHERE ${whereKaries}`).bind(...params).first("c") || 0;
    }

    const obesitas = await db.prepare(`SELECT COUNT(*) as c FROM records WHERE ${whereBase} AND bb IS NOT NULL AND tb IS NOT NULL AND (bb / ((tb/100.0) * (tb/100.0))) >= 25.0`).bind(...params).first("c") || 0;

    return {
      total,
      selesai,
      terdaftar,
      hipertensi,
      gulaTinggi,
      anemia,
      karies,
      obesitas
    };
  } catch (e) {
    return { total: 0, selesai: 0, terdaftar: 0, hipertensi: 0, gulaTinggi: 0, anemia: 0, karies: 0, obesitas: 0 };
  }
}

/**
 * POST /api/records
 * Mendukung Single Pendaftaran atau Batch / Bulk Import dari Excel/CSV
 */
export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const body = await request.json();

    // 1. DUKUNGAN BATCH / BULK IMPORT (Array data dari Excel)
    const items = Array.isArray(body) ? body : (body.bulk || [body]);

    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({ status: "error", message: "Data tidak boleh kosong!" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!env || !env.DB) {
      return new Response(
        JSON.stringify({ status: "success", message: `${items.length} data pendaftaran diproses (Mode Mock)`, total: items.length }),
        { status: 200, headers: corsHeaders }
      );
    }

    let successCount = 0;
    let errorCount = 0;

    const upsertStmt = env.DB.prepare(`
      INSERT INTO records (
        nik, category, nama, tanggal_lahir, umur, jenis_kelamin, 
        nomor_tiket, instansi, sekolah, kelas, no_hp, alamat, 
        bb, tb, lp, td_sistolik, td_diastolik, gula_darah, hb,
        karies, kacamata, menstruasi, kebugaran, merokok, kadar_co,
        katarak, telinga, mata, status, petugas_pendaftaran, updated_at
      )
      VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6,
        ?7, ?8, ?9, ?10, ?11, ?12,
        ?13, ?14, ?15, ?16, ?17, ?18, ?19,
        ?20, ?21, ?22, ?23, ?24, ?25,
        ?26, ?27, ?28, ?29, ?30, CURRENT_TIMESTAMP
      )
      ON CONFLICT(nik) DO UPDATE SET
        nama = excluded.nama,
        category = excluded.category,
        tanggal_lahir = COALESCE(excluded.tanggal_lahir, records.tanggal_lahir),
        umur = COALESCE(excluded.umur, records.umur),
        jenis_kelamin = COALESCE(excluded.jenis_kelamin, records.jenis_kelamin),
        nomor_tiket = COALESCE(excluded.nomor_tiket, records.nomor_tiket),
        instansi = COALESCE(excluded.instansi, records.instansi),
        sekolah = COALESCE(excluded.sekolah, records.sekolah),
        kelas = COALESCE(excluded.kelas, records.kelas),
        no_hp = COALESCE(excluded.no_hp, records.no_hp),
        alamat = COALESCE(excluded.alamat, records.alamat),
        bb = COALESCE(excluded.bb, records.bb),
        tb = COALESCE(excluded.tb, records.tb),
        lp = COALESCE(excluded.lp, records.lp),
        td_sistolik = COALESCE(excluded.td_sistolik, records.td_sistolik),
        td_diastolik = COALESCE(excluded.td_diastolik, records.td_diastolik),
        gula_darah = COALESCE(excluded.gula_darah, records.gula_darah),
        hb = COALESCE(excluded.hb, records.hb),
        karies = COALESCE(excluded.karies, records.karies),
        kacamata = COALESCE(excluded.kacamata, records.kacamata),
        menstruasi = COALESCE(excluded.menstruasi, records.menstruasi),
        kebugaran = COALESCE(excluded.kebugaran, records.kebugaran),
        merokok = COALESCE(excluded.merokok, records.merokok),
        kadar_co = COALESCE(excluded.kadar_co, records.kadar_co),
        katarak = COALESCE(excluded.katarak, records.katarak),
        telinga = COALESCE(excluded.telinga, records.telinga),
        mata = COALESCE(excluded.mata, records.mata),
        petugas_pendaftaran = excluded.petugas_pendaftaran,
        updated_at = CURRENT_TIMESTAMP;
    `);

    const fallbackInstansi = (body.instansi || (items[0] && items[0].instansi) || "Puskesmas").toString().trim();

    // Jalankan eksekusi batch
    const statements = [];
    for (const data of items) {
      const nik = (data.nik || "").toString().trim();
      if (!nik) {
        errorCount++;
        continue;
      }

      const category = (data.category || "SEKOLAH").toUpperCase();
      const nama = (data.nama || data.name || "").trim();
      const tanggalLahir = data.tanggal_lahir || data.tanggalLahir || null;
      const umur = data.umur ? parseInt(data.umur, 10) : null;
      const jenisKelamin = data.jenis_kelamin || data.jenisKelamin || null;
      const nomorTiket = data.nomor_tiket || data.nomorTiket || null;
      const instansi = (data.instansi || fallbackInstansi || "Puskesmas").toString().trim();
      const sekolah = data.sekolah || null;
      const kelas = data.kelas || null;
      const noHp = data.no_hp || data.noHp || null;
      const alamat = data.alamat || null;
      
      const bb = data.bb !== undefined && data.bb !== null && data.bb !== "" ? parseFloat(data.bb) : null;
      const tb = data.tb !== undefined && data.tb !== null && data.tb !== "" ? parseFloat(data.tb) : null;
      const lp = data.lp !== undefined && data.lp !== null && data.lp !== "" ? parseFloat(data.lp) : null;
      const sistol = data.td_sistolik !== undefined && data.td_sistolik !== null && data.td_sistolik !== "" ? parseInt(data.td_sistolik, 10) : null;
      const diastol = data.td_diastolik !== undefined && data.td_diastolik !== null && data.td_diastolik !== "" ? parseInt(data.td_diastolik, 10) : null;
      const gula = data.gula_darah !== undefined && data.gula_darah !== null && data.gula_darah !== "" ? parseInt(data.gula_darah, 10) : null;
      const hb = data.hb !== undefined && data.hb !== null && data.hb !== "" ? parseFloat(data.hb) : null;
      const karies = data.karies || null;
      const kacamata = data.kacamata || null;
      const menstruasi = data.menstruasi || null;
      const kebugaran = data.kebugaran || null;
      const merokok = data.merokok || null;
      const kadarCo = data.kadar_co !== undefined && data.kadar_co !== null && data.kadar_co !== "" ? parseInt(data.kadar_co, 10) : null;
      const katarak = data.katarak || null;
      const telinga = data.telinga || null;
      const mata = data.mata || null;

      const status = data.status || "TERDAFTAR";
      const petugasPendaftaran = data.petugas || data.petugas_pendaftaran || "Petugas Import";

      statements.push(
        upsertStmt.bind(
          nik, category, nama, tanggalLahir, umur, jenisKelamin,
          nomorTiket, instansi, sekolah, kelas, noHp, alamat,
          bb, tb, lp, sistol, diastol, gula, hb,
          karies, kacamata, menstruasi, kebugaran, merokok, kadarCo,
          katarak, telinga, mata, status, petugasPendaftaran
        )
      );
      successCount++;
    }

    if (statements.length > 0) {
      await env.DB.batch(statements);
    }

    return new Response(
      JSON.stringify({
        status: "success",
        message: `Berhasil memproses ${successCount} data ke Cloudflare D1 (${fallbackInstansi})`,
        successCount,
        errorCount
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "Gagal menyimpan data: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * PATCH /api/records
 * Update Rekam Medis / Pemeriksaan Klinis Fisik
 */
export async function onRequestPatch({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const data = await request.json();
    const nik = (data.nik || "").toString().trim();
    if (!nik) {
      return new Response(
        JSON.stringify({ status: "error", message: "NIK pasien wajib disertakan!" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const bb = data.bb !== undefined && data.bb !== "" ? parseFloat(data.bb) : null;
    const tb = data.tb !== undefined && data.tb !== "" ? parseFloat(data.tb) : null;
    const lp = data.lp !== undefined && data.lp !== "" ? parseFloat(data.lp) : null;
    const sistol = data.td_sistolik !== undefined && data.td_sistolik !== "" ? parseInt(data.td_sistolik, 10) : null;
    const diastol = data.td_diastolik !== undefined && data.td_diastolik !== "" ? parseInt(data.td_diastolik, 10) : null;
    const gula = data.gula_darah !== undefined && data.gula_darah !== "" ? parseInt(data.gula_darah, 10) : null;
    const hb = data.hb !== undefined && data.hb !== "" ? parseFloat(data.hb) : null;
    const karies = data.karies || null;
    const kacamata = data.kacamata || null;
    const menstruasi = data.menstruasi || null;
    const kebugaran = data.kebugaran || null;
    const merokok = data.merokok || null;
    const kadarCo = data.kadar_co !== undefined && data.kadar_co !== "" ? parseInt(data.kadar_co, 10) : null;
    const katarak = data.katarak || null;
    const telinga = data.telinga || null;
    const mata = data.mata || null;
    const petugasPemeriksaan = data.petugas_pemeriksaan || "Petugas CKG";
    const status = data.status || "SELESAI_PEMERIKSAAN";

    // Update opsional identitas & tiket jika diedit
    const nama = data.nama || null;
    const sekolah = data.sekolah || null;
    const kelas = data.kelas || null;
    const nomorTiket = data.nomor_tiket !== undefined ? (data.nomor_tiket || null) : (data.nomorTiket !== undefined ? (data.nomorTiket || null) : null);

    if (!env || !env.DB) {
      return new Response(
        JSON.stringify({ status: "success", message: "Data pemeriksaan klinis tersimpan (Mode Mock)", nik }),
        { status: 200, headers: corsHeaders }
      );
    }

    let updateQuery = `
      UPDATE records SET
        bb = COALESCE(?1, bb),
        tb = COALESCE(?2, tb),
        lp = COALESCE(?3, lp),
        td_sistolik = COALESCE(?4, td_sistolik),
        td_diastolik = COALESCE(?5, td_diastolik),
        gula_darah = COALESCE(?6, gula_darah),
        hb = COALESCE(?7, hb),
        karies = COALESCE(?8, karies),
        kacamata = COALESCE(?9, kacamata),
        menstruasi = COALESCE(?10, menstruasi),
        kebugaran = COALESCE(?11, kebugaran),
        merokok = COALESCE(?12, merokok),
        kadar_co = COALESCE(?13, kadar_co),
        katarak = COALESCE(?14, katarak),
        telinga = COALESCE(?15, telinga),
        mata = COALESCE(?16, mata),
        status = COALESCE(?17, status),
        petugas_pemeriksaan = COALESCE(?18, petugas_pemeriksaan),
        nama = COALESCE(?19, nama),
        sekolah = COALESCE(?20, sekolah),
        kelas = COALESCE(?21, kelas),
        nomor_tiket = COALESCE(?22, nomor_tiket),
        updated_at = CURRENT_TIMESTAMP
      WHERE nik = ?23
    `;

    await env.DB.prepare(updateQuery).bind(
      bb, tb, lp, sistol, diastol, gula, hb, karies, kacamata,
      menstruasi, kebugaran, merokok, kadarCo, katarak, telinga,
      mata, status, petugasPemeriksaan, nama, sekolah, kelas, nomorTiket, nik
    ).run();

    return new Response(
      JSON.stringify({ status: "success", message: "Data pemeriksaan berhasil diperbarui!", nik }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "Gagal memperbarui rekam medis: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * DELETE /api/records
 * Hapus 1 NIK atau Bulk Delete NIKs
 */
export async function onRequestDelete({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const url = new URL(request.url);
    const nik = url.searchParams.get("nik");

    let nikList = [];
    if (nik) {
      nikList = [nik];
    } else {
      try {
        const body = await request.json();
        if (body.niks && Array.isArray(body.niks)) {
          nikList = body.niks;
        }
      } catch (e) {}
    }

    if (nikList.length === 0) {
      return new Response(
        JSON.stringify({ status: "error", message: "NIK yang akan dihapus tidak ditemukan!" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!env || !env.DB) {
      return new Response(
        JSON.stringify({ status: "success", message: `${nikList.length} data berhasil dihapus (Mode Mock)` }),
        { status: 200, headers: corsHeaders }
      );
    }

    const placeholders = nikList.map((_, i) => `?${i + 1}`).join(",");
    let delSql = `DELETE FROM records WHERE nik IN (${placeholders})`;
    let delParams = [...nikList];
    const instansi = url.searchParams.get("instansi");
    if (instansi && instansi.trim() !== "") {
      delSql += ` AND instansi = ?${delParams.length + 1}`;
      delParams.push(instansi.trim());
    }
    await env.DB.prepare(delSql).bind(...delParams).run();

    return new Response(
      JSON.stringify({ status: "success", message: `${nikList.length} rekam data pasien berhasil dihapus.` }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "Gagal menghapus data: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

// Helper untuk filter risiko klinis pada mode mock
function filterByRisk(r, risk) {
  if (risk === "hipertensi") return (r.td_sistolik >= 140 || r.td_diastolik >= 90);
  if (risk === "gula_tinggi") return (r.gula_darah >= 200);
  if (risk === "anemia") return (r.hb && r.hb > 0 && r.hb < 12);
  if (risk === "karies") return (r.karies && r.karies !== "Tidak" && r.karies !== "0");
  if (risk === "obesitas") {
    if (!r.bb || !r.tb) return false;
    const imt = r.bb / Math.pow(r.tb / 100, 2);
    return imt >= 25.0;
  }
  return true;
}

function calculateMockStats(records) {
  const total = records.length;
  const selesai = records.filter(r => r.status === "SELESAI_PEMERIKSAAN").length;
  const terdaftar = records.filter(r => r.status === "TERDAFTAR").length;
  const hipertensi = records.filter(r => r.td_sistolik >= 140 || r.td_diastolik >= 90).length;
  const gulaTinggi = records.filter(r => r.gula_darah >= 200).length;
  const anemia = records.filter(r => r.hb && r.hb > 0 && r.hb < 12).length;
  const karies = records.filter(r => r.karies && r.karies !== "Tidak" && r.karies !== "0").length;
  const obesitas = records.filter(r => r.bb && r.tb && (r.bb / Math.pow(r.tb / 100, 2)) >= 25.0).length;

  return { total, selesai, terdaftar, hipertensi, gulaTinggi, anemia, karies, obesitas };
}

function generateSampleData(category) {
  if (category === "SEKOLAH") {
    return [
      {
        nik: "3201015607080001",
        nama: "Ahmad Rizky Pratama",
        tanggal_lahir: "16/07/2008",
        umur: 16,
        jenis_kelamin: "Laki-laki",
        sekolah: "SMAN 1 Cibinong",
        kelas: "X IPA 1",
        nomor_tiket: "TIK-SK-001",
        bb: 54.5,
        tb: 165.0,
        lp: 70.0,
        td_sistolik: 115,
        td_diastolik: 75,
        gula_darah: 95,
        hb: 14.2,
        karies: "0",
        kacamata: "Tidak",
        menstruasi: "Tidak",
        kebugaran: "Baik",
        status: "SELESAI_PEMERIKSAAN",
        petugas_pendaftaran: "admin",
        petugas_pemeriksaan: "petugas1",
        updated_at: new Date(Date.now() - 3600000).toISOString()
      },
      {
        nik: "3201016209090002",
        nama: "Siti Nurhaliza",
        tanggal_lahir: "22/09/2009",
        umur: 15,
        jenis_kelamin: "Perempuan",
        sekolah: "SMAN 1 Cibinong",
        kelas: "X IPA 2",
        nomor_tiket: "TIK-SK-002",
        bb: 42.0,
        tb: 152.0,
        lp: 65.0,
        td_sistolik: 110,
        td_diastolik: 70,
        gula_darah: 88,
        hb: 10.4, // Anemia
        karies: "2 Gigi",
        kacamata: "Ya",
        menstruasi: "Ya",
        kebugaran: "Cukup",
        status: "SELESAI_PEMERIKSAAN",
        petugas_pendaftaran: "petugas1",
        petugas_pemeriksaan: "petugas1",
        updated_at: new Date(Date.now() - 7200000).toISOString()
      },
      {
        nik: "3201011103080003",
        nama: "Dimas Anggara",
        tanggal_lahir: "11/03/2008",
        umur: 16,
        jenis_kelamin: "Laki-laki",
        sekolah: "SMPN 2 Sukaraja",
        kelas: "IX B",
        nomor_tiket: "TIK-SK-003",
        bb: 78.0, // Obesitas
        tb: 162.0,
        lp: 88.0,
        td_sistolik: 145, // Hipertensi
        td_diastolik: 92,
        gula_darah: 140,
        hb: 13.8,
        karies: "3 Gigi",
        kacamata: "Tidak",
        menstruasi: "Tidak",
        kebugaran: "Kurang",
        status: "SELESAI_PEMERIKSAAN",
        petugas_pendaftaran: "petugas1",
        petugas_pemeriksaan: "petugas1",
        updated_at: new Date(Date.now() - 10800000).toISOString()
      },
      {
        nik: "3201014512080004",
        nama: "Putri Rahmadani",
        tanggal_lahir: "05/12/2008",
        umur: 16,
        jenis_kelamin: "Perempuan",
        sekolah: "SMPN 2 Sukaraja",
        kelas: "IX A",
        nomor_tiket: "TIK-SK-004",
        bb: null,
        tb: null,
        lp: null,
        td_sistolik: null,
        td_diastolik: null,
        gula_darah: null,
        hb: null,
        karies: null,
        kacamata: null,
        menstruasi: null,
        kebugaran: null,
        status: "TERDAFTAR",
        petugas_pendaftaran: "petugas1",
        petugas_pemeriksaan: null,
        updated_at: new Date(Date.now() - 14400000).toISOString()
      }
    ];
  } else {
    return [
      {
        nik: "3201012304850001",
        nama: "Budi Santoso",
        tanggal_lahir: "23/04/1985",
        umur: 39,
        jenis_kelamin: "Laki-laki",
        nomor_tiket: "TIK-UM-001",
        no_hp: "081234567890",
        alamat: "RT 02 / RW 01 Desa Sukamaju",
        bb: 68.0,
        tb: 168.0,
        lp: 84.0,
        td_sistolik: 125,
        td_diastolik: 82,
        gula_darah: 118,
        merokok: "Tidak",
        kadar_co: 0,
        katarak: "Normal",
        telinga: "Normal",
        mata: "Normal",
        status: "SELESAI_PEMERIKSAAN",
        petugas_pendaftaran: "admin",
        petugas_pemeriksaan: "petugas1",
        updated_at: new Date(Date.now() - 3600000).toISOString()
      },
      {
        nik: "3201011502750002",
        nama: "H. Supriyadi",
        tanggal_lahir: "15/02/1975",
        umur: 49,
        jenis_kelamin: "Laki-laki",
        nomor_tiket: "TIK-UM-002",
        no_hp: "081388776655",
        alamat: "RT 01 / RW 03 Desa Karang Asem",
        bb: 76.0,
        tb: 164.0,
        lp: 92.0,
        td_sistolik: 155, // Hipertensi
        td_diastolik: 98,
        gula_darah: 215, // Gula tinggi
        merokok: "Ya",
        kadar_co: 8,
        katarak: "Kekeruhan Ringan",
        telinga: "Normal",
        mata: "Visus Menurun",
        status: "SELESAI_PEMERIKSAAN",
        petugas_pendaftaran: "petugas1",
        petugas_pemeriksaan: "petugas1",
        updated_at: new Date(Date.now() - 7200000).toISOString()
      },
      {
        nik: "3201014506900003",
        nama: "Dewi Lestari",
        tanggal_lahir: "05/06/1990",
        umur: 34,
        jenis_kelamin: "Perempuan",
        nomor_tiket: "TIK-UM-003",
        no_hp: "085678901234",
        alamat: "RT 04 / RW 02 Desa Sukamaju",
        bb: null,
        tb: null,
        lp: null,
        td_sistolik: null,
        td_diastolik: null,
        gula_darah: null,
        merokok: null,
        kadar_co: null,
        katarak: null,
        telinga: null,
        mata: null,
        status: "TERDAFTAR",
        petugas_pendaftaran: "petugas1",
        petugas_pemeriksaan: null,
        updated_at: new Date(Date.now() - 10800000).toISOString()
      }
    ];
  }
}
