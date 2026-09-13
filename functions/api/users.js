/**
 * Cloudflare Pages Function: /api/users
 * Manajemen Akun & Lisensi Faskes (Super Admin, Puskesmas, Rumah Sakit)
 */

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

export async function onRequestGet({ env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  if (!env || !env.DB) {
    return new Response(
      JSON.stringify({
        status: "success",
        users: [
          {
            id: "usr_admin_master",
            username: "admin",
            nama: "Mochamad Fauzie, S.Gz",
            role: "super_admin",
            instansi: "Dinas Kesehatan Pusat",
            status_aktif: "aktif",
            masa_aktif: null,
            lisensi: "Lifetime"
          },
          {
            id: "usr_pusk1",
            username: "pusk1",
            nama: "Petugas Puskesmas",
            role: "puskesmas",
            instansi: "Puskesmas Cibinong",
            status_aktif: "aktif",
            masa_aktif: "2026-12-31",
            lisensi: "Pro"
          },
          {
            id: "usr_rs1",
            username: "rs1",
            nama: "Operator RS",
            role: "rumah_sakit",
            instansi: "RSUD Ciawi",
            status_aktif: "aktif",
            masa_aktif: "2026-12-31",
            lisensi: "Basic"
          }
        ]
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  try {
    const { results } = await env.DB.prepare(
      "SELECT id, username, nama, role, instansi, status_aktif, masa_aktif, lisensi, created_at FROM users ORDER BY created_at DESC"
    ).all();

    // Normalisasi role & lisensi agar seragam
    const normalizedUsers = (results || []).map(u => {
      let role = u.role;
      let lisensi = u.lisensi || "Basic";

      if (role === "admin" || role === "super_admin") {
        role = "super_admin";
        lisensi = "Lifetime";
      } else if (role === "puskesmas") {
        role = "puskesmas";
      } else if (role === "rumah_sakit") {
        role = "rumah_sakit";
      } else {
        // Fallback untuk akun lama bertipe 'petugas'
        if (lisensi.toUpperCase().includes("RS") || (u.instansi && u.instansi.toLowerCase().includes("rs"))) {
          role = "rumah_sakit";
        } else {
          role = "puskesmas";
        }
      }

      // Bersihkan teks lisensi jika ada tag khusus
      if (lisensi.includes("PRO")) lisensi = "Pro";
      else if (lisensi.includes("LIFETIME")) lisensi = "Lifetime";
      else if (lisensi.includes("BASIC") || lisensi.includes("STANDARD")) lisensi = "Basic";

      return {
        ...u,
        role,
        lisensi
      };
    });

    return new Response(JSON.stringify({ status: "success", users: normalizedUsers }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ status: "error", message: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const body = await request.json();
    let role = (body.role || "puskesmas").trim().toLowerCase();
    const instansi = (body.instansi || "").trim();
    const nama = (body.nama || "").trim();
    const username = (body.username || "").trim().toLowerCase();
    const password = (body.password || "").trim();
    let jenisAkun = body.jenis_akun || body.lisensi || "Basic";
    let masaAktif = body.masa_aktif || null;
    const statusAktif = (body.status_aktif || "aktif").trim().toLowerCase();

    // Validasi Field Wajib
    if (!username || !password || !nama || !instansi) {
      return new Response(
        JSON.stringify({ status: "error", message: "Role, Instansi, Nama Petugas, Username, dan Password wajib diisi!" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Aturan Khusus Role:
    if (role === "super_admin" || role === "admin") {
      role = "super_admin";
      jenisAkun = "Lifetime";
      masaAktif = null; // Lifetime tidak memiliki batasan tanggal expired
    } else {
      // Puskesmas / Rumah Sakit
      if (role !== "rumah_sakit") role = "puskesmas";
      if (jenisAkun !== "Pro" && jenisAkun !== "Basic" && jenisAkun !== "Free") jenisAkun = "Basic";
      if (!masaAktif) masaAktif = "2026-12-31"; // Default masa aktif
    }

    if (!env || !env.DB) {
      return new Response(
        JSON.stringify({ status: "success", message: "User berhasil dibuat (Mode Mock)" }),
        { status: 200, headers: corsHeaders }
      );
    }

    // Cek duplikasi username
    const existing = await env.DB.prepare("SELECT id FROM users WHERE LOWER(username) = ?1").bind(username).first();
    if (existing) {
      return new Response(
        JSON.stringify({ status: "error", message: `Username '${username}' sudah digunakan. Silakan pilih username lain.` }),
        { status: 409, headers: corsHeaders }
      );
    }

    const id = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    // Coba simpan dengan role baru
    try {
      await env.DB.prepare(`
        INSERT INTO users (id, username, password, nama, role, instansi, status_aktif, masa_aktif, lisensi)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      `).bind(id, username, password, nama, role, instansi, statusAktif, masaAktif, jenisAkun).run();
    } catch (dbErr) {
      // Jika remote D1 memiliki CHECK constraint lama ('admin', 'petugas'), fallback dengan role yang sesuai
      if (dbErr.message && dbErr.message.includes("CHECK constraint failed")) {
        const fallbackRole = role === "super_admin" ? "admin" : "petugas";
        const taggedLisensi = `${role.toUpperCase()}_${jenisAkun}`;
        await env.DB.prepare(`
          INSERT INTO users (id, username, password, nama, role, instansi, status_aktif, masa_aktif, lisensi)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        `).bind(id, username, password, nama, fallbackRole, instansi, statusAktif, masaAktif, taggedLisensi).run();
      } else {
        throw dbErr;
      }
    }

    return new Response(
      JSON.stringify({ status: "success", message: "Akun pengguna berhasil ditambahkan!" }),
      { status: 201, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "Gagal membuat akun: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function onRequestPatch({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const body = await request.json();
    const id = body.id;
    if (!id) {
      return new Response(
        JSON.stringify({ status: "error", message: "ID User wajib disertakan!" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!env || !env.DB) {
      return new Response(
        JSON.stringify({ status: "success", message: "User berhasil diperbarui (Mode Mock)" }),
        { status: 200, headers: corsHeaders }
      );
    }

    const existing = await env.DB.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first();
    if (!existing) {
      return new Response(
        JSON.stringify({ status: "error", message: "Akun user tidak ditemukan!" }),
        { status: 404, headers: corsHeaders }
      );
    }

    let role = body.role !== undefined ? body.role.trim().toLowerCase() : existing.role;
    let instansi = body.instansi !== undefined ? body.instansi.trim() : existing.instansi;
    let nama = body.nama !== undefined ? body.nama.trim() : existing.nama;
    let password = body.password ? body.password.trim() : existing.password;
    let jenisAkun = body.jenis_akun || body.lisensi || existing.lisensi;
    let masaAktif = body.masa_aktif !== undefined ? body.masa_aktif : existing.masa_aktif;
    let statusAktif = body.status_aktif !== undefined ? body.status_aktif : existing.status_aktif;

    if (role === "super_admin" || role === "admin") {
      role = "super_admin";
      jenisAkun = "Lifetime";
      masaAktif = null;
    }

    try {
      await env.DB.prepare(`
        UPDATE users SET
          nama = ?1,
          password = ?2,
          instansi = ?3,
          role = ?4,
          lisensi = ?5,
          status_aktif = ?6,
          masa_aktif = ?7,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?8
      `).bind(nama, password, instansi, role, jenisAkun, statusAktif, masaAktif, id).run();
    } catch (dbErr) {
      if (dbErr.message && dbErr.message.includes("CHECK constraint failed")) {
        const fallbackRole = (role === "super_admin" || role === "admin") ? "admin" : "petugas";
        const taggedLisensi = `${role.toUpperCase()}_${jenisAkun}`;
        await env.DB.prepare(`
          UPDATE users SET
            nama = ?1,
            password = ?2,
            instansi = ?3,
            role = ?4,
            lisensi = ?5,
            status_aktif = ?6,
            masa_aktif = ?7,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?8
        `).bind(nama, password, instansi, fallbackRole, taggedLisensi, statusAktif, masaAktif, id).run();
      } else {
        throw dbErr;
      }
    }

    return new Response(
      JSON.stringify({ status: "success", message: "Data akun berhasil diperbarui!" }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "Gagal update akun: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
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
      return new Response(
        JSON.stringify({ status: "error", message: "ID User wajib disertakan!" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!env || !env.DB) {
      return new Response(
        JSON.stringify({ status: "success", message: "User berhasil dihapus (Mode Mock)" }),
        { status: 200, headers: corsHeaders }
      );
    }

    // Lindungi akun Super Administrator utama
    if (id === "usr_admin_master" || id === "admin") {
      return new Response(
        JSON.stringify({ status: "error", message: "Akun Super Administrator Utama tidak dapat dihapus!" }),
        { status: 403, headers: corsHeaders }
      );
    }

    await env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(id).run();

    return new Response(
      JSON.stringify({ status: "success", message: "Akun petugas berhasil dihapus!" }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "Gagal menghapus akun: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}
