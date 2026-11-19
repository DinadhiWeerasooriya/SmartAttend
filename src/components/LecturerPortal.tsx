import React, { useEffect, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  Play,
  Square,
  RefreshCw,
  QrCode,
  Users,
  Clock,
  Download,
  Search,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  X,
  BookOpen,
} from 'lucide-react';
import { apiFetch, downloadCsvReport, formatDateTime } from '../utils/api';
import type { Classroom, Subject, AttendanceRecord, ActiveQrData } from '../types';
import { SubjectGroupedRecords } from './SubjectGroupedRecords';

export type LecturerTab = 'dashboard' | 'live-session' | 'reports';

interface LecturerPortalProps {
  activeTab: LecturerTab;
  onNavigate: (tab: LecturerTab) => void;
  realtimeEvent: { type: string; data: any; ts: number } | null;
}

export const LecturerPortal: React.FC<LecturerPortalProps> = ({
  activeTab,
  onNavigate,
  realtimeEvent,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [assignedSubjects, setAssignedSubjects] = useState<Subject[]>([]);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);

  // Start Session Modal
  const [startModalSubject, setStartModalSubject] = useState<Subject | null>(null);
  const [selectedClassroomId, setSelectedClassroomId] = useState<string>('');

  // Live Session State
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [sessionDetail, setSessionDetail] = useState<any | null>(null);
  const [activeQr, setActiveQr] = useState<ActiveQrData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [secondsLeft, setSecondsLeft] = useState<number>(30);
  const [attendees, setAttendees] = useState<any[]>([]);
  const [rejectedAttempts, setRejectedAttempts] = useState<any[]>([]);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [rotatingQr, setRotatingQr] = useState(false);

  // History & Reports State
  const [pastSessions, setPastSessions] = useState<any[]>([]);
  const [reportRecords, setReportRecords] = useState<AttendanceRecord[]>([]);
  const [filterSubjectId, setFilterSubjectId] = useState<string>('');
  const [filterDate, setFilterDate] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [recordsViewMode, setRecordsViewMode] = useState<'by-subject' | 'all'>('by-subject');
  const [studentHistoryModal, setStudentHistoryModal] = useState<{
    name: string;
    regNumber: string;
    records: AttendanceRecord[];
  } | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/lecturer/dashboard');
      setAssignedSubjects(res.assignedSubjects);
      setActiveSessions(res.activeSessions);
      setRecentActivity(res.recentActivity);
      setClassrooms(res.classrooms);
      if (!selectedSessionId && res.activeSessions.length > 0) {
        setSelectedSessionId(res.activeSessions[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load lecturer dashboard.');
    } finally {
      setLoading(false);
    }
  }, [selectedSessionId]);

  const loadSessionDetail = useCallback(async (sessionId: number) => {
    try {
      const res = await apiFetch(`/api/lecturer/sessions/${sessionId}`);
      setSessionDetail(res.session);
      setActiveQr(res.activeQr);
      setAttendees(res.attendees);
      setRejectedAttempts(
        res.rejectedAttempts ??
          (res.verificationAttempts || []).filter((v: any) => v.outcome === 'rejected')
      );
    } catch (err: any) {
      setError(err.message || 'Failed to load session details.');
    }
  }, []);

  const loadReportsAndHistory = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterSubjectId) params.set('subjectId', filterSubjectId);
      if (filterDate) params.set('date', filterDate);
      if (filterSearch.trim()) params.set('search', filterSearch.trim());

      const [sesRes, recRes] = await Promise.all([
        apiFetch('/api/lecturer/sessions'),
        apiFetch(`/api/lecturer/attendance?${params.toString()}`),
      ]);
      setPastSessions(sesRes.sessions);
      setReportRecords(recRes.records);
    } catch (err: any) {
      setError(err.message || 'Failed to load attendance history.');
    }
  }, [filterSubjectId, filterDate, filterSearch]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (selectedSessionId) {
      loadSessionDetail(selectedSessionId);
    }
  }, [selectedSessionId, loadSessionDetail]);

  useEffect(() => {
    if (activeTab === 'reports') {
      loadReportsAndHistory();
    }
  }, [activeTab, loadReportsAndHistory]);

  // Render QR Code DataURL whenever activeQr changes
  useEffect(() => {
    if (!activeQr?.payload) {
      setQrDataUrl('');
      return;
    }
    QRCode.toDataURL(activeQr.payload, {
      width: 280,
      margin: 2,
      color: { dark: '#081221', light: '#FFFFFF' },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [activeQr?.payload]);

  const refreshQrToken = useCallback(
    async (sessionId: number) => {
      if (rotatingQr) return;
      setRotatingQr(true);
      try {
        const res = await apiFetch(`/api/lecturer/sessions/${sessionId}/refresh-qr`, {
          method: 'POST',
        });
        setActiveQr(res.qr);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setRotatingQr(false);
      }
    },
    [rotatingQr]
  );

  // 30-second countdown timer & automatic renewal
  useEffect(() => {
    if (!sessionDetail || sessionDetail.status !== 'active' || !activeQr?.expiresAt) {
      return;
    }

    const updateTimer = () => {
      const remainingMs = new Date(activeQr.expiresAt).getTime() - Date.now();
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      setSecondsLeft(remainingSec);

      if (remainingMs <= 0 && selectedSessionId && !rotatingQr) {
        refreshQrToken(selectedSessionId);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 500);
    return () => clearInterval(interval);
  }, [sessionDetail, activeQr, selectedSessionId, rotatingQr, refreshQrToken]);

  // Real-time WebSocket updates for live attendance list & verification attempts
  useEffect(() => {
    if (!realtimeEvent) return;
    if (realtimeEvent.type === 'attendance:marked') {
      const { sessionId, record } = realtimeEvent.data;
      if (sessionId === selectedSessionId) {
        setAttendees((prev) => {
          if (prev.some((a) => a.id === record.id)) return prev;
          return [record, ...prev];
        });
      }
      loadDashboard();
    } else if (realtimeEvent.type === 'verification:logged') {
      const item = realtimeEvent.data;
      if (item.sessionId === selectedSessionId && item.outcome === 'rejected') {
        setRejectedAttempts((prev) => [
          {
            id: Date.now(),
            student_name: item.studentName,
            registration_number: item.registrationNumber,
            attempted_reg_number: item.registrationNumber,
            outcome: item.outcome,
            reason: item.reason,
            created_at: item.createdAt,
          },
          ...prev,
        ]);
      }
    }
  }, [realtimeEvent, selectedSessionId, loadDashboard]);

  const handleStartSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startModalSubject) return;
    try {
      const res = await apiFetch('/api/lecturer/sessions', {
        method: 'POST',
        body: JSON.stringify({
          subjectId: startModalSubject.id,
          classroomId: selectedClassroomId ? Number(selectedClassroomId) : undefined,
        }),
      });
      setStartModalSubject(null);
      setSelectedSessionId(res.sessionId);
      setActiveQr(res.qr);
      await loadDashboard();
      await loadSessionDetail(res.sessionId);
      onNavigate('live-session');
      showToast('Attendance session started. Dynamic QR code is live.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleEndSession = async () => {
    if (!selectedSessionId) return;
    try {
      await apiFetch(`/api/lecturer/sessions/${selectedSessionId}/end`, { method: 'POST' });
      showToast('Attendance session ended. All QR codes expired.');
      await loadDashboard();
      await loadSessionDetail(selectedSessionId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const copyQrPayload = async () => {
    if (!activeQr?.payload) return;
    try {
      await navigator.clipboard.writeText(activeQr.payload);
      setCopiedPayload(true);
      setTimeout(() => setCopiedPayload(false), 2000);
    } catch {
      showToast(`QR Code: ${activeQr.payload}`);
    }
  };

  const handleDownloadCsv = async () => {
    try {
      const params = new URLSearchParams();
      if (filterSubjectId) params.set('subjectId', filterSubjectId);
      if (filterDate) params.set('date', filterDate);
      if (filterSearch.trim()) params.set('search', filterSearch.trim());
      await downloadCsvReport(
        `/api/lecturer/reports/csv?${params.toString()}`,
        `smartattend-lecturer-report-${new Date().toISOString().slice(0, 10)}.csv`
      );
      showToast('Attendance report downloaded.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const openStudentHistory = (studentName: string, regNumber: string) => {
    const filtered = reportRecords.filter(
      (r) => r.registration_number === regNumber
    );
    setStudentHistoryModal({
      name: studentName,
      regNumber,
      records: filtered,
    });
  };

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
          {/* Active Sessions Banner if any */}
          {activeSessions.length > 0 && (
            <div className="bg-navy-950 text-white rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-blue-300">Active Attendance Session</div>
                <h2 className="font-display text-xl font-bold mt-1">
                  {activeSessions[0].subject_code} — {activeSessions[0].subject_name}
                </h2>
                <p className="text-xs text-slate-300 mt-1">
                  {activeSessions[0].classroom_name} ({activeSessions[0].classroom_building}) ·{' '}
                  <span className="font-mono tabular-nums font-semibold text-white">
                    {activeSessions[0].attendee_count} students marked
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedSessionId(activeSessions[0].id);
                  onNavigate('live-session');
                }}
                className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap self-start md:self-center"
              >
                <QrCode className="w-4 h-4" />
                <span>Open Live QR Display</span>
              </button>
            </div>
          )}

          {/* Assigned Subjects */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Assigned Subjects
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Start an attendance session to generate a dynamic 30-second QR code.
                </p>
              </div>
            </div>

            {loading ? (
              <div className="py-8 text-sm text-slate-500">Loading assigned subjects...</div>
            ) : assignedSubjects.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                No subjects assigned to your account yet. Contact an administrator.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {assignedSubjects.map((sub) => {
                  const running = activeSessions.find((s) => s.subject_id === sub.id);
                  return (
                    <div
                      key={sub.id}
                      className="border border-slate-200 rounded-xl p-5 flex flex-col justify-between bg-slate-50/40"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-semibold text-blue-700">
                            {sub.code}
                          </span>
                          <span className="text-xs text-slate-500 font-mono tabular-nums">
                            {sub.enrolled_count} enrolled
                          </span>
                        </div>
                        <h3 className="font-display text-base font-semibold text-slate-900 mt-1.5">
                          {sub.name}
                        </h3>
                        <p className="text-xs text-slate-600 mt-1">
                          {sub.classroom_name
                            ? `${sub.classroom_name} (${sub.classroom_building})`
                            : 'No default room'}
                          {sub.permitted_radius_meters
                            ? ` · ${sub.permitted_radius_meters}m radius`
                            : ''}
                        </p>
                      </div>

                      <div className="mt-5 pt-4 border-t border-slate-200 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500 font-mono tabular-nums">
                          {sub.total_sessions} sessions
                        </span>
                        {running ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSessionId(running.id);
                              onNavigate('live-session');
                            }}
                            className="px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>View Active QR ({running.attendee_count})</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setStartModalSubject(sub);
                              setSelectedClassroomId(
                                sub.default_classroom_id
                                  ? String(sub.default_classroom_id)
                                  : classrooms[0]?.id
                                  ? String(classrooms[0].id)
                                  : ''
                              );
                            }}
                            className="px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>Start Session</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Attendance Activity */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Recent Attendance Activity
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Students who recently verified attendance in your lectures
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-semibold text-blue-700 hover:underline"
              >
                View history & reports
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">Student</th>
                    <th className="py-2 px-3 font-medium">Reg. Number</th>
                    <th className="py-2 px-3 font-medium">Subject</th>
                    <th className="py-2 pl-3 font-medium text-right">Marked At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentActivity.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-xs text-slate-500">
                        No recent attendance submissions yet.
                      </td>
                    </tr>
                  ) : (
                    recentActivity.map((item) => {
                      const dt = formatDateTime(item.marked_at);
                      return (
                        <tr key={item.id}>
                          <td className="py-2.5 pr-3 font-medium text-slate-900">
                            {item.student_name}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs text-slate-600">
                            {item.registration_number}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-slate-700">
                            <span className="font-mono font-semibold mr-1">{item.subject_code}</span>
                            {item.subject_name}
                          </td>
                          <td className="py-2.5 pl-3 text-right font-mono text-xs tabular-nums text-slate-500">
                            {dt.date} · {dt.time}
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
      )}

      {/* LIVE QR SESSION TAB */}
      {activeTab === 'live-session' && (
        <div className="space-y-6">
          {!sessionDetail ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
              <BookOpen className="w-10 h-10 text-slate-300 mx-auto" />
              <h2 className="font-display text-lg font-semibold text-slate-900 mt-3">
                No Attendance Session Selected
              </h2>
              <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                Start a new attendance session from one of your assigned subjects to display the dynamic 30-second QR code.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                className="mt-5 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold"
              >
                Go to Assigned Subjects
              </button>
            </div>
          ) : (
            <>
              {/* Session Header */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <span className="font-mono font-semibold text-blue-700">
                      {sessionDetail.subject_code}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        sessionDetail.status === 'active'
                          ? 'text-emerald-700 font-semibold'
                          : 'text-slate-500 font-semibold'
                      }
                    >
                      {sessionDetail.status === 'active' ? 'Session Active' : 'Session Ended'}
                    </span>
                  </div>
                  <h2 className="font-display text-xl font-bold text-slate-900 mt-1">
                    {sessionDetail.subject_name}
                  </h2>
                  <p className="text-xs text-slate-600 mt-1">
                    {sessionDetail.classroom_name} ({sessionDetail.classroom_building}) · Permitted radius:{' '}
                    <span className="font-mono">{sessionDetail.permitted_radius_meters}m</span>
                  </p>
                </div>

                {sessionDetail.status === 'active' && (
                  <button
                    type="button"
                    onClick={handleEndSession}
                    className="px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap self-start md:self-center"
                  >
                    <Square className="w-4 h-4" />
                    <span>End Attendance Session</span>
                  </button>
                )}
              </div>

              {/* Dynamic QR + Countdown + Live Attendees */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: QR Code & 30-Second Countdown Timer */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col items-center">
                  {sessionDetail.status === 'active' && activeQr ? (
                    <>
                      <div className="w-full flex items-center justify-between pb-4 border-b border-slate-100">
                        <span className="text-sm font-semibold text-slate-900">
                          Dynamic Session QR
                        </span>
                        <div className="flex items-center gap-1.5 font-mono text-sm font-bold tabular-nums text-blue-700">
                          <Clock className="w-4 h-4" />
                          <span>{secondsLeft}s</span>
                        </div>
                      </div>

                      {/* QR + Timer side by side on wider cards */}
                      <div className="mt-6 flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-6 w-full justify-center">
                        <div className="p-3 bg-white border border-slate-200 rounded-xl shrink-0">
                          {qrDataUrl ? (
                            <img
                              src={qrDataUrl}
                              alt="SmartAttend Dynamic QR Code"
                              className="w-48 h-48 sm:w-56 sm:h-56 block"
                            />
                          ) : (
                            <div className="w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center text-xs text-slate-400">
                              Generating QR...
                            </div>
                          )}
                        </div>

                        {/* 30-second countdown beside QR */}
                        <div className="flex flex-col items-center sm:items-start lg:items-center xl:items-start text-center sm:text-left lg:text-center xl:text-left">
                          <div className="text-xs font-medium text-slate-500">
                            Expires & Renews In
                          </div>
                          <div className="font-mono text-4xl font-bold tabular-nums text-navy-950 mt-1">
                            {String(secondsLeft).padStart(2, '0')}s
                          </div>
                          <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden mt-3">
                            <div
                              className="h-full bg-blue-600 transition-all duration-300"
                              style={{ width: `${Math.round((secondsLeft / 30) * 100)}%` }}
                            />
                          </div>
                          <p className="text-xs text-slate-500 mt-3 max-w-[180px] leading-relaxed">
                            Previous QR codes expire automatically as soon as a new one is generated.
                          </p>
                        </div>
                      </div>

                      <div className="mt-6 pt-4 border-t border-slate-100 w-full flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => selectedSessionId && refreshQrToken(selectedSessionId)}
                          disabled={rotatingQr}
                          className="min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${rotatingQr ? 'animate-spin' : ''}`} />
                          <span>Rotate QR Now</span>
                        </button>

                        <button
                          type="button"
                          onClick={copyQrPayload}
                          className="min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
                        >
                          {copiedPayload ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Copied QR String</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy QR Payload</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="mt-2 w-full text-[11px] font-mono text-slate-400 truncate text-center">
                        Token: {activeQr.payload}
                      </div>
                    </>
                  ) : (
                    <div className="py-12 text-center">
                      <QrCode className="w-10 h-10 text-slate-300 mx-auto" />
                      <div className="mt-3 text-sm font-semibold text-slate-800">
                        This attendance session has ended
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        QR code generation is stopped and all prior tokens are invalidated.
                      </p>
                    </div>
                  )}
                </div>

                {/* Right: Accepted Attendance + Rejected Attempts */}
                <div className="lg:col-span-7 space-y-6">
                  {/* Section 1: Accepted Attendance */}
                  <div className="bg-white border border-slate-200 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span>Accepted Attendance</span>
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Students who successfully completed attendance verification
                        </p>
                      </div>
                      <div className="font-mono text-lg font-bold tabular-nums text-emerald-700">
                        {attendees.length} Present
                      </div>
                    </div>

                    <div className="overflow-x-auto max-h-72 overflow-y-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs text-slate-500">
                            <th className="py-2 pr-3 font-medium">Student Name</th>
                            <th className="py-2 px-3 font-medium">Reg. Number</th>
                            <th className="py-2 px-3 font-medium text-right">Distance</th>
                            <th className="py-2 pl-3 font-medium text-right">Verified Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {attendees.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="py-8 text-center text-xs text-slate-500">
                                Waiting for students to scan the QR code...
                              </td>
                            </tr>
                          ) : (
                            attendees.map((att) => {
                              const dt = formatDateTime(att.marked_at);
                              return (
                                <tr key={att.id}>
                                  <td className="py-2.5 pr-3 font-medium text-slate-900">
                                    {att.student_name}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-xs text-slate-700">
                                    {att.registration_number}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-slate-600">
                                    {Math.round(att.distance_meters)} m
                                  </td>
                                  <td className="py-2.5 pl-3 text-right font-mono text-xs tabular-nums text-emerald-700 font-medium">
                                    {dt.time}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Section 2: Rejected Attempts (from verification_logs) */}
                  <div className="bg-white border border-red-200 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                          <XCircle className="w-4 h-4 text-red-600" />
                          <span>Rejected Attempts</span>
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Students whose attendance attempts were rejected (not counted as present)
                        </p>
                      </div>
                      <div className="font-mono text-lg font-bold tabular-nums text-red-700">
                        {rejectedAttempts.length} Rejected
                      </div>
                    </div>

                    <div className="overflow-x-auto max-h-72 overflow-y-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs text-slate-500">
                            <th className="py-2 pr-3 font-medium">Student</th>
                            <th className="py-2 px-3 font-medium">Reg. Number</th>
                            <th className="py-2 px-3 font-medium">Date &amp; Time</th>
                            <th className="py-2 px-3 font-medium">Rejection Reason</th>
                            <th className="py-2 pl-3 font-medium text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rejectedAttempts.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-6 text-center text-xs text-slate-500">
                                No rejected attendance attempts for this session.
                              </td>
                            </tr>
                          ) : (
                            rejectedAttempts.map((log) => {
                              const dt = formatDateTime(log.created_at);
                              const regNo = log.registration_number || log.attempted_reg_number || '—';
                              return (
                                <tr key={log.id} className="align-top">
                                  <td className="py-2.5 pr-3 font-medium text-slate-900 whitespace-nowrap">
                                    {log.student_name || 'Unknown Student'}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-xs text-slate-700 whitespace-nowrap">
                                    {regNo}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                                    <div>{dt.date}</div>
                                    <div className="text-slate-400">{dt.time}</div>
                                  </td>
                                  <td className="py-2.5 px-3 text-xs text-red-700">
                                    {log.reason || 'Verification failed'}
                                  </td>
                                  <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                                      Rejected
                                    </span>
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
              </div>
            </>
          )}
        </div>
      )}

      {/* HISTORY & REPORTS TAB */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          {/* Session History */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="font-display text-lg font-semibold text-slate-900 mb-4">
              Attendance Session History
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">Subject</th>
                    <th className="py-2 px-3 font-medium">Classroom</th>
                    <th className="py-2 px-3 font-medium">Started</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                    <th className="py-2 px-3 font-medium text-right">Marked Present</th>
                    <th className="py-2 pl-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pastSessions.map((ses) => {
                    const dt = formatDateTime(ses.started_at);
                    return (
                      <tr key={ses.id} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-3 text-xs">
                          <span className="font-mono font-semibold text-blue-700 mr-1.5">
                            {ses.subject_code}
                          </span>
                          <span className="font-medium text-slate-900">{ses.subject_name}</span>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-700">{ses.classroom_name}</td>
                        <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-slate-600">
                          {dt.date} · {dt.time}
                        </td>
                        <td className="py-2.5 px-3 text-xs font-semibold">
                          {ses.status === 'active' ? (
                            <span className="text-emerald-700">Active</span>
                          ) : (
                            <span className="text-slate-500">Ended</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-slate-800">
                          {ses.attendee_count}
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSessionId(ses.id);
                              onNavigate('live-session');
                            }}
                            className="text-xs font-semibold text-blue-700 hover:underline"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Filterable Attendance Records & CSV Download */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Verified Attendance Records
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Only students who successfully marked attendance are recorded.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold whitespace-nowrap self-start"
              >
                <Download className="w-4 h-4" />
                <span>Download CSV Report</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setRecordsViewMode('by-subject')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    recordsViewMode === 'by-subject'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  By Subject
                </button>
                <button
                  type="button"
                  onClick={() => setRecordsViewMode('all')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    recordsViewMode === 'all'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Records
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  placeholder="Search student or reg no."
                  className="pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900"
                />
              </div>
              <select
                value={filterSubjectId}
                onChange={(e) => setFilterSubjectId(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white"
              >
                <option value="">All Assigned Subjects</option>
                {assignedSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900"
              />
              </div>
            </div>

            {recordsViewMode === 'by-subject' ? (
              <SubjectGroupedRecords
                records={reportRecords}
                showStudentColumn
                onSelectStudent={(r) =>
                  openStudentHistory(r.student_name || '', r.registration_number || '')
                }
                emptyMessage="No matching verified attendance records found."
              />
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 pr-3 font-medium">Student Name</th>
                    <th className="py-2.5 px-3 font-medium">Reg. Number</th>
                    <th className="py-2.5 px-3 font-medium">Subject</th>
                    <th className="py-2.5 px-3 font-medium">Date</th>
                    <th className="py-2.5 px-3 font-medium">Time</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportRecords.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
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
                                openStudentHistory(
                                  r.student_name || '',
                                  r.registration_number || ''
                                )
                              }
                              className="font-medium text-blue-700 hover:underline text-left"
                            >
                              {r.student_name}
                            </button>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs text-slate-700">
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
            )}
          </div>
        </div>
      )}

      {/* START SESSION MODAL */}
      {startModalSubject && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                Start Attendance Session
              </h3>
              <button
                type="button"
                onClick={() => setStartModalSubject(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleStartSession} className="space-y-4">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-mono text-xs font-semibold text-blue-700">
                  {startModalSubject.code}
                </div>
                <div className="text-sm font-semibold text-slate-900 mt-0.5">
                  {startModalSubject.name}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Select Classroom for Location Verification
                </label>
                <select
                  required
                  value={selectedClassroomId}
                  onChange={(e) => setSelectedClassroomId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.building}) — {c.permitted_radius_meters}m radius
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStartModalSubject(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold"
                >
                  Start & Generate QR
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INDIVIDUAL STUDENT HISTORY MODAL */}
      {studentHistoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-slate-900">
                  {studentHistoryModal.name}
                </h3>
                <p className="text-xs font-mono text-slate-500">
                  {studentHistoryModal.regNumber} · {studentHistoryModal.records.length} verified records
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
                  <th className="py-2 px-3 font-medium">Date & Time</th>
                  <th className="py-2 pl-3 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {studentHistoryModal.records.map((rec) => {
                  const dt = formatDateTime(rec.marked_at);
                  return (
                    <tr key={rec.id}>
                      <td className="py-2.5 pr-3 text-xs">
                        <span className="font-mono font-semibold mr-1">{rec.subject_code}</span>
                        {rec.subject_name}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-slate-600">
                        {dt.date} · {dt.time}
                      </td>
                      <td className="py-2.5 pl-3 text-right text-xs font-semibold text-emerald-700">
                        {rec.verification_status}
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
  );
};
