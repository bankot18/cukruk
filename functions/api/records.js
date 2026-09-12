/**
 * Cloudflare Pages Function: /api/records
 * Perekaman Data Terpadu (UPSERT NIK) & Pemisahan UMUM vs SEKOLAH
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

export async function onRequestGet({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  const url = new URL(request.url);
  const category = (url.searchParams.get("category") || "SEKOLAH").toUpperCase();
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  const status = url.searchParams.get("status");
  const limit = parseInt(url.searchParams.get("limit") || "100", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  if (!env || !env.DB) {
    // Mock sample data jika D1 belum terhubung di lingkungan lokal
    const sampleData = generateSampleData(category);
    return new Response(
      JSON.stringify({
        status: "success",
        category,
        total: sampleData.length,
        stats: {
          total: sampleData.length,
          selesai: sampleData.filter((r) => r.status === "SELESAI_PEMERIKSAAN").length,
          terdaftar: sampleData.filter((r) => r.status === "TERDAFTAR").length
        },
        records: sampleData
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  try {
    let sql = "SELECT * FROM records WHERE category = ?1";
    const params = [category];

    if (status) {
      params.push(status);
      sql += ` AND status = ?${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      const pIdx = params.length;
      if (category === "SEKOLAH") {
        sql += ` AND (LOWER(nik) LIKE ?${pIdx} OR LOWER(nama) LIKE ?${pIdx} OR LOWER(sekolah) LIKE ?${pIdx} OR LOWER(kelas) LIKE ?${pIdx})`;
      } else {
        sql += ` AND (LOWER(nik) LIKE ?${pIdx} OR LOWER(nama) LIKE ?${pIdx} OR LOWER(no_hp) LIKE ?${pIdx} OR LOWER(alamat) LIKE ?${pIdx})`;
      }
    }

    // Hitung statistik
    const countTotal = await env.DB.prepare("SELECT COUNT(*) as c FROM records WHERE category = ?1").bind(category).first("c");
    const countSelesai = await env.DB.prepare("SELECT COUNT(*) as c FROM records WHERE category = ?1 AND status = 'SELESAI_PEMERIKSAAN'").bind(category).first("c");
    const countTerdaftar = await env.DB.prepare("SELECT COUNT(*) as c FROM records WHERE category = ?1 AND status = 'TERDAFTAR'").bind(category).first("c");

    sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const { results } = await env.DB.prepare(sql).bind(...params).all();

    return new Response(
      JSON.stringify({
        status: "success",
        category,
        stats: {
          total: countTotal || 0,
          selesai: countSelesai || 0,
          terdaftar: countTerdaftar || 0
        },
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

/**
 * POST /api/records
 * Tahap Pendaftaran Pasien (UPSERT NIK: Tidak membuat duplikasi baris jika NIK sudah ada)
 */
export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const data = await request.json();
    const nik = (data.nik || "").toString().trim();
    if (!nik) {
      return new Response(
        JSON.stringify({ status: "error", message: "NIK pasien wajib diisi!" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const category = (data.category || "SEKOLAH").toUpperCase();
    const nama = (data.nama || data.name || "").trim();
    const tanggalLahir = data.tanggal_lahir || data.tanggalLahir || null;
    const umur = data.umur ? parseInt(data.umur, 10) : null;
    const jenisKelamin = data.jenis_kelamin || data.jenisKelamin || null;
    const nomorTiket = data.nomor_tiket || data.nomorTiket || null;
    const instansi = data.instansi || "Puskesmas";
    const sekolah = data.sekolah || null;
    const kelas = data.kelas || null;
    const noHp = data.no_hp || data.noHp || null;
    const alamat = data.alamat || null;
    const petugasPendaftaran = data.petugas || data.petugas_pendaftaran || "Petugas Bot";

    if (!env || !env.DB) {
      return new Response(
        JSON.stringify({ status: "success", message: "Data pendaftaran tersimpan (Mode Mock)", nik }),
        { status: 200, headers: corsHeaders }
      );
    }

    // UPSERT: Jika NIK sudah ada, update identitas tanpa membuat duplikat baris
    const query = `
      INSERT INTO records (
        nik, category, nama, tanggal_lahir, umur, jenis_kelamin, 
        nomor_tiket, instansi, sekolah, kelas, no_hp, alamat, 
        status, petugas_pendaftaran, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'TERDAFTAR', ?13, CURRENT_TIMESTAMP)
      ON CONFLICT(nik) DO UPDATE SET
        nama = excluded.nama,
        category = excluded.category,
        tanggal_lahir = COALESCE(excluded.tanggal_lahir, records.tanggal_lahir),
        umur = COALESCE(excluded.umur, records.umur),
        jenis_kelamin = COALESCE(excluded.jenis_kelamin, records.jenis_kelamin),
        nomor_tiket = COALESCE(excluded.nomor_tiket, records.nomor_tiket),
        sekolah = COALESCE(excluded.sekolah, records.sekolah),
        kelas = COALESCE(excluded.kelas, records.kelas),
        no_hp = COALESCE(excluded.no_hp, records.no_hp),
        alamat = COALESCE(excluded.alamat, records.alamat),
        petugas_pendaftaran = excluded.petugas_pendaftaran,
        updated_at = CURRENT_TIMESTAMP;
    `;

    await env.DB.prepare(query).bind(
      nik, category, nama, tanggalLahir, umur, jenisKelamin,
      nomorTiket, instansi, sekolah, kelas, noHp, alamat, petugasPendaftaran
    ).run();

    return new Response(
      JSON.stringify({ status: "success", message: "Pendaftaran berhasil disimpan ke Cloudflare D1", nik }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "Gagal menyimpan pendaftaran: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * PATCH /api/records
 * Tahap Pemeriksaan Klinis (Menu Pasien): Melengkapi baris NIK yang sama
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

    const category = (data.category || "SEKOLAH").toUpperCase();
    const nama = (data.nama || "").trim();
    const bb = data.bb ? parseFloat(data.bb) : null;
    const tb = data.tb ? parseFloat(data.tb) : null;
    const lp = data.lp ? parseFloat(data.lp) : null;
    const sistol = data.td_sistolik || data.sistol ? parseInt(data.td_sistolik || data.sistol, 10) : null;
    const diastol = data.td_diastolik || data.diastol ? parseInt(data.td_diastolik || data.diastol, 10) : null;
    const gula = data.gula_darah || data.gula ? parseInt(data.gula_darah || data.gula, 10) : null;
    const hb = data.hb ? parseFloat(data.hb) : null;
    const karies = data.karies || data.gigi || null;
    const kacamata = data.kacamata || null;
    const menstruasi = data.menstruasi || null;
    const kebugaran = data.kebugaran || null;
    const merokok = data.merokok || null;
    const kadarCo = data.kadar_co || data.kadarCo ? parseInt(data.kadar_co || data.kadarCo, 10) : null;
    const katarak = data.katarak || null;
    const telinga = data.telinga || null;
    const mata = data.mata || null;
    const petugasPemeriksaan = data.petugas || data.petugas_pemeriksaan || "Petugas Bot";

    if (!env || !env.DB) {
      return new Response(
        JSON.stringify({ status: "success", message: "Hasil pemeriksaan tersimpan (Mode Mock)", nik }),
        { status: 200, headers: corsHeaders }
      );
    }

    // Melengkapi baris pasien berdasarkan NIK (UPSERT jika pasien belum pernah didaftarkan via bot)
    const query = `
      INSERT INTO records (
        nik, category, nama, bb, tb, lp, td_sistolik, td_diastolik, gula_darah,
        hb, karies, kacamata, menstruasi, kebugaran, merokok, kadar_co, katarak, telinga, mata,
        status, petugas_pemeriksaan, updated_at
      )
      VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
        ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19,
        'SELESAI_PEMERIKSAAN', ?20, CURRENT_TIMESTAMP
      )
      ON CONFLICT(nik) DO UPDATE SET
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
        status = 'SELESAI_PEMERIKSAAN',
        petugas_pemeriksaan = excluded.petugas_pemeriksaan,
        updated_at = CURRENT_TIMESTAMP;
    `;

    await env.DB.prepare(query).bind(
      nik, category, nama || "Pasien Langsung", bb, tb, lp, sistol, diastol, gula,
      hb, karies, kacamata, menstruasi, kebugaran, merokok, kadarCo, katarak, telinga, mata,
      petugasPemeriksaan
    ).run();

    return new Response(
      JSON.stringify({ status: "success", message: "Hasil pemeriksaan klinis berhasil diperbarui di D1", nik }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "Gagal update pemeriksaan: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

function generateSampleData(category) {
  if (category === "SEKOLAH") {
    return [
      {
        nik: "3201015408100001",
        nama: "Siti Rahmadani",
        tanggal_lahir: "14/08/2010",
        umur: 14,
        jenis_kelamin: "Perempuan",
        nomor_tiket: "TIK-SKL-001",
        sekolah: "SMPN 1 Cibinong",
        kelas: "8B",
        bb: 45.5,
        tb: 153.0,
        lp: 68.0,
        td_sistolik: 110,
        td_diastolik: 70,
        gula_darah: 95,
        hb: 12.8,
        karies: "1",
        kacamata: "Tidak",
        menstruasi: "Teratur",
        kebugaran: "Baik",
        status: "SELESAI_PEMERIKSAAN",
        petugas_pendaftaran: "admin",
        petugas_pemeriksaan: "petugas1",
        updated_at: new Date().toISOString()
      },
      {
        nik: "3201011205090002",
        nama: "Ahmad Maulana",
        tanggal_lahir: "12/05/2009",
        umur: 15,
        jenis_kelamin: "Laki-laki",
        nomor_tiket: "TIK-SKL-002",
        sekolah: "SMPN 1 Cibinong",
        kelas: "9A",
        bb: 52.0,
        tb: 162.0,
        lp: 72.0,
        td_sistolik: 115,
        td_diastolik: 75,
        gula_darah: 102,
        hb: 14.1,
        karies: "tidak-ada",
        kacamata: "Ya",
        menstruasi: "-",
        kebugaran: "Baik Sekali",
        status: "SELESAI_PEMERIKSAAN",
        petugas_pendaftaran: "admin",
        petugas_pemeriksaan: "petugas1",
        updated_at: new Date().toISOString()
      },
      {
        nik: "3201016503110003",
        nama: "Rina Permata",
        tanggal_lahir: "25/03/2011",
        umur: 13,
        jenis_kelamin: "Perempuan",
        nomor_tiket: "TIK-SKL-003",
        sekolah: "SMPN 1 Cibinong",
        kelas: "7C",
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
        updated_at: new Date().toISOString()
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
        updated_at: new Date().toISOString()
      },
      {
        nik: "3201014506900002",
        nama: "Dewi Lestari",
        tanggal_lahir: "05/06/1990",
        umur: 34,
        jenis_kelamin: "Perempuan",
        nomor_tiket: "TIK-UM-002",
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
        updated_at: new Date().toISOString()
      }
    ];
  }
}
