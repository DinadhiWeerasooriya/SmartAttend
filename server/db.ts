import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import Database from 'better-sqlite3';
import { getPgPool } from './pg.ts';

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return getPgPool().query<T>(text, params);
}

export async function queryOne<T extends QueryResultRow = any>(
  text: string,
  params?: unknown[]
): Promise<T | undefined> {
  const res = await getPgPool().query<T>(text, params);
  return res.rows[0];
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPgPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function initDatabase(): Promise<void> {
  const pool = getPgPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'lecturer', 'student')),
      created_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      registration_number TEXT NOT NULL UNIQUE,
      department TEXT NOT NULL,
      year_of_study INTEGER NOT NULL DEFAULT 1,
      device_id TEXT UNIQUE,
      device_bound_at TEXT
    );

    CREATE TABLE IF NOT EXISTS lecturers (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      staff_id TEXT NOT NULL UNIQUE,
      department TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classrooms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      building TEXT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      permitted_radius_meters INTEGER NOT NULL DEFAULT 60
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE SET NULL,
      default_classroom_id INTEGER REFERENCES classrooms(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      enrolled_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      UNIQUE(student_id, subject_id)
    );

    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id SERIAL PRIMARY KEY,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      lecturer_id INTEGER NOT NULL REFERENCES lecturers(id) ON DELETE CASCADE,
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('active', 'ended')) DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS qr_tokens (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      is_revoked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      marked_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      accuracy_meters DOUBLE PRECISION NOT NULL,
      distance_meters DOUBLE PRECISION NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'Verified',
      UNIQUE(session_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('accepted', 'rejected', 'info')) DEFAULT 'info',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS verification_logs (
      id SERIAL PRIMARY KEY,
      session_id INTEGER REFERENCES attendance_sessions(id) ON DELETE SET NULL,
      student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
      attempted_reg_number TEXT,
      qr_token_prefix TEXT,
      device_id TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      accuracy_meters DOUBLE PRECISION,
      distance_meters DOUBLE PRECISION,
      outcome TEXT NOT NULL CHECK(outcome IN ('accepted', 'rejected')),
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_records_subject ON attendance_records(subject_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_records_student ON attendance_records(student_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_records_session ON attendance_records(session_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_records_marked_at ON attendance_records(marked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_qr_tokens_session ON qr_tokens(session_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_verification_logs_session ON verification_logs(session_id, created_at DESC);
  `);

  const countRes = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
  if (Number(countRes.rows[0]?.count || 0) > 0) {
    return;
  }

  const migrated = await migrateFromSqliteIfPresent();
  if (!migrated) {
    await seedInitialData();
  }
}

async function migrateFromSqliteIfPresent(): Promise<boolean> {
  const sqlitePath = path.resolve(process.cwd(), 'smartattend.db');
  if (!fs.existsSync(sqlitePath)) {
    return false;
  }

  let sqlite: Database.Database | null = null;
  try {
    sqlite = new Database(sqlitePath, { readonly: true });
    const uCount = sqlite.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
    if (!uCount || uCount.c === 0) {
      return false;
    }

    const users = sqlite.prepare('SELECT * FROM users ORDER BY id ASC').all() as any[];
    const students = sqlite.prepare('SELECT * FROM students ORDER BY id ASC').all() as any[];
    const lecturers = sqlite.prepare('SELECT * FROM lecturers ORDER BY id ASC').all() as any[];
    const classrooms = sqlite.prepare('SELECT * FROM classrooms ORDER BY id ASC').all() as any[];
    const subjects = sqlite.prepare('SELECT * FROM subjects ORDER BY id ASC').all() as any[];
    const enrollments = sqlite.prepare('SELECT * FROM enrollments ORDER BY id ASC').all() as any[];
    const sessions = sqlite.prepare('SELECT * FROM attendance_sessions ORDER BY id ASC').all() as any[];
    const qrTokens = sqlite.prepare('SELECT * FROM qr_tokens ORDER BY id ASC').all() as any[];
    const records = sqlite.prepare('SELECT * FROM attendance_records ORDER BY id ASC').all() as any[];
    const notifications = sqlite.prepare('SELECT * FROM notifications ORDER BY id ASC').all() as any[];
    const logs = sqlite.prepare('SELECT * FROM verification_logs ORDER BY id ASC').all() as any[];

    await withTransaction(async (client) => {
      for (const r of users) {
        await client.query(
          `INSERT INTO users (id, name, email, password_hash, role, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [r.id, r.name, r.email, r.password_hash, r.role, r.created_at]
        );
      }
      for (const r of students) {
        await client.query(
          `INSERT INTO students (id, user_id, registration_number, department, year_of_study, device_id, device_bound_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [r.id, r.user_id, r.registration_number, r.department, r.year_of_study, r.device_id, r.device_bound_at]
        );
      }
      for (const r of lecturers) {
        await client.query(
          `INSERT INTO lecturers (id, user_id, staff_id, department)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [r.id, r.user_id, r.staff_id, r.department]
        );
      }
      for (const r of classrooms) {
        await client.query(
          `INSERT INTO classrooms (id, name, building, latitude, longitude, permitted_radius_meters)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [r.id, r.name, r.building, r.latitude, r.longitude, r.permitted_radius_meters]
        );
      }
      for (const r of subjects) {
        await client.query(
          `INSERT INTO subjects (id, code, name, department, lecturer_id, default_classroom_id)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [r.id, r.code, r.name, r.department, r.lecturer_id, r.default_classroom_id]
        );
      }
      for (const r of enrollments) {
        await client.query(
          `INSERT INTO enrollments (id, student_id, subject_id, enrolled_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [r.id, r.student_id, r.subject_id, r.enrolled_at]
        );
      }
      for (const r of sessions) {
        await client.query(
          `INSERT INTO attendance_sessions (id, subject_id, lecturer_id, classroom_id, status, started_at, ended_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [r.id, r.subject_id, r.lecturer_id, r.classroom_id, r.status, r.started_at, r.ended_at]
        );
      }
      for (const r of qrTokens) {
        await client.query(
          `INSERT INTO qr_tokens (id, session_id, token, created_at, expires_at, is_revoked)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [r.id, r.session_id, r.token, r.created_at, r.expires_at, r.is_revoked]
        );
      }
      for (const r of records) {
        await client.query(
          `INSERT INTO attendance_records (id, session_id, student_id, subject_id, marked_at, latitude, longitude, accuracy_meters, distance_meters, verification_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
          [
            r.id,
            r.session_id,
            r.student_id,
            r.subject_id,
            r.marked_at,
            r.latitude,
            r.longitude,
            r.accuracy_meters,
            r.distance_meters,
            r.verification_status,
          ]
        );
      }
      for (const r of notifications) {
        await client.query(
          `INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [r.id, r.user_id, r.title, r.message, r.type, r.is_read, r.created_at]
        );
      }
      for (const r of logs) {
        await client.query(
          `INSERT INTO verification_logs (id, session_id, student_id, attempted_reg_number, qr_token_prefix, device_id, latitude, longitude, accuracy_meters, distance_meters, outcome, reason, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT DO NOTHING`,
          [
            r.id,
            r.session_id,
            r.student_id,
            r.attempted_reg_number,
            r.qr_token_prefix,
            r.device_id,
            r.latitude,
            r.longitude,
            r.accuracy_meters,
            r.distance_meters,
            r.outcome,
            r.reason,
            r.created_at,
          ]
        );
      }

      const tables = [
        'users',
        'students',
        'lecturers',
        'classrooms',
        'subjects',
        'enrollments',
        'attendance_sessions',
        'qr_tokens',
        'attendance_records',
        'notifications',
        'verification_logs',
      ];
      for (const tbl of tables) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${tbl}), 1), (SELECT COUNT(*) > 0 FROM ${tbl}))`,
          [tbl]
        );
      }
    });

    console.log('Migrated existing SQLite data into Supabase PostgreSQL.');
    return true;
  } catch (err: any) {
    console.error('SQLite-to-PostgreSQL data migration skipped:', err?.message);
    return false;
  } finally {
    sqlite?.close();
  }
}

async function seedInitialData(): Promise<void> {
  const adminPass = bcrypt.hashSync('Admin@123', 10);
  const lecturerPass = bcrypt.hashSync('Lecturer@123', 10);
  const studentPass = bcrypt.hashSync('Student@123', 10);

  await withTransaction(async (client) => {
    const check = await client.query<{ c: string }>('SELECT COUNT(*)::text AS c FROM users');
    if (Number(check.rows[0]?.c || 0) > 0) return;

    await client.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin') ON CONFLICT DO NOTHING`,
      ['Dr. Eleanor Vance', 'admin@smartattend.edu', adminPass]
    );

    const lec1U = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'lecturer') RETURNING id`,
      ['Prof. Alan Sterling', 'alan.sterling@smartattend.edu', lecturerPass]
    );
    const lec1 = await client.query<{ id: number }>(
      `INSERT INTO lecturers (user_id, staff_id, department) VALUES ($1, $2, $3) RETURNING id`,
      [lec1U.rows[0].id, 'LEC-101', 'Foundation Computing']
    );

    const lec2U = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'lecturer') RETURNING id`,
      ['Dr. Grace Lin', 'grace.lin@smartattend.edu', lecturerPass]
    );
    const lec2 = await client.query<{ id: number }>(
      `INSERT INTO lecturers (user_id, staff_id, department) VALUES ($1, $2, $3) RETURNING id`,
      [lec2U.rows[0].id, 'LEC-102', 'Information Systems']
    );

    const sampleStudents = [
      { name: 'Maya Patel', email: 'maya.patel@student.smartattend.edu', reg: 'REG-2026-001', dept: 'Foundation Computing', year: 1 },
      { name: "Liam O'Connor", email: 'liam.oconnor@student.smartattend.edu', reg: 'REG-2026-002', dept: 'Foundation Computing', year: 1 },
      { name: 'Zara Chen', email: 'zara.chen@student.smartattend.edu', reg: 'REG-2026-003', dept: 'Computer Science', year: 1 },
      { name: 'Noah Al-Mansoor', email: 'noah.almansoor@student.smartattend.edu', reg: 'REG-2026-004', dept: 'Information Systems', year: 1 },
      { name: 'Chloe Bennett', email: 'chloe.bennett@student.smartattend.edu', reg: 'REG-2026-005', dept: 'Foundation Computing', year: 1 },
    ];

    const studentIds: { id: number; userId: number; reg: string }[] = [];
    for (const s of sampleStudents) {
      const u = await client.query<{ id: number }>(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'student') RETURNING id`,
        [s.name, s.email, studentPass]
      );
      const st = await client.query<{ id: number }>(
        `INSERT INTO students (user_id, registration_number, department, year_of_study) VALUES ($1, $2, $3, $4) RETURNING id`,
        [u.rows[0].id, s.reg, s.dept, s.year]
      );
      studentIds.push({ id: st.rows[0].id, userId: u.rows[0].id, reg: s.reg });
    }

    const room1 = await client.query<{ id: number }>(
      `INSERT INTO classrooms (name, building, latitude, longitude, permitted_radius_meters) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['Lecture Theatre A', 'Turing Building', 51.5074, -0.1278, 80]
    );
    const room2 = await client.query<{ id: number }>(
      `INSERT INTO classrooms (name, building, latitude, longitude, permitted_radius_meters) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['Computing Lab 204', 'Innovation Hall', 51.5081, -0.1265, 50]
    );
    const room3 = await client.query<{ id: number }>(
      `INSERT INTO classrooms (name, building, latitude, longitude, permitted_radius_meters) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['Seminar Room 102', 'North Wing', 51.5068, -0.129, 60]
    );

    const sub1 = await client.query<{ id: number }>(
      `INSERT INTO subjects (code, name, department, lecturer_id, default_classroom_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['FC101', 'Foundations of Computing', 'Foundation Computing', lec1.rows[0].id, room1.rows[0].id]
    );
    const sub2 = await client.query<{ id: number }>(
      `INSERT INTO subjects (code, name, department, lecturer_id, default_classroom_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['FC104', 'Algorithms & Problem Solving', 'Foundation Computing', lec1.rows[0].id, room2.rows[0].id]
    );
    const sub3 = await client.query<{ id: number }>(
      `INSERT INTO subjects (code, name, department, lecturer_id, default_classroom_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['IS102', 'Database Systems & Design', 'Information Systems', lec2.rows[0].id, room3.rows[0].id]
    );

    for (const s of studentIds) {
      await client.query(`INSERT INTO enrollments (student_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [s.id, sub1.rows[0].id]);
    }
    for (const idx of [0, 1, 2]) {
      await client.query(`INSERT INTO enrollments (student_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [studentIds[idx].id, sub2.rows[0].id]);
    }
    for (const idx of [0, 3, 4]) {
      await client.query(`INSERT INTO enrollments (student_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [studentIds[idx].id, sub3.rows[0].id]);
    }

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const ses1 = await client.query<{ id: number }>(
      `INSERT INTO attendance_sessions (subject_id, lecturer_id, classroom_id, status, started_at, ended_at)
       VALUES ($1, $2, $3, 'ended', $4, $5) RETURNING id`,
      [sub1.rows[0].id, lec1.rows[0].id, room1.rows[0].id, twoDaysAgo.toISOString(), new Date(twoDaysAgo.getTime() + 50 * 60 * 1000).toISOString()]
    );
    const ses2 = await client.query<{ id: number }>(
      `INSERT INTO attendance_sessions (subject_id, lecturer_id, classroom_id, status, started_at, ended_at)
       VALUES ($1, $2, $3, 'ended', $4, $5) RETURNING id`,
      [sub2.rows[0].id, lec1.rows[0].id, room2.rows[0].id, yesterday.toISOString(), new Date(yesterday.getTime() + 45 * 60 * 1000).toISOString()]
    );
    const ses3 = await client.query<{ id: number }>(
      `INSERT INTO attendance_sessions (subject_id, lecturer_id, classroom_id, status, started_at, ended_at)
       VALUES ($1, $2, $3, 'ended', $4, $5) RETURNING id`,
      [sub3.rows[0].id, lec2.rows[0].id, room3.rows[0].id, yesterday.toISOString(), new Date(yesterday.getTime() + 55 * 60 * 1000).toISOString()]
    );

    for (let i = 0; i < 4; i++) {
      const marked = new Date(twoDaysAgo.getTime() + (i + 1) * 90 * 1000).toISOString();
      await client.query(
        `INSERT INTO attendance_records (session_id, student_id, subject_id, marked_at, latitude, longitude, accuracy_meters, distance_meters, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Verified') ON CONFLICT DO NOTHING`,
        [ses1.rows[0].id, studentIds[i].id, sub1.rows[0].id, marked, 51.50741, -0.12779, 12.5, 4.2 + i * 3]
      );
    }
    for (let i = 0; i < 2; i++) {
      const marked = new Date(yesterday.getTime() + (i + 1) * 110 * 1000).toISOString();
      await client.query(
        `INSERT INTO attendance_records (session_id, student_id, subject_id, marked_at, latitude, longitude, accuracy_meters, distance_meters, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Verified') ON CONFLICT DO NOTHING`,
        [ses2.rows[0].id, studentIds[i].id, sub2.rows[0].id, marked, 51.50812, -0.12652, 10.0, 6.1 + i * 4]
      );
    }
    await client.query(
      `INSERT INTO attendance_records (session_id, student_id, subject_id, marked_at, latitude, longitude, accuracy_meters, distance_meters, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Verified') ON CONFLICT DO NOTHING`,
      [ses3.rows[0].id, studentIds[0].id, sub3.rows[0].id, new Date(yesterday.getTime() + 120 * 1000).toISOString(), 51.50681, -0.12902, 14.0, 5.4]
    );
    await client.query(
      `INSERT INTO attendance_records (session_id, student_id, subject_id, marked_at, latitude, longitude, accuracy_meters, distance_meters, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Verified') ON CONFLICT DO NOTHING`,
      [ses3.rows[0].id, studentIds[3].id, sub3.rows[0].id, new Date(yesterday.getTime() + 180 * 1000).toISOString(), 51.50684, -0.12905, 16.0, 8.9]
    );
  });
}
