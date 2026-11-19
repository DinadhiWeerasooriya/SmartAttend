import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, queryOne, withTransaction } from './db.ts';
import {
  type AuthedRequest,
  requireAuth,
  requireRole,
  signToken,
  generateQrTokenValue,
  formatQrPayload,
  parseQrPayload,
  calculateDistanceMeters,
  csvEscape,
} from './utils.ts';
import { realtimeHub } from './realtime.ts';

export const apiRouter = Router();

const MAX_ACCEPTABLE_ACCURACY_METERS = 250;
const QR_TTL_SECONDS = 30;

function isUniqueViolation(err: any): boolean {
  return err?.code === '23505' || String(err?.message || '').includes('duplicate key');
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

apiRouter.post('/auth/login', async (req, res) => {
  try {
    const { identifier, password, deviceId } = req.body ?? {};
    const trimmedId = String(identifier || '').trim();
    const rawPass = String(password || '');

    if (!trimmedId || !rawPass) {
      res.status(400).json({ error: 'Please enter your ID/email and password.' });
      return;
    }

    let user = await queryOne<{
      id: number;
      name: string;
      email: string | null;
      password_hash: string;
      role: 'admin' | 'lecturer' | 'student';
    }>(`SELECT id, name, email, password_hash, role FROM users WHERE LOWER(email) = LOWER($1)`, [trimmedId]);

    if (!user) {
      user = await queryOne(
        `SELECT u.id, u.name, u.email, u.password_hash, u.role
         FROM students s
         JOIN users u ON u.id = s.user_id
         WHERE LOWER(s.registration_number) = LOWER($1)`,
        [trimmedId]
      );
    }

    if (!user) {
      user = await queryOne(
        `SELECT u.id, u.name, u.email, u.password_hash, u.role
         FROM lecturers l
         JOIN users u ON u.id = l.user_id
         WHERE LOWER(l.staff_id) = LOWER($1)`,
        [trimmedId]
      );
    }

    if (!user || !bcrypt.compareSync(rawPass, user.password_hash)) {
      res.status(401).json({ error: 'Invalid credentials. Please check your login ID and password.' });
      return;
    }

    let deviceStatus: { bound: boolean; matchesCurrentDevice: boolean; boundToAnotherStudent: boolean } | undefined;
    if (user.role === 'student') {
      const student = await queryOne<{
        id: number;
        registration_number: string;
        department: string;
        year_of_study: number;
        device_id: string | null;
        device_bound_at: string | null;
      }>(`SELECT id, registration_number, department, year_of_study, device_id, device_bound_at FROM students WHERE user_id = $1`, [
        user.id,
      ]);

      if (student && deviceId) {
        const cleanDeviceId = String(deviceId).trim();
        const deviceOwner = await queryOne<{ id: number }>(
          `SELECT id FROM students WHERE device_id = $1 AND id != $2`,
          [cleanDeviceId, student.id]
        );

        if (!student.device_id && !deviceOwner) {
          await query(`UPDATE students SET device_id = $1, device_bound_at = $2 WHERE id = $3`, [
            cleanDeviceId,
            new Date().toISOString(),
            student.id,
          ]);
          deviceStatus = { bound: true, matchesCurrentDevice: true, boundToAnotherStudent: false };
        } else if (student.device_id === cleanDeviceId) {
          deviceStatus = { bound: true, matchesCurrentDevice: true, boundToAnotherStudent: false };
        } else {
          deviceStatus = {
            bound: Boolean(student.device_id),
            matchesCurrentDevice: false,
            boundToAnotherStudent: Boolean(deviceOwner),
          };
        }
      }
    }

    const token = signToken({ userId: user.id, role: user.role, name: user.name });
    const profile = await getUserProfile(user.id, user.role);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        profile,
        deviceStatus,
      },
    });
  } catch (err: any) {
    console.error('Login error:', err?.message);
    res.status(500).json({ error: 'Authentication failed due to a server error.' });
  }
});

apiRouter.get('/auth/me', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = await queryOne<{
      id: number;
      name: string;
      email: string | null;
      role: 'admin' | 'lecturer' | 'student';
    }>(`SELECT id, name, email, role FROM users WHERE id = $1`, [req.user!.userId]);

    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const deviceId = req.headers['x-device-id'] ? String(req.headers['x-device-id']) : undefined;
    const profile = await getUserProfile(user.id, user.role);

    let deviceStatus: { bound: boolean; matchesCurrentDevice: boolean; boundToAnotherStudent: boolean } | undefined;
    if (user.role === 'student' && profile && deviceId) {
      const s = profile as { id: number; device_id: string | null };
      const deviceOwner = await queryOne<{ id: number }>(
        `SELECT id FROM students WHERE device_id = $1 AND id != $2`,
        [deviceId, s.id]
      );
      deviceStatus = {
        bound: Boolean(s.device_id),
        matchesCurrentDevice: s.device_id === deviceId,
        boundToAnotherStudent: Boolean(deviceOwner),
      };
    }

    res.json({
      user: {
        ...user,
        profile,
        deviceStatus,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load profile.' });
  }
});

async function getUserProfile(userId: number, role: string) {
  if (role === 'student') {
    return queryOne(
      `SELECT id, registration_number, department, year_of_study, device_id, device_bound_at FROM students WHERE user_id = $1`,
      [userId]
    );
  }
  if (role === 'lecturer') {
    return queryOne(`SELECT id, staff_id, department FROM lecturers WHERE user_id = $1`, [userId]);
  }
  return null;
}

// ============================================================================
// NOTIFICATIONS (ALL AUTHENTICATED ROLES)
// ============================================================================

apiRouter.get('/notifications', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const rowsRes = await query(
      `SELECT id, title, message, type, is_read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`,
      [req.user!.userId]
    );
    const unread = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = 0`,
      [req.user!.userId]
    );
    res.json({ notifications: rowsRes.rows, unreadCount: unread?.count ?? 0 });
  } catch {
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

apiRouter.patch('/notifications/:id/read', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await query(`UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2`, [
      Number(req.params.id),
      req.user!.userId,
    ]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to update notification.' });
  }
});

apiRouter.patch('/notifications/read-all', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await query(`UPDATE notifications SET is_read = 1 WHERE user_id = $1`, [req.user!.userId]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to update notifications.' });
  }
});

// ============================================================================
// ADMIN ROUTES
// ============================================================================

apiRouter.get('/admin/dashboard', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const [
      totalStudents,
      totalLecturers,
      totalSubjects,
      totalSessions,
      activeSessions,
      totalAttendanceRecords,
      subjectStats,
      recentActivity,
      recentRejections,
    ] = await Promise.all([
      queryOne<{ c: number }>(`SELECT COUNT(*)::int AS c FROM students`),
      queryOne<{ c: number }>(`SELECT COUNT(*)::int AS c FROM lecturers`),
      queryOne<{ c: number }>(`SELECT COUNT(*)::int AS c FROM subjects`),
      queryOne<{ c: number }>(`SELECT COUNT(*)::int AS c FROM attendance_sessions`),
      queryOne<{ c: number }>(`SELECT COUNT(*)::int AS c FROM attendance_sessions WHERE status = 'active'`),
      queryOne<{ c: number }>(`SELECT COUNT(*)::int AS c FROM attendance_records`),
      query(
        `SELECT sub.id, sub.code, sub.name,
                COUNT(DISTINCT ses.id)::int AS session_count,
                COUNT(ar.id)::int AS attendance_count
         FROM subjects sub
         LEFT JOIN attendance_sessions ses ON ses.subject_id = sub.id
         LEFT JOIN attendance_records ar ON ar.subject_id = sub.id
         GROUP BY sub.id
         ORDER BY sub.code ASC`
      ),
      query(
        `SELECT ar.id, ar.marked_at AS timestamp, ar.verification_status, ar.distance_meters,
                u.name AS student_name, s.registration_number,
                sub.code AS subject_code, sub.name AS subject_name,
                c.name AS classroom_name
         FROM attendance_records ar
         JOIN students s ON s.id = ar.student_id
         JOIN users u ON u.id = s.user_id
         JOIN subjects sub ON sub.id = ar.subject_id
         JOIN attendance_sessions ses ON ses.id = ar.session_id
         JOIN classrooms c ON c.id = ses.classroom_id
         ORDER BY ar.marked_at DESC
         LIMIT 12`
      ),
      query(
        `SELECT vl.id, vl.created_at, vl.attempted_reg_number, vl.reason, vl.distance_meters,
                u.name AS student_name, sub.code AS subject_code, sub.name AS subject_name
         FROM verification_logs vl
         LEFT JOIN students s ON s.id = vl.student_id
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN attendance_sessions ses ON ses.id = vl.session_id
         LEFT JOIN subjects sub ON sub.id = ses.subject_id
         WHERE vl.outcome = 'rejected'
         ORDER BY vl.created_at DESC
         LIMIT 8`
      ),
    ]);

    res.json({
      metrics: {
        totalStudents: totalStudents?.c ?? 0,
        totalLecturers: totalLecturers?.c ?? 0,
        totalSubjects: totalSubjects?.c ?? 0,
        totalSessions: totalSessions?.c ?? 0,
        activeSessions: activeSessions?.c ?? 0,
        totalAttendanceRecords: totalAttendanceRecords?.c ?? 0,
      },
      subjectStats: subjectStats.rows,
      recentActivity: recentActivity.rows,
      recentRejections: recentRejections.rows,
    });
  } catch (err: any) {
    console.error('Admin dashboard error:', err?.message);
    res.status(500).json({ error: 'Failed to load admin dashboard.' });
  }
});

// Admin: Students CRUD
apiRouter.get('/admin/students', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const [rowsRes, enrollmentsRes] = await Promise.all([
      query(
        `SELECT s.id, s.user_id, u.name, u.email, s.registration_number, s.department, s.year_of_study,
                s.device_id, s.device_bound_at,
                (SELECT COUNT(*)::int FROM enrollments e WHERE e.student_id = s.id) AS enrolled_subjects_count,
                (SELECT COUNT(*)::int FROM attendance_records ar WHERE ar.student_id = s.id) AS sessions_attended
         FROM students s
         JOIN users u ON u.id = s.user_id
         ORDER BY s.registration_number ASC`
      ),
      query<{ student_id: number; subject_id: number }>(`SELECT student_id, subject_id FROM enrollments`),
    ]);

    const enriched = rowsRes.rows.map((row: any) => ({
      ...row,
      subject_ids: enrollmentsRes.rows.filter((e) => e.student_id === row.id).map((e) => e.subject_id),
    }));

    res.json({ students: enriched });
  } catch {
    res.status(500).json({ error: 'Failed to load students.' });
  }
});

apiRouter.post('/admin/students', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, registration_number, department, year_of_study, password, subject_ids } = req.body ?? {};
  if (!name || !registration_number || !department || !password) {
    res.status(400).json({ error: 'Name, registration number, department, and password are required.' });
    return;
  }

  try {
    const hash = bcrypt.hashSync(String(password), 10);
    const createdId = await withTransaction(async (client) => {
      const u = await client.query<{ id: number }>(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'student') RETURNING id`,
        [String(name).trim(), email ? String(email).trim() : null, hash]
      );
      const s = await client.query<{ id: number }>(
        `INSERT INTO students (user_id, registration_number, department, year_of_study) VALUES ($1, $2, $3, $4) RETURNING id`,
        [u.rows[0].id, String(registration_number).trim().toUpperCase(), String(department).trim(), Number(year_of_study) || 1]
      );
      if (Array.isArray(subject_ids)) {
        for (const subId of subject_ids) {
          await client.query(
            `INSERT INTO enrollments (student_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [s.rows[0].id, Number(subId)]
          );
        }
      }
      return s.rows[0].id;
    });

    res.status(201).json({ id: createdId });
  } catch (err: any) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Registration number or email already exists.' });
      return;
    }
    res.status(500).json({ error: 'Failed to create student.' });
  }
});

apiRouter.put('/admin/students/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const studentId = Number(req.params.id);
  const { name, email, registration_number, department, year_of_study, password, subject_ids } = req.body ?? {};
  const existing = await queryOne<{ id: number; user_id: number }>(`SELECT id, user_id FROM students WHERE id = $1`, [
    studentId,
  ]);
  if (!existing) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }

  try {
    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET name = $1, email = $2 WHERE id = $3`, [
        String(name).trim(),
        email ? String(email).trim() : null,
        existing.user_id,
      ]);
      if (password && String(password).trim().length > 0) {
        await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
          bcrypt.hashSync(String(password), 10),
          existing.user_id,
        ]);
      }
      await client.query(
        `UPDATE students SET registration_number = $1, department = $2, year_of_study = $3 WHERE id = $4`,
        [String(registration_number).trim().toUpperCase(), String(department).trim(), Number(year_of_study) || 1, studentId]
      );
      if (Array.isArray(subject_ids)) {
        await client.query(`DELETE FROM enrollments WHERE student_id = $1`, [studentId]);
        for (const subId of subject_ids) {
          await client.query(
            `INSERT INTO enrollments (student_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [studentId, Number(subId)]
          );
        }
      }
    });
    res.json({ ok: true });
  } catch (err: any) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Registration number or email already exists.' });
      return;
    }
    res.status(500).json({ error: 'Failed to update student.' });
  }
});

apiRouter.delete('/admin/students/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const studentId = Number(req.params.id);
  const existing = await queryOne<{ user_id: number }>(`SELECT user_id FROM students WHERE id = $1`, [studentId]);
  if (!existing) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }
  await query(`DELETE FROM users WHERE id = $1`, [existing.user_id]);
  res.json({ ok: true });
});

// Admin: Lecturers CRUD
apiRouter.get('/admin/lecturers', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const lecturersRes = await query(
      `SELECT l.id, l.user_id, u.name, u.email, l.staff_id, l.department,
              (SELECT COUNT(*)::int FROM subjects sub WHERE sub.lecturer_id = l.id) AS assigned_subjects_count
       FROM lecturers l
       JOIN users u ON u.id = l.user_id
       ORDER BY l.staff_id ASC`
    );
    res.json({ lecturers: lecturersRes.rows });
  } catch {
    res.status(500).json({ error: 'Failed to load lecturers.' });
  }
});

apiRouter.post('/admin/lecturers', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, staff_id, department, password } = req.body ?? {};
  if (!name || !email || !staff_id || !department || !password) {
    res.status(400).json({ error: 'Name, email, staff ID, department, and password are required.' });
    return;
  }

  try {
    const hash = bcrypt.hashSync(String(password), 10);
    const id = await withTransaction(async (client) => {
      const u = await client.query<{ id: number }>(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'lecturer') RETURNING id`,
        [String(name).trim(), String(email).trim(), hash]
      );
      const l = await client.query<{ id: number }>(
        `INSERT INTO lecturers (user_id, staff_id, department) VALUES ($1, $2, $3) RETURNING id`,
        [u.rows[0].id, String(staff_id).trim().toUpperCase(), String(department).trim()]
      );
      return l.rows[0].id;
    });
    res.status(201).json({ id });
  } catch (err: any) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Staff ID or email already exists.' });
      return;
    }
    res.status(500).json({ error: 'Failed to create lecturer.' });
  }
});

apiRouter.put('/admin/lecturers/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const lecturerId = Number(req.params.id);
  const { name, email, staff_id, department, password } = req.body ?? {};
  const existing = await queryOne<{ user_id: number }>(`SELECT user_id FROM lecturers WHERE id = $1`, [lecturerId]);
  if (!existing) {
    res.status(404).json({ error: 'Lecturer not found.' });
    return;
  }

  try {
    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET name = $1, email = $2 WHERE id = $3`, [
        String(name).trim(),
        String(email).trim(),
        existing.user_id,
      ]);
      if (password && String(password).trim().length > 0) {
        await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
          bcrypt.hashSync(String(password), 10),
          existing.user_id,
        ]);
      }
      await client.query(`UPDATE lecturers SET staff_id = $1, department = $2 WHERE id = $3`, [
        String(staff_id).trim().toUpperCase(),
        String(department).trim(),
        lecturerId,
      ]);
    });
    res.json({ ok: true });
  } catch (err: any) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Staff ID or email already exists.' });
      return;
    }
    res.status(500).json({ error: 'Failed to update lecturer.' });
  }
});

apiRouter.delete('/admin/lecturers/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const lecturerId = Number(req.params.id);
  const existing = await queryOne<{ user_id: number }>(`SELECT user_id FROM lecturers WHERE id = $1`, [lecturerId]);
  if (!existing) {
    res.status(404).json({ error: 'Lecturer not found.' });
    return;
  }
  await query(`DELETE FROM users WHERE id = $1`, [existing.user_id]);
  res.json({ ok: true });
});

// Admin: Classrooms CRUD
apiRouter.get('/admin/classrooms', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const classrooms = await query(`SELECT * FROM classrooms ORDER BY name ASC`);
    res.json({ classrooms: classrooms.rows });
  } catch {
    res.status(500).json({ error: 'Failed to load classrooms.' });
  }
});

apiRouter.post('/admin/classrooms', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, building, latitude, longitude, permitted_radius_meters } = req.body ?? {};
  if (!name || !building || latitude === undefined || longitude === undefined) {
    res.status(400).json({ error: 'Classroom name, building, latitude, and longitude are required.' });
    return;
  }
  try {
    const r = await queryOne<{ id: number }>(
      `INSERT INTO classrooms (name, building, latitude, longitude, permitted_radius_meters) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [String(name).trim(), String(building).trim(), Number(latitude), Number(longitude), Math.max(10, Number(permitted_radius_meters) || 60)]
    );
    res.status(201).json({ id: r?.id });
  } catch (err: any) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Classroom name already exists.' });
      return;
    }
    res.status(500).json({ error: 'Failed to create classroom.' });
  }
});

apiRouter.put('/admin/classrooms/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const { name, building, latitude, longitude, permitted_radius_meters } = req.body ?? {};
  try {
    const info = await query(
      `UPDATE classrooms SET name = $1, building = $2, latitude = $3, longitude = $4, permitted_radius_meters = $5 WHERE id = $6`,
      [String(name).trim(), String(building).trim(), Number(latitude), Number(longitude), Math.max(10, Number(permitted_radius_meters) || 60), id]
    );
    if (info.rowCount === 0) {
      res.status(404).json({ error: 'Classroom not found.' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Classroom name already exists.' });
      return;
    }
    res.status(500).json({ error: 'Failed to update classroom.' });
  }
});

apiRouter.delete('/admin/classrooms/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const info = await query(`DELETE FROM classrooms WHERE id = $1`, [Number(req.params.id)]);
  if (info.rowCount === 0) {
    res.status(404).json({ error: 'Classroom not found.' });
    return;
  }
  res.json({ ok: true });
});

// Admin: Subjects CRUD & Lecturer Assignment
apiRouter.get('/admin/subjects', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const [subjectsRes, enrollmentsRes] = await Promise.all([
      query(
        `SELECT sub.*, u.name AS lecturer_name, l.staff_id AS lecturer_staff_id,
                c.name AS classroom_name, c.building AS classroom_building,
                (SELECT COUNT(*)::int FROM enrollments e WHERE e.subject_id = sub.id) AS enrolled_count
         FROM subjects sub
         LEFT JOIN lecturers l ON l.id = sub.lecturer_id
         LEFT JOIN users u ON u.id = l.user_id
         LEFT JOIN classrooms c ON c.id = sub.default_classroom_id
         ORDER BY sub.code ASC`
      ),
      query<{ student_id: number; subject_id: number }>(`SELECT student_id, subject_id FROM enrollments`),
    ]);

    const enriched = subjectsRes.rows.map((sub: any) => ({
      ...sub,
      student_ids: enrollmentsRes.rows.filter((e) => e.subject_id === sub.id).map((e) => e.student_id),
    }));

    res.json({ subjects: enriched });
  } catch {
    res.status(500).json({ error: 'Failed to load subjects.' });
  }
});

apiRouter.post('/admin/subjects', requireAuth, requireRole('admin'), async (req, res) => {
  const { code, name, department, lecturer_id, default_classroom_id, student_ids } = req.body ?? {};
  if (!code || !name || !department) {
    res.status(400).json({ error: 'Subject code, name, and department are required.' });
    return;
  }
  try {
    const id = await withTransaction(async (client) => {
      const r = await client.query<{ id: number }>(
        `INSERT INTO subjects (code, name, department, lecturer_id, default_classroom_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          String(code).trim().toUpperCase(),
          String(name).trim(),
          String(department).trim(),
          lecturer_id ? Number(lecturer_id) : null,
          default_classroom_id ? Number(default_classroom_id) : null,
        ]
      );
      if (Array.isArray(student_ids)) {
        for (const sid of student_ids) {
          await client.query(
            `INSERT INTO enrollments (student_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [Number(sid), r.rows[0].id]
          );
        }
      }
      return r.rows[0].id;
    });
    res.status(201).json({ id });
  } catch (err: any) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Subject code already exists.' });
      return;
    }
    res.status(500).json({ error: 'Failed to create subject.' });
  }
});

apiRouter.put('/admin/subjects/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const { code, name, department, lecturer_id, default_classroom_id, student_ids } = req.body ?? {};
  try {
    await withTransaction(async (client) => {
      const info = await client.query(
        `UPDATE subjects SET code = $1, name = $2, department = $3, lecturer_id = $4, default_classroom_id = $5 WHERE id = $6`,
        [
          String(code).trim().toUpperCase(),
          String(name).trim(),
          String(department).trim(),
          lecturer_id ? Number(lecturer_id) : null,
          default_classroom_id ? Number(default_classroom_id) : null,
          id,
        ]
      );
      if (info.rowCount === 0) {
        throw new Error('NOT_FOUND');
      }
      if (Array.isArray(student_ids)) {
        await client.query(`DELETE FROM enrollments WHERE subject_id = $1`, [id]);
        for (const sid of student_ids) {
          await client.query(
            `INSERT INTO enrollments (student_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [Number(sid), id]
          );
        }
      }
    });
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') {
      res.status(404).json({ error: 'Subject not found.' });
      return;
    }
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Subject code already exists.' });
      return;
    }
    res.status(500).json({ error: 'Failed to update subject.' });
  }
});

apiRouter.delete('/admin/subjects/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const info = await query(`DELETE FROM subjects WHERE id = $1`, [Number(req.params.id)]);
  if (info.rowCount === 0) {
    res.status(404).json({ error: 'Subject not found.' });
    return;
  }
  res.json({ ok: true });
});

// Admin: Attendance Records & Reports
apiRouter.get('/admin/attendance', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { subjectId, date, search, studentId } = req.query;
    const [records, logsRes, sessionsRes] = await Promise.all([
      queryAttendanceRecords({
        subjectId: subjectId ? Number(subjectId) : undefined,
        date: date ? String(date) : undefined,
        search: search ? String(search) : undefined,
        studentId: studentId ? Number(studentId) : undefined,
      }),
      query(
        `SELECT vl.*, u.name AS student_name, sub.code AS subject_code, sub.name AS subject_name
         FROM verification_logs vl
         LEFT JOIN students s ON s.id = vl.student_id
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN attendance_sessions ses ON ses.id = vl.session_id
         LEFT JOIN subjects sub ON sub.id = ses.subject_id
         ORDER BY vl.created_at DESC
         LIMIT 60`
      ),
      query(
        `SELECT ses.id, ses.status, ses.started_at, ses.ended_at,
                sub.code AS subject_code, sub.name AS subject_name,
                u.name AS lecturer_name, c.name AS classroom_name,
                (SELECT COUNT(*)::int FROM attendance_records ar WHERE ar.session_id = ses.id) AS attendee_count
         FROM attendance_sessions ses
         JOIN subjects sub ON sub.id = ses.subject_id
         JOIN lecturers l ON l.id = ses.lecturer_id
         JOIN users u ON u.id = l.user_id
         JOIN classrooms c ON c.id = ses.classroom_id
         ORDER BY ses.started_at DESC
         LIMIT 50`
      ),
    ]);

    res.json({ records, logs: logsRes.rows, sessions: sessionsRes.rows });
  } catch {
    res.status(500).json({ error: 'Failed to load attendance reports.' });
  }
});

apiRouter.get('/admin/reports/csv', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { subjectId, date, search, studentId } = req.query;
    const records = await queryAttendanceRecords({
      subjectId: subjectId ? Number(subjectId) : undefined,
      date: date ? String(date) : undefined,
      search: search ? String(search) : undefined,
      studentId: studentId ? Number(studentId) : undefined,
    });
    sendCsvReport(res, records, 'smartattend-admin-attendance-report.csv');
  } catch {
    res.status(500).json({ error: 'Failed to export CSV report.' });
  }
});

// ============================================================================
// LECTURER ROUTES
// ============================================================================

async function getLecturerByUserId(userId: number) {
  return queryOne<{ id: number; staff_id: string; department: string }>(
    `SELECT id, staff_id, department FROM lecturers WHERE user_id = $1`,
    [userId]
  );
}

apiRouter.get('/lecturer/dashboard', requireAuth, requireRole('lecturer'), async (req: AuthedRequest, res) => {
  try {
    const lecturer = await getLecturerByUserId(req.user!.userId);
    if (!lecturer) {
      res.status(404).json({ error: 'Lecturer profile not found.' });
      return;
    }

    const [assignedSubjects, activeSessions, recentActivity, classrooms] = await Promise.all([
      query(
        `SELECT sub.*, c.name AS classroom_name, c.building AS classroom_building, c.permitted_radius_meters,
                (SELECT COUNT(*)::int FROM enrollments e WHERE e.subject_id = sub.id) AS enrolled_count,
                (SELECT COUNT(*)::int FROM attendance_sessions ses WHERE ses.subject_id = sub.id) AS total_sessions
         FROM subjects sub
         LEFT JOIN classrooms c ON c.id = sub.default_classroom_id
         WHERE sub.lecturer_id = $1
         ORDER BY sub.code ASC`,
        [lecturer.id]
      ),
      query(
        `SELECT ses.*, sub.code AS subject_code, sub.name AS subject_name,
                c.name AS classroom_name, c.building AS classroom_building, c.permitted_radius_meters,
                (SELECT COUNT(*)::int FROM attendance_records ar WHERE ar.session_id = ses.id) AS attendee_count
         FROM attendance_sessions ses
         JOIN subjects sub ON sub.id = ses.subject_id
         JOIN classrooms c ON c.id = ses.classroom_id
         WHERE ses.lecturer_id = $1 AND ses.status = 'active'
         ORDER BY ses.started_at DESC`,
        [lecturer.id]
      ),
      query(
        `SELECT ar.id, ar.marked_at, ar.verification_status, ar.distance_meters,
                u.name AS student_name, s.registration_number,
                sub.code AS subject_code, sub.name AS subject_name
         FROM attendance_records ar
         JOIN attendance_sessions ses ON ses.id = ar.session_id
         JOIN students s ON s.id = ar.student_id
         JOIN users u ON u.id = s.user_id
         JOIN subjects sub ON sub.id = ar.subject_id
         WHERE ses.lecturer_id = $1
         ORDER BY ar.marked_at DESC
         LIMIT 12`,
        [lecturer.id]
      ),
      query(`SELECT * FROM classrooms ORDER BY name ASC`),
    ]);

    res.json({
      lecturer,
      assignedSubjects: assignedSubjects.rows,
      activeSessions: activeSessions.rows,
      recentActivity: recentActivity.rows,
      classrooms: classrooms.rows,
    });
  } catch {
    res.status(500).json({ error: 'Failed to load lecturer dashboard.' });
  }
});

apiRouter.post('/lecturer/sessions', requireAuth, requireRole('lecturer'), async (req: AuthedRequest, res) => {
  try {
    const lecturer = await getLecturerByUserId(req.user!.userId);
    if (!lecturer) {
      res.status(404).json({ error: 'Lecturer profile not found.' });
      return;
    }

    const { subjectId, classroomId } = req.body ?? {};
    const subject = await queryOne<any>(`SELECT * FROM subjects WHERE id = $1 AND lecturer_id = $2`, [
      Number(subjectId),
      lecturer.id,
    ]);

    if (!subject) {
      res.status(403).json({ error: 'You can only start attendance sessions for your assigned subjects.' });
      return;
    }

    const chosenClassroomId = Number(classroomId || subject.default_classroom_id);
    const classroom = await queryOne<any>(`SELECT * FROM classrooms WHERE id = $1`, [chosenClassroomId]);
    if (!classroom) {
      res.status(400).json({ error: 'Please select a valid classroom for this session.' });
      return;
    }

    const ses = await queryOne<{ id: number }>(
      `INSERT INTO attendance_sessions (subject_id, lecturer_id, classroom_id, status, started_at)
       VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
      [subject.id, lecturer.id, classroom.id, new Date().toISOString()]
    );
    const sessionId = ses!.id;
    const qr = await issueFreshQrToken(sessionId);

    res.status(201).json({ sessionId, qr });
  } catch {
    res.status(500).json({ error: 'Failed to start attendance session.' });
  }
});

apiRouter.get('/lecturer/sessions/:id', requireAuth, requireRole('lecturer'), async (req: AuthedRequest, res) => {
  try {
    const lecturer = await getLecturerByUserId(req.user!.userId);
    if (!lecturer) {
      res.status(404).json({ error: 'Lecturer profile not found.' });
      return;
    }

    const sessionId = Number(req.params.id);
    const session = await queryOne<any>(
      `SELECT ses.*, sub.code AS subject_code, sub.name AS subject_name,
              c.name AS classroom_name, c.building AS classroom_building,
              c.latitude AS classroom_lat, c.longitude AS classroom_lng, c.permitted_radius_meters
       FROM attendance_sessions ses
       JOIN subjects sub ON sub.id = ses.subject_id
       JOIN classrooms c ON c.id = ses.classroom_id
       WHERE ses.id = $1 AND ses.lecturer_id = $2`,
      [sessionId, lecturer.id]
    );

    if (!session) {
      res.status(404).json({ error: 'Attendance session not found or access denied.' });
      return;
    }

    let activeQr: { payload: string; token: string; expiresAt: string; ttlSeconds: number } | null = null;
    if (session.status === 'active') {
      const currentToken = await queryOne<{ token: string; expires_at: string }>(
        `SELECT token, expires_at FROM qr_tokens
         WHERE session_id = $1 AND is_revoked = 0
         ORDER BY id DESC LIMIT 1`,
        [sessionId]
      );

      if (!currentToken || new Date(currentToken.expires_at).getTime() <= Date.now()) {
        activeQr = await issueFreshQrToken(sessionId);
      } else {
        activeQr = {
          payload: formatQrPayload(sessionId, currentToken.token),
          token: currentToken.token,
          expiresAt: currentToken.expires_at,
          ttlSeconds: QR_TTL_SECONDS,
        };
      }
    }

    const [attendeesRes, attemptsRes, rejectedRes] = await Promise.all([
      query(
        `SELECT ar.id, ar.marked_at, ar.distance_meters, ar.accuracy_meters, ar.verification_status,
                u.name AS student_name, s.registration_number, s.department
         FROM attendance_records ar
         JOIN students s ON s.id = ar.student_id
         JOIN users u ON u.id = s.user_id
         WHERE ar.session_id = $1
         ORDER BY ar.marked_at DESC`,
        [sessionId]
      ),
      query(
        `SELECT vl.id, vl.attempted_reg_number, vl.outcome, vl.reason, vl.distance_meters, vl.accuracy_meters, vl.created_at,
                u.name AS student_name
         FROM verification_logs vl
         LEFT JOIN students s ON s.id = vl.student_id
         LEFT JOIN users u ON u.id = s.user_id
         WHERE vl.session_id = $1
         ORDER BY vl.created_at DESC
         LIMIT 30`,
        [sessionId]
      ),
      query(
        `SELECT vl.id,
                COALESCE(vl.attempted_reg_number, s.registration_number) AS registration_number,
                vl.attempted_reg_number,
                vl.outcome,
                vl.reason,
                vl.distance_meters,
                vl.accuracy_meters,
                vl.created_at,
                u.name AS student_name
         FROM verification_logs vl
         LEFT JOIN students s ON s.id = vl.student_id
         LEFT JOIN users u ON u.id = s.user_id
         WHERE vl.session_id = $1 AND vl.outcome = 'rejected'
         ORDER BY vl.created_at DESC`,
        [sessionId]
      ),
    ]);

    res.json({
      session,
      activeQr,
      attendees: attendeesRes.rows,
      verificationAttempts: attemptsRes.rows,
      rejectedAttempts: rejectedRes.rows,
    });
  } catch {
    res.status(500).json({ error: 'Failed to load session details.' });
  }
});

apiRouter.post('/lecturer/sessions/:id/refresh-qr', requireAuth, requireRole('lecturer'), async (req: AuthedRequest, res) => {
  try {
    const lecturer = await getLecturerByUserId(req.user!.userId);
    if (!lecturer) {
      res.status(404).json({ error: 'Lecturer profile not found.' });
      return;
    }

    const sessionId = Number(req.params.id);
    const session = await queryOne<{ id: number; status: string }>(
      `SELECT id, status FROM attendance_sessions WHERE id = $1 AND lecturer_id = $2`,
      [sessionId, lecturer.id]
    );

    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    if (session.status !== 'active') {
      res.status(400).json({ error: 'Cannot generate QR code for an ended session.' });
      return;
    }

    const qr = await issueFreshQrToken(sessionId);
    res.json({ qr });
  } catch {
    res.status(500).json({ error: 'Failed to refresh QR code.' });
  }
});

apiRouter.post('/lecturer/sessions/:id/end', requireAuth, requireRole('lecturer'), async (req: AuthedRequest, res) => {
  try {
    const lecturer = await getLecturerByUserId(req.user!.userId);
    if (!lecturer) {
      res.status(404).json({ error: 'Lecturer profile not found.' });
      return;
    }

    const sessionId = Number(req.params.id);
    const info = await query(
      `UPDATE attendance_sessions SET status = 'ended', ended_at = $1 WHERE id = $2 AND lecturer_id = $3 AND status = 'active'`,
      [new Date().toISOString(), sessionId, lecturer.id]
    );

    if (info.rowCount === 0) {
      res.status(404).json({ error: 'Active session not found.' });
      return;
    }

    await query(`UPDATE qr_tokens SET is_revoked = 1 WHERE session_id = $1`, [sessionId]);
    realtimeHub.sendToUser(req.user!.userId, 'session:ended', { sessionId });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to end session.' });
  }
});

apiRouter.get('/lecturer/sessions', requireAuth, requireRole('lecturer'), async (req: AuthedRequest, res) => {
  try {
    const lecturer = await getLecturerByUserId(req.user!.userId);
    if (!lecturer) {
      res.status(404).json({ error: 'Lecturer profile not found.' });
      return;
    }

    const sessions = await query(
      `SELECT ses.*, sub.code AS subject_code, sub.name AS subject_name,
              c.name AS classroom_name, c.building AS classroom_building,
              (SELECT COUNT(*)::int FROM attendance_records ar WHERE ar.session_id = ses.id) AS attendee_count
       FROM attendance_sessions ses
       JOIN subjects sub ON sub.id = ses.subject_id
       JOIN classrooms c ON c.id = ses.classroom_id
       WHERE ses.lecturer_id = $1
       ORDER BY ses.started_at DESC`,
      [lecturer.id]
    );

    res.json({ sessions: sessions.rows });
  } catch {
    res.status(500).json({ error: 'Failed to load sessions.' });
  }
});

apiRouter.get('/lecturer/attendance', requireAuth, requireRole('lecturer'), async (req: AuthedRequest, res) => {
  try {
    const lecturer = await getLecturerByUserId(req.user!.userId);
    if (!lecturer) {
      res.status(404).json({ error: 'Lecturer profile not found.' });
      return;
    }

    const { subjectId, date, search } = req.query;
    const records = await queryAttendanceRecords({
      lecturerId: lecturer.id,
      subjectId: subjectId ? Number(subjectId) : undefined,
      date: date ? String(date) : undefined,
      search: search ? String(search) : undefined,
    });

    res.json({ records });
  } catch {
    res.status(500).json({ error: 'Failed to load attendance records.' });
  }
});

apiRouter.get('/lecturer/reports/csv', requireAuth, requireRole('lecturer'), async (req: AuthedRequest, res) => {
  try {
    const lecturer = await getLecturerByUserId(req.user!.userId);
    if (!lecturer) {
      res.status(404).json({ error: 'Lecturer profile not found.' });
      return;
    }

    const { subjectId, date, search } = req.query;
    const records = await queryAttendanceRecords({
      lecturerId: lecturer.id,
      subjectId: subjectId ? Number(subjectId) : undefined,
      date: date ? String(date) : undefined,
      search: search ? String(search) : undefined,
    });

    sendCsvReport(res, records, 'smartattend-lecturer-attendance-report.csv');
  } catch {
    res.status(500).json({ error: 'Failed to export CSV report.' });
  }
});

async function issueFreshQrToken(sessionId: number) {
  const now = new Date();
  const expires = new Date(now.getTime() + QR_TTL_SECONDS * 1000);
  const token = generateQrTokenValue();

  await withTransaction(async (client) => {
    await client.query(`UPDATE qr_tokens SET is_revoked = 1 WHERE session_id = $1 AND is_revoked = 0`, [sessionId]);
    await client.query(
      `INSERT INTO qr_tokens (session_id, token, created_at, expires_at, is_revoked) VALUES ($1, $2, $3, $4, 0)`,
      [sessionId, token, now.toISOString(), expires.toISOString()]
    );
  });

  return {
    payload: formatQrPayload(sessionId, token),
    token,
    expiresAt: expires.toISOString(),
    ttlSeconds: QR_TTL_SECONDS,
  };
}

// ============================================================================
// STUDENT ROUTES
// ============================================================================

async function getStudentByUserId(userId: number) {
  return queryOne<{
    id: number;
    user_id: number;
    name: string;
    email: string | null;
    registration_number: string;
    department: string;
    year_of_study: number;
    device_id: string | null;
    device_bound_at: string | null;
  }>(
    `SELECT s.*, u.name, u.email
     FROM students s
     JOIN users u ON u.id = s.user_id
     WHERE s.user_id = $1`,
    [userId]
  );
}

apiRouter.get('/student/dashboard', requireAuth, requireRole('student'), async (req: AuthedRequest, res) => {
  try {
    const student = await getStudentByUserId(req.user!.userId);
    if (!student) {
      res.status(404).json({ error: 'Student profile not found.' });
      return;
    }

    const [enrolledSubjects, recentRecords, totalAttended, verificationHistory] = await Promise.all([
      query(
        `SELECT sub.id, sub.code, sub.name, sub.department,
                u.name AS lecturer_name, c.name AS classroom_name, c.building AS classroom_building,
                (SELECT COUNT(*)::int FROM attendance_records ar WHERE ar.student_id = $1 AND ar.subject_id = sub.id) AS attended_count
         FROM enrollments e
         JOIN subjects sub ON sub.id = e.subject_id
         LEFT JOIN lecturers l ON l.id = sub.lecturer_id
         LEFT JOIN users u ON u.id = l.user_id
         LEFT JOIN classrooms c ON c.id = sub.default_classroom_id
         WHERE e.student_id = $1
         ORDER BY sub.code ASC`,
        [student.id]
      ),
      query(
        `SELECT ar.id, ar.subject_id, ar.marked_at, ar.distance_meters, ar.accuracy_meters, ar.verification_status,
                sub.code AS subject_code, sub.name AS subject_name,
                c.name AS classroom_name
         FROM attendance_records ar
         JOIN subjects sub ON sub.id = ar.subject_id
         JOIN attendance_sessions ses ON ses.id = ar.session_id
         JOIN classrooms c ON c.id = ses.classroom_id
         WHERE ar.student_id = $1
         ORDER BY ar.marked_at DESC
         LIMIT 10`,
        [student.id]
      ),
      queryOne<{ c: number }>(`SELECT COUNT(*)::int AS c FROM attendance_records WHERE student_id = $1`, [student.id]),
      query(
        `SELECT vl.id, vl.outcome, vl.reason, vl.distance_meters, vl.created_at,
                sub.code AS subject_code, sub.name AS subject_name
         FROM verification_logs vl
         LEFT JOIN attendance_sessions ses ON ses.id = vl.session_id
         LEFT JOIN subjects sub ON sub.id = ses.subject_id
         WHERE vl.student_id = $1
         ORDER BY vl.created_at DESC
         LIMIT 15`,
        [student.id]
      ),
    ]);

    res.json({
      student,
      enrolledSubjects: enrolledSubjects.rows,
      recentRecords: recentRecords.rows,
      totalAttended: totalAttended?.c ?? 0,
      verificationHistory: verificationHistory.rows,
    });
  } catch {
    res.status(500).json({ error: 'Failed to load student dashboard.' });
  }
});

apiRouter.get('/student/attendance', requireAuth, requireRole('student'), async (req: AuthedRequest, res) => {
  try {
    const student = await getStudentByUserId(req.user!.userId);
    if (!student) {
      res.status(404).json({ error: 'Student profile not found.' });
      return;
    }

    const recordsRes = await query(
      `SELECT ar.id, ar.subject_id, ar.marked_at, ar.distance_meters, ar.accuracy_meters, ar.verification_status,
              sub.code AS subject_code, sub.name AS subject_name,
              c.name AS classroom_name, c.building AS classroom_building
       FROM attendance_records ar
       JOIN subjects sub ON sub.id = ar.subject_id
       JOIN attendance_sessions ses ON ses.id = ar.session_id
       JOIN classrooms c ON c.id = ses.classroom_id
       WHERE ar.student_id = $1
       ORDER BY ar.marked_at DESC`,
      [student.id]
    );

    res.json({ records: recordsRes.rows });
  } catch {
    res.status(500).json({ error: 'Failed to load attendance history.' });
  }
});

apiRouter.post('/student/attendance/mark', requireAuth, requireRole('student'), async (req: AuthedRequest, res) => {
  try {
    const student = await getStudentByUserId(req.user!.userId);
    if (!student) {
      res.status(404).json({ error: 'Student profile not found.' });
      return;
    }

    const { qrPayload, deviceId, latitude, longitude, accuracy, locationError } = req.body ?? {};
    const cleanDeviceId = String(deviceId || req.headers['x-device-id'] || '').trim();
    const parsed = parseQrPayload(String(qrPayload || ''));
    const tokenPrefix = parsed ? `SA1:${parsed.sessionId}:${parsed.token.slice(0, 6)}` : String(qrPayload || '').slice(0, 16);

    const rejectAttempt = async (
      statusCode: number,
      code: string,
      reason: string,
      context?: { sessionId?: number; lecturerUserId?: number; subjectLabel?: string; distanceMeters?: number; accuracyMeters?: number }
    ) => {
      const nowIso = new Date().toISOString();
      await query(
        `INSERT INTO verification_logs
         (session_id, student_id, attempted_reg_number, qr_token_prefix, device_id, latitude, longitude, accuracy_meters, distance_meters, outcome, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'rejected', $10, $11)`,
        [
          context?.sessionId ?? null,
          student.id,
          student.registration_number,
          tokenPrefix,
          cleanDeviceId || null,
          typeof latitude === 'number' ? latitude : null,
          typeof longitude === 'number' ? longitude : null,
          context?.accuracyMeters ?? (typeof accuracy === 'number' ? accuracy : null),
          context?.distanceMeters ?? null,
          reason,
          nowIso,
        ]
      );

      const notifMsg = context?.subjectLabel
        ? `Rejected for ${context.subjectLabel}: ${reason}`
        : `Attendance rejected: ${reason}`;

      const notif = await queryOne<{ id: number }>(
        `INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES ($1, 'Attendance Rejected', $2, 'rejected', 0, $3) RETURNING id`,
        [req.user!.userId, notifMsg, nowIso]
      );

      realtimeHub.sendToUser(req.user!.userId, 'notification:new', {
        id: notif?.id,
        title: 'Attendance Rejected',
        message: notifMsg,
        type: 'rejected',
        is_read: 0,
        created_at: nowIso,
      });

      if (context?.lecturerUserId && context?.sessionId) {
        realtimeHub.sendToUser(context.lecturerUserId, 'verification:logged', {
          sessionId: context.sessionId,
          studentName: student.name,
          registrationNumber: student.registration_number,
          outcome: 'rejected',
          reason,
          createdAt: nowIso,
        });
      }

      res.status(statusCode).json({
        status: 'rejected',
        code,
        reason,
        subject: context?.subjectLabel || null,
      });
    };

    if (!parsed) {
      await rejectAttempt(400, 'INVALID_QR', 'Invalid QR code format. Please scan a valid SmartAttend session QR code.');
      return;
    }

    const qrRow = await queryOne<{ id: number; session_id: number; token: string; expires_at: string; is_revoked: number }>(
      `SELECT id, session_id, token, expires_at, is_revoked FROM qr_tokens WHERE token = $1 AND session_id = $2`,
      [parsed.token, parsed.sessionId]
    );

    const session = await queryOne<any>(
      `SELECT ses.*, sub.code AS subject_code, sub.name AS subject_name,
              l.user_id AS lecturer_user_id,
              c.name AS classroom_name, c.building AS classroom_building,
              c.latitude AS classroom_lat, c.longitude AS classroom_lng, c.permitted_radius_meters
       FROM attendance_sessions ses
       JOIN subjects sub ON sub.id = ses.subject_id
       JOIN lecturers l ON l.id = ses.lecturer_id
       JOIN classrooms c ON c.id = ses.classroom_id
       WHERE ses.id = $1`,
      [parsed.sessionId]
    );

    if (!qrRow || !session) {
      await rejectAttempt(404, 'QR_NOT_FOUND', 'QR code not recognized or belongs to an invalid session.');
      return;
    }

    const subjectLabel = `${session.subject_code} — ${session.subject_name}`;

    if (session.status !== 'active') {
      await rejectAttempt(400, 'SESSION_ENDED', 'Attendance session ended. Your lecturer has closed this session.', {
        sessionId: session.id,
        lecturerUserId: session.lecturer_user_id,
        subjectLabel,
      });
      return;
    }

    if (qrRow.is_revoked === 1 || new Date(qrRow.expires_at).getTime() <= Date.now()) {
      await rejectAttempt(400, 'QR_EXPIRED', 'QR code expired. Please scan the newest QR code shown on the screen.', {
        sessionId: session.id,
        lecturerUserId: session.lecturer_user_id,
        subjectLabel,
      });
      return;
    }

    const enrollment = await queryOne(`SELECT id FROM enrollments WHERE student_id = $1 AND subject_id = $2`, [
      student.id,
      session.subject_id,
    ]);
    if (!enrollment) {
      await rejectAttempt(403, 'NOT_ENROLLED', `You are not enrolled in ${subjectLabel}.`, {
        sessionId: session.id,
        lecturerUserId: session.lecturer_user_id,
        subjectLabel,
      });
      return;
    }

    if (!cleanDeviceId) {
      await rejectAttempt(400, 'DEVICE_MISSING', 'Device identifier is missing. Please reload the application and try again.', {
        sessionId: session.id,
        lecturerUserId: session.lecturer_user_id,
        subjectLabel,
      });
      return;
    }

    const otherStudentWithDevice = await queryOne<{ id: number; registration_number: string }>(
      `SELECT id, registration_number FROM students WHERE device_id = $1 AND id != $2`,
      [cleanDeviceId, student.id]
    );

    if (otherStudentWithDevice) {
      await rejectAttempt(
        403,
        'DEVICE_MISMATCH',
        `Device does not match the student account. This browser/device is already associated with another registration number (${otherStudentWithDevice.registration_number}).`,
        {
          sessionId: session.id,
          lecturerUserId: session.lecturer_user_id,
          subjectLabel,
        }
      );
      return;
    }

    if (student.device_id && student.device_id !== cleanDeviceId) {
      await rejectAttempt(
        403,
        'DEVICE_MISMATCH',
        'Device does not match the student account. Your registration number is already associated with another device.',
        {
          sessionId: session.id,
          lecturerUserId: session.lecturer_user_id,
          subjectLabel,
        }
      );
      return;
    }

    if (!student.device_id) {
      await query(`UPDATE students SET device_id = $1, device_bound_at = $2 WHERE id = $3`, [
        cleanDeviceId,
        new Date().toISOString(),
        student.id,
      ]);
    }

    const existingRecord = await queryOne(`SELECT id, marked_at FROM attendance_records WHERE session_id = $1 AND student_id = $2`, [
      session.id,
      student.id,
    ]);
    if (existingRecord) {
      await rejectAttempt(409, 'ALREADY_MARKED', 'Attendance already marked for this lecture session.', {
        sessionId: session.id,
        lecturerUserId: session.lecturer_user_id,
        subjectLabel,
      });
      return;
    }

    if (locationError) {
      const locMsg =
        locationError === 'PERMISSION_DENIED'
          ? 'Location permission denied. Please allow location access to verify your classroom presence.'
          : 'Location is disabled or unavailable on your device. Please enable GPS/location services.';
      await rejectAttempt(400, 'LOCATION_DENIED', locMsg, {
        sessionId: session.id,
        lecturerUserId: session.lecturer_user_id,
        subjectLabel,
      });
      return;
    }

    if (typeof latitude !== 'number' || typeof longitude !== 'number' || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      await rejectAttempt(400, 'LOCATION_UNAVAILABLE', 'Could not retrieve valid GPS coordinates. Please enable location services.', {
        sessionId: session.id,
        lecturerUserId: session.lecturer_user_id,
        subjectLabel,
      });
      return;
    }

    const accuracyMeters = typeof accuracy === 'number' && !Number.isNaN(accuracy) ? accuracy : 9999;
    if (accuracyMeters > MAX_ACCEPTABLE_ACCURACY_METERS) {
      await rejectAttempt(
        400,
        'LOW_ACCURACY',
        `Location accuracy is unacceptable (${Math.round(accuracyMeters)}m). Required accuracy is ${MAX_ACCEPTABLE_ACCURACY_METERS}m or better.`,
        {
          sessionId: session.id,
          lecturerUserId: session.lecturer_user_id,
          subjectLabel,
          accuracyMeters,
        }
      );
      return;
    }

    const distanceMeters = calculateDistanceMeters(latitude, longitude, session.classroom_lat, session.classroom_lng);

    if (distanceMeters > session.permitted_radius_meters) {
      await rejectAttempt(
        403,
        'OUTSIDE_AREA',
        `Student is outside the permitted area (${Math.round(distanceMeters)}m from ${session.classroom_name}; permitted radius is ${session.permitted_radius_meters}m).`,
        {
          sessionId: session.id,
          lecturerUserId: session.lecturer_user_id,
          subjectLabel,
          distanceMeters,
          accuracyMeters,
        }
      );
      return;
    }

    const markedAt = new Date().toISOString();
    const formattedDate = new Date(markedAt).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const formattedTime = new Date(markedAt).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const saved = await withTransaction(async (client) => {
      const rec = await client.query<{ id: number }>(
        `INSERT INTO attendance_records
         (session_id, student_id, subject_id, marked_at, latitude, longitude, accuracy_meters, distance_meters, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Verified') RETURNING id`,
        [session.id, student.id, session.subject_id, markedAt, latitude, longitude, accuracyMeters, distanceMeters]
      );

      await client.query(
        `INSERT INTO verification_logs
         (session_id, student_id, attempted_reg_number, qr_token_prefix, device_id, latitude, longitude, accuracy_meters, distance_meters, outcome, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'accepted', 'Verified within classroom area', $10)`,
        [session.id, student.id, student.registration_number, tokenPrefix, cleanDeviceId, latitude, longitude, accuracyMeters, distanceMeters, markedAt]
      );

      const notifMsg = `Your attendance for ${subjectLabel} was verified on ${formattedDate} at ${formattedTime} (${Math.round(
        distanceMeters
      )}m from ${session.classroom_name}).`;

      const notif = await client.query<{ id: number }>(
        `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
         VALUES ($1, 'Attendance Marked Successfully!', $2, 'accepted', 0, $3) RETURNING id`,
        [req.user!.userId, notifMsg, markedAt]
      );

      return { recordId: rec.rows[0].id, notifId: notif.rows[0].id, notifMsg };
    });

    realtimeHub.sendToUser(req.user!.userId, 'notification:new', {
      id: saved.notifId,
      title: 'Attendance Marked Successfully!',
      message: saved.notifMsg,
      type: 'accepted',
      is_read: 0,
      created_at: markedAt,
    });

    realtimeHub.sendToUser(session.lecturer_user_id, 'attendance:marked', {
      sessionId: session.id,
      record: {
        id: saved.recordId,
        marked_at: markedAt,
        distance_meters: distanceMeters,
        accuracy_meters: accuracyMeters,
        verification_status: 'Verified',
        student_name: student.name,
        registration_number: student.registration_number,
        department: student.department,
      },
    });

    res.status(201).json({
      status: 'accepted',
      message: 'Attendance Marked Successfully!',
      record: {
        id: saved.recordId,
        subjectCode: session.subject_code,
        subjectName: session.subject_name,
        classroomName: `${session.classroom_name} (${session.classroom_building})`,
        markedAt,
        date: formattedDate,
        time: formattedTime,
        distanceMeters: Math.round(distanceMeters),
        accuracyMeters: Math.round(accuracyMeters),
        verificationStatus: 'Verified',
      },
    });
  } catch (err: any) {
    console.error('Mark attendance error:', err?.message);
    res.status(500).json({ error: 'Failed to process attendance submission.' });
  }
});

// ============================================================================
// SHARED REPORT QUERY & CSV EXPORT HELPERS
// ============================================================================

async function queryAttendanceRecords(filters: {
  lecturerId?: number;
  subjectId?: number;
  studentId?: number;
  date?: string;
  search?: string;
}) {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.lecturerId) {
    params.push(filters.lecturerId);
    where.push(`ses.lecturer_id = $${params.length}`);
  }
  if (filters.subjectId) {
    params.push(filters.subjectId);
    where.push(`ar.subject_id = $${params.length}`);
  }
  if (filters.studentId) {
    params.push(filters.studentId);
    where.push(`ar.student_id = $${params.length}`);
  }
  if (filters.date) {
    params.push(filters.date);
    where.push(`LEFT(ar.marked_at, 10) = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    const p1 = params.length;
    params.push(`%${filters.search}%`);
    const p2 = params.length;
    where.push(`(LOWER(u.name) LIKE LOWER($${p1}) OR LOWER(s.registration_number) LIKE LOWER($${p2}))`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const result = await query(
    `SELECT ar.id, ar.session_id, ar.student_id, ar.subject_id,
            u.name AS student_name, s.registration_number, s.department,
            sub.code AS subject_code, sub.name AS subject_name,
            c.name AS classroom_name,
            ar.marked_at, ar.distance_meters, ar.accuracy_meters, ar.verification_status
     FROM attendance_records ar
     JOIN students s ON s.id = ar.student_id
     JOIN users u ON u.id = s.user_id
     JOIN subjects sub ON sub.id = ar.subject_id
     JOIN attendance_sessions ses ON ses.id = ar.session_id
     JOIN classrooms c ON c.id = ses.classroom_id
     ${whereClause}
     ORDER BY ar.marked_at DESC`,
    params
  );

  return result.rows;
}

function sendCsvReport(res: Response, records: any[], filename: string) {
  const header = [
    'Student Name',
    'University Registration Number',
    'Subject Code',
    'Subject Name',
    'Classroom',
    'Attendance Date',
    'Attendance Time',
    'Verification Status',
    'Distance (m)',
  ];

  const lines = [header.map(csvEscape).join(',')];
  for (const r of records) {
    const d = new Date(r.marked_at);
    const dateStr = d.toISOString().slice(0, 10);
    const timeStr = d.toTimeString().slice(0, 8);
    lines.push(
      [
        r.student_name,
        r.registration_number,
        r.subject_code,
        r.subject_name,
        r.classroom_name,
        dateStr,
        timeStr,
        r.verification_status,
        Math.round(r.distance_meters),
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\n'));
}
