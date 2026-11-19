import React, { useEffect, useState, useCallback } from 'react';
import {
  Users,
  GraduationCap,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Plus,
  Pencil,
  Trash2,
  Download,
  Search,
  MapPin,
  X,
  Crosshair,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch, downloadCsvReport, formatDateTime } from '../utils/api';
import type { Classroom, Subject, AttendanceRecord, VerificationLog } from '../types';
import { SubjectGroupedRecords } from './SubjectGroupedRecords';

export type AdminTab = 'dashboard' | 'students' | 'lecturers' | 'academics' | 'reports';

interface AdminPortalProps {
  activeTab: AdminTab;
  onNavigate: (tab: AdminTab) => void;
}

interface StudentRow {
  id: number;
  user_id: number;
  name: string;
  email: string | null;
  registration_number: string;
  department: string;
  year_of_study: number;
  device_id: string | null;
  enrolled_subjects_count: number;
  sessions_attended: number;
  subject_ids: number[];
}

interface LecturerRow {
  id: number;
  user_id: number;
  name: string;
  email: string;
  staff_id: string;
  department: string;
  assigned_subjects_count: number;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({ activeTab, onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Dashboard state
  const [metrics, setMetrics] = useState({
    totalStudents: 0,
    totalLecturers: 0,
    totalSubjects: 0,
    totalSessions: 0,
    activeSessions: 0,
    totalAttendanceRecords: 0,
  });
  const [subjectStats, setSubjectStats] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [recentRejections, setRecentRejections] = useState<any[]>([]);

  // Directory state
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [lecturers, setLecturers] = useState<LecturerRow[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);

  // Reports state
  const [reportRecords, setReportRecords] = useState<AttendanceRecord[]>([]);
  const [reportLogs, setReportLogs] = useState<VerificationLog[]>([]);
  const [reportSubTab, setReportSubTab] = useState<'by-subject' | 'records' | 'logs'>('by-subject');
  const [filterSubjectId, setFilterSubjectId] = useState<string>('');
  const [filterDate, setFilterDate] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [studentHistoryModal, setStudentHistoryModal] = useState<{
    name: string;
    regNumber: string;
    records: AttendanceRecord[];
  } | null>(null);

  // Modals state
  const [studentModal, setStudentModal] = useState<{
    mode: 'add' | 'edit';
    id?: number;
    name: string;
    email: string;
    registration_number: string;
    department: string;
    year_of_study: number;
    password: string;
    subject_ids: number[];
  } | null>(null);

  const [lecturerModal, setLecturerModal] = useState<{
    mode: 'add' | 'edit';
    id?: number;
    name: string;
    email: string;
    staff_id: string;
    department: string;
    password: string;
  } | null>(null);

  const [subjectModal, setSubjectModal] = useState<{
    mode: 'add' | 'edit';
    id?: number;
    code: string;
    name: string;
    department: string;
    lecturer_id: string;
    default_classroom_id: string;
    student_ids: number[];
  } | null>(null);

  const [classroomModal, setClassroomModal] = useState<{
    mode: 'add' | 'edit';
    id?: number;
    name: string;
    building: string;
    latitude: string;
    longitude: string;
    permitted_radius_meters: number;
  } | null>(null);

  const [locatingRoom, setLocatingRoom] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, stRes, lecRes, subRes, roomRes] = await Promise.all([
        apiFetch('/api/admin/dashboard'),
        apiFetch('/api/admin/students'),
        apiFetch('/api/admin/lecturers'),
        apiFetch('/api/admin/subjects'),
        apiFetch('/api/admin/classrooms'),
      ]);
      setMetrics(dash.metrics);
      setSubjectStats(dash.subjectStats);
      setRecentActivity(dash.recentActivity);
      setRecentRejections(dash.recentRejections);
      setStudents(stRes.students);
      setLecturers(lecRes.lecturers);
      setSubjects(subRes.subjects);
      setClassrooms(roomRes.classrooms);
    } catch (err: any) {
      setError(err.message || 'Failed to load administrator data.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReports = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterSubjectId) params.set('subjectId', filterSubjectId);
      if (filterDate) params.set('date', filterDate);
      if (filterSearch.trim()) params.set('search', filterSearch.trim());
      const res = await apiFetch(`/api/admin/attendance?${params.toString()}`);
      setReportRecords(res.records);
      setReportLogs(res.logs);
    } catch (err: any) {
      setError(err.message || 'Failed to load attendance reports.');
    }
  }, [filterSubjectId, filterDate, filterSearch]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  useEffect(() => {
    if (activeTab === 'reports') {
      loadReports();
    }
  }, [activeTab, loadReports]);

  // Student CRUD
  const saveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentModal) return;
    try {
      const payload = {
        name: studentModal.name,
        email: studentModal.email,
        registration_number: studentModal.registration_number,
        department: studentModal.department,
        year_of_study: studentModal.year_of_study,
        password: studentModal.password,
        subject_ids: studentModal.subject_ids,
      };
      if (studentModal.mode === 'add') {
        await apiFetch('/api/admin/students', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Student account created.');
      } else {
        await apiFetch(`/api/admin/students/${studentModal.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast('Student account updated.');
      }
      setStudentModal(null);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteStudent = async (id: number, name: string) => {
    try {
      await apiFetch(`/api/admin/students/${id}`, { method: 'DELETE' });
      showToast(`Removed student ${name}.`);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Lecturer CRUD
  const saveLecturer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lecturerModal) return;
    try {
      const payload = {
        name: lecturerModal.name,
        email: lecturerModal.email,
        staff_id: lecturerModal.staff_id,
        department: lecturerModal.department,
        password: lecturerModal.password,
      };
      if (lecturerModal.mode === 'add') {
        await apiFetch('/api/admin/lecturers', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Lecturer account created.');
      } else {
        await apiFetch(`/api/admin/lecturers/${lecturerModal.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast('Lecturer account updated.');
      }
      setLecturerModal(null);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteLecturer = async (id: number, name: string) => {
    try {
      await apiFetch(`/api/admin/lecturers/${id}`, { method: 'DELETE' });
      showToast(`Removed lecturer ${name}.`);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Classroom CRUD
  const saveClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classroomModal) return;
    try {
      const payload = {
        name: classroomModal.name,
        building: classroomModal.building,
        latitude: Number(classroomModal.latitude),
        longitude: Number(classroomModal.longitude),
        permitted_radius_meters: Number(classroomModal.permitted_radius_meters),
      };
      if (classroomModal.mode === 'add') {
        await apiFetch('/api/admin/classrooms', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Classroom added.');
      } else {
        await apiFetch(`/api/admin/classrooms/${classroomModal.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast('Classroom updated.');
      }
      setClassroomModal(null);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteClassroom = async (id: number, name: string) => {
    try {
      await apiFetch(`/api/admin/classrooms/${id}`, { method: 'DELETE' });
      showToast(`Deleted classroom ${name}.`);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const useCurrentGpsForClassroom = () => {
    if (!navigator.geolocation || !classroomModal) return;
    setLocatingRoom(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setClassroomModal((prev) =>
          prev
            ? {
                ...prev,
                latitude: pos.coords.latitude.toFixed(6),
                longitude: pos.coords.longitude.toFixed(6),
              }
            : null
        );
        setLocatingRoom(false);
        showToast('Classroom coordinates populated from your current GPS position.');
      },
      () => {
        setLocatingRoom(false);
        setError('Unable to retrieve GPS coordinates from browser. Please allow location access.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Subject CRUD
  const saveSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectModal) return;
    try {
      const payload = {
        code: subjectModal.code,
        name: subjectModal.name,
        department: subjectModal.department,
        lecturer_id: subjectModal.lecturer_id ? Number(subjectModal.lecturer_id) : null,
        default_classroom_id: subjectModal.default_classroom_id
          ? Number(subjectModal.default_classroom_id)
          : null,
        student_ids: subjectModal.student_ids,
      };
      if (subjectModal.mode === 'add') {
        await apiFetch('/api/admin/subjects', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Subject created.');
      } else {
        await apiFetch(`/api/admin/subjects/${subjectModal.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast('Subject updated.');
      }
      setSubjectModal(null);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteSubject = async (id: number, code: string) => {
    try {
      await apiFetch(`/api/admin/subjects/${id}`, { method: 'DELETE' });
      showToast(`Deleted subject ${code}.`);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const openStudentHistory = async (studentId: number, name: string, regNumber: string) => {
    try {
      const res = await apiFetch(`/api/admin/attendance?studentId=${studentId}`);
      setStudentHistoryModal({ name, regNumber, records: res.records });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDownloadCsv = async () => {
    try {
      const params = new URLSearchParams();
      if (filterSubjectId) params.set('subjectId', filterSubjectId);
      if (filterDate) params.set('date', filterDate);
      if (filterSearch.trim()) params.set('search', filterSearch.trim());
      await downloadCsvReport(
        `/api/admin/reports/csv?${params.toString()}`,
        `smartattend-report-${new Date().toISOString().slice(0, 10)}.csv`
      );
      showToast('Attendance report downloaded.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const maxSubjectAttendance = Math.max(1, ...subjectStats.map((s) => Number(s.attendance_count || 0)));

  return (
    <div className="space-y-6">
      {toast && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm font-medium text-emerald-800 flex items-center justify-between">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} className="text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm font-medium text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* DASHBOARD TAB */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* 5 KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                <span>Total Students</span>
                <Users className="w-4 h-4 text-blue-600" />
              </div>
              <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {loading ? '—' : metrics.totalStudents}
              </div>
              <button
                type="button"
                onClick={() => onNavigate('students')}
                className="mt-2 text-xs font-medium text-blue-700 hover:underline"
              >
                Manage students
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                <span>Total Lecturers</span>
                <GraduationCap className="w-4 h-4 text-blue-600" />
              </div>
              <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {loading ? '—' : metrics.totalLecturers}
              </div>
              <button
                type="button"
                onClick={() => onNavigate('lecturers')}
                className="mt-2 text-xs font-medium text-blue-700 hover:underline"
              >
                Manage lecturers
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                <span>Total Subjects</span>
                <BookOpen className="w-4 h-4 text-blue-600" />
              </div>
              <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {loading ? '—' : metrics.totalSubjects}
              </div>
              <button
                type="button"
                onClick={() => onNavigate('academics')}
                className="mt-2 text-xs font-medium text-blue-700 hover:underline"
              >
                Subjects & rooms
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                <span>Attendance Sessions</span>
                <CalendarClock className="w-4 h-4 text-blue-600" />
              </div>
              <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {loading ? '—' : metrics.totalSessions}
              </div>
              <div className="mt-2 text-xs text-slate-500 tabular-nums">
                {metrics.activeSessions} active now
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                <span>Successful Records</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {loading ? '—' : metrics.totalAttendanceRecords}
              </div>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="mt-2 text-xs font-medium text-blue-700 hover:underline"
              >
                View reports
              </button>
            </div>
          </div>

          {/* Chart + Recent Activity Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Simple Chart: Attendance by Subject */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Verified Attendance by Subject
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Successful submissions recorded across lecture sessions
              </p>

              <div className="mt-6 space-y-4">
                {subjectStats.length === 0 ? (
                  <p className="text-sm text-slate-500">No subjects configured yet.</p>
                ) : (
                  subjectStats.map((s) => {
                    const count = Number(s.attendance_count || 0);
                    const pct = Math.round((count / maxSubjectAttendance) * 100);
                    return (
                      <div key={s.id}>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="font-medium text-slate-800 truncate pr-2">
                            <span className="font-mono text-blue-700 mr-1.5">{s.code}</span>
                            {s.name}
                          </span>
                          <span className="font-mono tabular-nums text-slate-600 shrink-0">
                            {count} records · {s.session_count} sessions
                          </span>
                        </div>
                        <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600 rounded-full transition-all"
                            style={{ width: `${Math.max(4, pct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Recent Verified Attendance */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Recent Verified Attendance
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Latest verified QR & location submissions
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('reports')}
                  className="text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap"
                >
                  View all records
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2.5 pr-3 font-medium">Student</th>
                      <th className="py-2.5 px-3 font-medium">Subject</th>
                      <th className="py-2.5 px-3 font-medium">Classroom</th>
                      <th className="py-2.5 pl-3 font-medium text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {recentActivity.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-500 text-xs">
                          No attendance records yet.
                        </td>
                      </tr>
                    ) : (
                      recentActivity.map((item) => {
                        const dt = formatDateTime(item.timestamp);
                        return (
                          <tr key={item.id} className="hover:bg-slate-50">
                            <td className="py-2.5 pr-3">
                              <div className="font-medium text-slate-900">{item.student_name}</div>
                              <div className="text-xs font-mono text-slate-500 tabular-nums">
                                {item.registration_number}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="text-slate-800">{item.subject_code}</div>
                              <div className="text-xs text-slate-500 truncate max-w-[160px]">
                                {item.subject_name}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-xs text-slate-600">
                              {item.classroom_name}
                            </td>
                            <td className="py-2.5 pl-3 text-right text-xs font-mono tabular-nums text-slate-600">
                              <div>{dt.date}</div>
                              <div>{dt.time}</div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Recent Rejections for Admin Review */}
          {recentRejections.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Recent Rejected Verification Attempts
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2 pr-3 font-medium">Student / Reg No.</th>
                      <th className="py-2 px-3 font-medium">Subject</th>
                      <th className="py-2 px-3 font-medium">Rejection Reason</th>
                      <th className="py-2 pl-3 font-medium text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentRejections.map((r) => {
                      const dt = formatDateTime(r.created_at);
                      return (
                        <tr key={r.id}>
                          <td className="py-2.5 pr-3">
                            <span className="font-medium text-slate-900">
                              {r.student_name || 'Unknown'}
                            </span>
                            {r.attempted_reg_number && (
                              <span className="ml-2 text-xs font-mono text-slate-500">
                                {r.attempted_reg_number}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-slate-700">
                            {r.subject_code ? `${r.subject_code} · ${r.subject_name}` : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-red-700">{r.reason}</td>
                          <td className="py-2.5 pl-3 text-right text-xs font-mono tabular-nums text-slate-500">
                            {dt.date} {dt.time}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STUDENTS TAB */}
      {activeTab === 'students' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">Student Accounts</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Each student has a unique registration number and automatic 1-to-1 device binding.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setStudentModal({
                  mode: 'add',
                  name: '',
                  email: '',
                  registration_number: '',
                  department: 'Foundation Computing',
                  year_of_study: 1,
                  password: '',
                  subject_ids: [],
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Student</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2.5 pr-3 font-medium">Reg. Number</th>
                  <th className="py-2.5 px-3 font-medium">Name</th>
                  <th className="py-2.5 px-3 font-medium">Department</th>
                  <th className="py-2.5 px-3 font-medium text-right">Subjects</th>
                  <th className="py-2.5 px-3 font-medium text-right">Attended</th>
                  <th className="py-2.5 px-3 font-medium">Device Binding</th>
                  <th className="py-2.5 pl-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.map((st) => (
                  <tr key={st.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-3 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {st.registration_number}
                    </td>
                    <td className="py-3 px-3">
                      <button
                        type="button"
                        onClick={() => openStudentHistory(st.id, st.name, st.registration_number)}
                        className="font-medium text-blue-700 hover:underline text-left"
                      >
                        {st.name}
                      </button>
                      {st.email && <div className="text-xs text-slate-500">{st.email}</div>}
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-700">
                      {st.department} · Year {st.year_of_study}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {st.enrolled_subjects_count}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {st.sessions_attended}
                    </td>
                    <td className="py-3 px-3 text-xs">
                      {st.device_id ? (
                        <span className="text-emerald-700 font-medium">Bound</span>
                      ) : (
                        <span className="text-slate-400">Unbound (binds on login)</span>
                      )}
                    </td>
                    <td className="py-3 pl-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() =>
                          setStudentModal({
                            mode: 'edit',
                            id: st.id,
                            name: st.name,
                            email: st.email || '',
                            registration_number: st.registration_number,
                            department: st.department,
                            year_of_study: st.year_of_study,
                            password: '',
                            subject_ids: st.subject_ids || [],
                          })
                        }
                        className="p-1.5 text-slate-600 hover:text-blue-700 rounded-md"
                        aria-label={`Edit ${st.name}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteStudent(st.id, st.name)}
                        className="p-1.5 text-slate-600 hover:text-red-600 rounded-md ml-1"
                        aria-label={`Delete ${st.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* LECTURERS TAB */}
      {activeTab === 'lecturers' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">Lecturer Accounts</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Lecturers can start dynamic QR sessions and monitor live attendance for assigned subjects.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setLecturerModal({
                  mode: 'add',
                  name: '',
                  email: '',
                  staff_id: '',
                  department: 'Foundation Computing',
                  password: '',
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Lecturer</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2.5 pr-3 font-medium">Staff ID</th>
                  <th className="py-2.5 px-3 font-medium">Name & Email</th>
                  <th className="py-2.5 px-3 font-medium">Department</th>
                  <th className="py-2.5 px-3 font-medium text-right">Assigned Subjects</th>
                  <th className="py-2.5 pl-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lecturers.map((lec) => (
                  <tr key={lec.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-3 font-mono text-xs font-semibold text-slate-900">
                      {lec.staff_id}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-900">{lec.name}</div>
                      <div className="text-xs text-slate-500">{lec.email}</div>
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-700">{lec.department}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {lec.assigned_subjects_count}
                    </td>
                    <td className="py-3 pl-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() =>
                          setLecturerModal({
                            mode: 'edit',
                            id: lec.id,
                            name: lec.name,
                            email: lec.email,
                            staff_id: lec.staff_id,
                            department: lec.department,
                            password: '',
                          })
                        }
                        className="p-1.5 text-slate-600 hover:text-blue-700 rounded-md"
                        aria-label={`Edit ${lec.name}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteLecturer(lec.id, lec.name)}
                        className="p-1.5 text-slate-600 hover:text-red-600 rounded-md ml-1"
                        aria-label={`Delete ${lec.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBJECTS & CLASSROOMS TAB */}
      {activeTab === 'academics' && (
        <div className="space-y-6">
          {/* Subjects Section */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Subjects & Lecturer Assignments
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Assign lecturers, default classrooms, and student enrollments.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setSubjectModal({
                    mode: 'add',
                    code: '',
                    name: '',
                    department: 'Foundation Computing',
                    lecturer_id: lecturers[0]?.id ? String(lecturers[0].id) : '',
                    default_classroom_id: classrooms[0]?.id ? String(classrooms[0].id) : '',
                    student_ids: [],
                  })
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Add Subject</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 pr-3 font-medium">Code</th>
                    <th className="py-2.5 px-3 font-medium">Subject Name</th>
                    <th className="py-2.5 px-3 font-medium">Assigned Lecturer</th>
                    <th className="py-2.5 px-3 font-medium">Default Classroom</th>
                    <th className="py-2.5 px-3 font-medium text-right">Enrolled</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subjects.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50">
                      <td className="py-3 pr-3 font-mono text-xs font-semibold text-blue-700">
                        {sub.code}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-900">{sub.name}</div>
                        <div className="text-xs text-slate-500">{sub.department}</div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-700">
                        {sub.lecturer_name ? (
                          <div>
                            <div className="font-medium text-slate-900">{sub.lecturer_name}</div>
                            <div className="font-mono text-slate-500">{sub.lecturer_staff_id}</div>
                          </div>
                        ) : (
                          <span className="text-amber-700">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-700">
                        {sub.classroom_name ? (
                          <span>
                            {sub.classroom_name} · {sub.classroom_building}
                          </span>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {sub.enrolled_count}
                      </td>
                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            setSubjectModal({
                              mode: 'edit',
                              id: sub.id,
                              code: sub.code,
                              name: sub.name,
                              department: sub.department,
                              lecturer_id: sub.lecturer_id ? String(sub.lecturer_id) : '',
                              default_classroom_id: sub.default_classroom_id
                                ? String(sub.default_classroom_id)
                                : '',
                              student_ids: sub.student_ids || [],
                            })
                          }
                          className="p-1.5 text-slate-600 hover:text-blue-700 rounded-md"
                          aria-label={`Edit ${sub.code}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSubject(sub.id, sub.code)}
                          className="p-1.5 text-slate-600 hover:text-red-600 rounded-md ml-1"
                          aria-label={`Delete ${sub.code}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Classrooms Section */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Classrooms & Permitted Geofence Areas
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure GPS coordinates and permitted attendance radius (in meters) for each room.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setClassroomModal({
                    mode: 'add',
                    name: '',
                    building: '',
                    latitude: '51.507400',
                    longitude: '-0.127800',
                    permitted_radius_meters: 60,
                  })
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Add Classroom</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 pr-3 font-medium">Classroom</th>
                    <th className="py-2.5 px-3 font-medium">Building</th>
                    <th className="py-2.5 px-3 font-medium">Coordinates (Lat, Lng)</th>
                    <th className="py-2.5 px-3 font-medium text-right">Permitted Radius</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {classrooms.map((room) => (
                    <tr key={room.id} className="hover:bg-slate-50">
                      <td className="py-3 pr-3 font-medium text-slate-900">{room.name}</td>
                      <td className="py-3 px-3 text-xs text-slate-700">{room.building}</td>
                      <td className="py-3 px-3 font-mono text-xs tabular-nums text-slate-600">
                        {room.latitude.toFixed(6)}, {room.longitude.toFixed(6)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs tabular-nums text-slate-800">
                        {room.permitted_radius_meters} m
                      </td>
                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            setClassroomModal({
                              mode: 'edit',
                              id: room.id,
                              name: room.name,
                              building: room.building,
                              latitude: String(room.latitude),
                              longitude: String(room.longitude),
                              permitted_radius_meters: room.permitted_radius_meters,
                            })
                          }
                          className="p-1.5 text-slate-600 hover:text-blue-700 rounded-md"
                          aria-label={`Edit ${room.name}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteClassroom(room.id, room.name)}
                          className="p-1.5 text-slate-600 hover:text-red-600 rounded-md ml-1"
                          aria-label={`Delete ${room.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ATTENDANCE & REPORTS TAB */}
      {activeTab === 'reports' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Attendance Records & Verification Reports
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Only students who successfully verified QR and location are recorded as present. No absent records are generated.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>Download CSV Report</span>
            </button>
          </div>

          {/* Sub-view Toggle & Filters */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start flex-wrap">
              <button
                type="button"
                onClick={() => setReportSubTab('by-subject')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  reportSubTab === 'by-subject'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                By Subject ({reportRecords.length})
              </button>
              <button
                type="button"
                onClick={() => setReportSubTab('records')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  reportSubTab === 'records'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Records ({reportRecords.length})
              </button>
              <button
                type="button"
                onClick={() => setReportSubTab('logs')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  reportSubTab === 'logs'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Verification Logs ({reportLogs.length})
              </button>
            </div>

            {reportSubTab !== 'logs' && (
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={filterSearch}
                    onChange={(e) => setFilterSearch(e.target.value)}
                    placeholder="Search student or reg no."
                    className="pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <select
                  value={filterSubjectId}
                  onChange={(e) => setFilterSubjectId(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="">All Subjects</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {(filterSubjectId || filterDate || filterSearch) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterSubjectId('');
                      setFilterDate('');
                      setFilterSearch('');
                    }}
                    className="px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>

          {reportSubTab === 'by-subject' ? (
            <SubjectGroupedRecords
              records={reportRecords}
              showStudentColumn
              onSelectStudent={(r) =>
                r.student_id &&
                openStudentHistory(r.student_id, r.student_name || '', r.registration_number || '')
              }
              emptyMessage="No matching verified attendance records found."
            />
          ) : reportSubTab === 'records' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 pr-3 font-medium">Student Name</th>
                    <th className="py-2.5 px-3 font-medium">Reg. Number</th>
                    <th className="py-2.5 px-3 font-medium">Subject</th>
                    <th className="py-2.5 px-3 font-medium">Date</th>
                    <th className="py-2.5 px-3 font-medium">Time</th>
                    <th className="py-2.5 px-3 font-medium text-right">Distance</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportRecords.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                        No matching verified attendance records found.
                      </td>
                    </tr>
                  ) : (
                    reportRecords.map((r) => {
                      const dt = formatDateTime(r.marked_at);
                      return (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="py-2.5 pr-3">
                            <button
                              type="button"
                              onClick={() =>
                                r.student_id &&
                                openStudentHistory(
                                  r.student_id,
                                  r.student_name || '',
                                  r.registration_number || ''
                                )
                              }
                              className="font-medium text-blue-700 hover:underline text-left"
                            >
                              {r.student_name}
                            </button>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-slate-700">
                            {r.registration_number}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-slate-800">
                            <span className="font-mono font-semibold mr-1">{r.subject_code}</span>
                            {r.subject_name}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-slate-600">
                            {dt.date}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-slate-600">
                            {dt.time}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-slate-600">
                            {Math.round(r.distance_meters)} m
                          </td>
                          <td className="py-2.5 pl-3 text-right text-xs font-semibold text-emerald-700">
                            {r.verification_status}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 pr-3 font-medium">Outcome</th>
                    <th className="py-2.5 px-3 font-medium">Student / Reg No.</th>
                    <th className="py-2.5 px-3 font-medium">Subject</th>
                    <th className="py-2.5 px-3 font-medium">Reason</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportLogs.map((l) => {
                    const dt = formatDateTime(l.created_at);
                    return (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-3 text-xs font-semibold">
                          {l.outcome === 'accepted' ? (
                            <span className="text-emerald-700">Accepted</span>
                          ) : (
                            <span className="text-red-700">Rejected</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-xs">
                          <div className="font-medium text-slate-900">{l.student_name || '—'}</div>
                          <div className="font-mono text-slate-500">{l.attempted_reg_number}</div>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-700">
                          {l.subject_code ? `${l.subject_code} · ${l.subject_name}` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-700 max-w-md">{l.reason}</td>
                        <td className="py-2.5 pl-3 text-right font-mono text-xs tabular-nums text-slate-500">
                          {dt.date} {dt.time}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* STUDENT MODAL */}
      {studentModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                {studentModal.mode === 'add' ? 'Add Student Account' : 'Edit Student Account'}
              </h3>
              <button
                type="button"
                onClick={() => setStudentModal(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={saveStudent} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    required
                    value={studentModal.name}
                    onChange={(e) => setStudentModal({ ...studentModal, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Registration Number
                  </label>
                  <input
                    required
                    value={studentModal.registration_number}
                    onChange={(e) =>
                      setStudentModal({ ...studentModal, registration_number: e.target.value })
                    }
                    placeholder="REG-2026-006"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={studentModal.email}
                    onChange={(e) => setStudentModal({ ...studentModal, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                  <input
                    required
                    value={studentModal.department}
                    onChange={(e) =>
                      setStudentModal({ ...studentModal, department: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Year of Study
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={studentModal.year_of_study}
                    onChange={(e) =>
                      setStudentModal({ ...studentModal, year_of_study: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {studentModal.mode === 'add' ? 'Password' : 'New Password (optional)'}
                  </label>
                  <input
                    type="password"
                    required={studentModal.mode === 'add'}
                    value={studentModal.password}
                    onChange={(e) => setStudentModal({ ...studentModal, password: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Enrolled Subjects
                </label>
                <div className="grid grid-cols-1 gap-1.5 max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                  {subjects.map((sub) => {
                    const checked = studentModal.subject_ids.includes(sub.id);
                    return (
                      <label key={sub.id} className="flex items-center gap-2 text-xs text-slate-800">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...studentModal.subject_ids, sub.id]
                              : studentModal.subject_ids.filter((id) => id !== sub.id);
                            setStudentModal({ ...studentModal, subject_ids: next });
                          }}
                        />
                        <span className="font-mono font-semibold text-blue-700">{sub.code}</span>
                        <span>{sub.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStudentModal(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold"
                >
                  Save Student
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LECTURER MODAL */}
      {lecturerModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                {lecturerModal.mode === 'add' ? 'Add Lecturer Account' : 'Edit Lecturer Account'}
              </h3>
              <button
                type="button"
                onClick={() => setLecturerModal(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={saveLecturer} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  required
                  value={lecturerModal.name}
                  onChange={(e) => setLecturerModal({ ...lecturerModal, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Staff ID</label>
                  <input
                    required
                    value={lecturerModal.staff_id}
                    onChange={(e) =>
                      setLecturerModal({ ...lecturerModal, staff_id: e.target.value })
                    }
                    placeholder="LEC-103"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                  <input
                    required
                    value={lecturerModal.department}
                    onChange={(e) =>
                      setLecturerModal({ ...lecturerModal, department: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={lecturerModal.email}
                  onChange={(e) => setLecturerModal({ ...lecturerModal, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {lecturerModal.mode === 'add' ? 'Password' : 'New Password (optional)'}
                </label>
                <input
                  type="password"
                  required={lecturerModal.mode === 'add'}
                  value={lecturerModal.password}
                  onChange={(e) => setLecturerModal({ ...lecturerModal, password: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setLecturerModal(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold"
                >
                  Save Lecturer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUBJECT MODAL */}
      {subjectModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                {subjectModal.mode === 'add' ? 'Add Subject' : 'Edit Subject'}
              </h3>
              <button
                type="button"
                onClick={() => setSubjectModal(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={saveSubject} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Code</label>
                  <input
                    required
                    value={subjectModal.code}
                    onChange={(e) => setSubjectModal({ ...subjectModal, code: e.target.value })}
                    placeholder="FC105"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Subject Name
                  </label>
                  <input
                    required
                    value={subjectModal.name}
                    onChange={(e) => setSubjectModal({ ...subjectModal, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                <input
                  required
                  value={subjectModal.department}
                  onChange={(e) => setSubjectModal({ ...subjectModal, department: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Assign Lecturer
                  </label>
                  <select
                    value={subjectModal.lecturer_id}
                    onChange={(e) =>
                      setSubjectModal({ ...subjectModal, lecturer_id: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">Unassigned</option>
                    {lecturers.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.staff_id})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Default Classroom
                  </label>
                  <select
                    value={subjectModal.default_classroom_id}
                    onChange={(e) =>
                      setSubjectModal({ ...subjectModal, default_classroom_id: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">None</option>
                    {classrooms.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.building})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Enrolled Students
                </label>
                <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                  {students.map((st) => {
                    const checked = subjectModal.student_ids.includes(st.id);
                    return (
                      <label key={st.id} className="flex items-center gap-2 text-xs text-slate-800">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...subjectModal.student_ids, st.id]
                              : subjectModal.student_ids.filter((id) => id !== st.id);
                            setSubjectModal({ ...subjectModal, student_ids: next });
                          }}
                        />
                        <span className="font-mono text-slate-600">{st.registration_number}</span>
                        <span>{st.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSubjectModal(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold"
                >
                  Save Subject
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CLASSROOM MODAL */}
      {classroomModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                {classroomModal.mode === 'add' ? 'Add Classroom' : 'Edit Classroom'}
              </h3>
              <button
                type="button"
                onClick={() => setClassroomModal(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={saveClassroom} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Room Name</label>
                  <input
                    required
                    value={classroomModal.name}
                    onChange={(e) => setClassroomModal({ ...classroomModal, name: e.target.value })}
                    placeholder="Lab 301"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Building</label>
                  <input
                    required
                    value={classroomModal.building}
                    onChange={(e) =>
                      setClassroomModal({ ...classroomModal, building: e.target.value })
                    }
                    placeholder="Turing Building"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-600" />
                    Classroom GPS Coordinates
                  </span>
                  <button
                    type="button"
                    onClick={useCurrentGpsForClassroom}
                    disabled={locatingRoom}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>{locatingRoom ? 'Locating...' : 'Use My Location'}</span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={classroomModal.latitude}
                      onChange={(e) =>
                        setClassroomModal({ ...classroomModal, latitude: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Longitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={classroomModal.longitude}
                      onChange={(e) =>
                        setClassroomModal({ ...classroomModal, longitude: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Permitted Radius (meters)
                </label>
                <input
                  type="number"
                  min={10}
                  max={1000}
                  required
                  value={classroomModal.permitted_radius_meters}
                  onChange={(e) =>
                    setClassroomModal({
                      ...classroomModal,
                      permitted_radius_meters: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setClassroomModal(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold"
                >
                  Save Classroom
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INDIVIDUAL STUDENT ATTENDANCE HISTORY MODAL */}
      {studentHistoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-slate-900">
                  {studentHistoryModal.name}
                </h3>
                <p className="text-xs font-mono text-slate-500">
                  {studentHistoryModal.regNumber} · {studentHistoryModal.records.length} verified sessions
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStudentHistoryModal(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2 pr-3 font-medium">Subject</th>
                  <th className="py-2 px-3 font-medium">Classroom</th>
                  <th className="py-2 px-3 font-medium">Date & Time</th>
                  <th className="py-2 pl-3 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {studentHistoryModal.records.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-xs text-slate-500">
                      No verified attendance submissions yet.
                    </td>
                  </tr>
                ) : (
                  studentHistoryModal.records.map((rec) => {
                    const dt = formatDateTime(rec.marked_at);
                    return (
                      <tr key={rec.id}>
                        <td className="py-2.5 pr-3 text-xs">
                          <span className="font-mono font-semibold mr-1">{rec.subject_code}</span>
                          {rec.subject_name}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-600">{rec.classroom_name}</td>
                        <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-slate-600">
                          {dt.date} · {dt.time}
                        </td>
                        <td className="py-2.5 pl-3 text-right text-xs font-semibold text-emerald-700">
                          {rec.verification_status}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
