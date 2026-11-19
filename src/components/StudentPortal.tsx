import React, { useEffect, useState, useRef, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  QrCode,
  Camera,
  Upload,
  MapPin,
  CheckCircle2,
  XCircle,
  BookOpen,
  History,
  Bell,
  Loader2,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import { apiFetch, formatDateTime } from '../utils/api';
import { getOrCreateDeviceId } from '../utils/device';
import type { AuthUser, Subject, AttendanceRecord, NotificationItem, VerificationLog } from '../types';
import { SubjectGroupedRecords } from './SubjectGroupedRecords';

export type StudentTab = 'dashboard' | 'scan' | 'history';

interface StudentPortalProps {
  user: AuthUser;
  activeTab: StudentTab;
  onNavigate: (tab: StudentTab) => void;
  notifications: NotificationItem[];
  onRefreshNotifications: () => void;
}

type ScanFlowState =
  | { step: 'idle' }
  | { step: 'location-prompt'; qrPayload: string }
  | { step: 'locating'; qrPayload: string }
  | { step: 'submitting'; qrPayload: string }
  | {
      step: 'accepted';
      message: string;
      record: {
        subjectCode: string;
        subjectName: string;
        classroomName: string;
        date: string;
        time: string;
        distanceMeters: number;
      };
    }
  | {
      step: 'rejected';
      code: string;
      reason: string;
      subject: string | null;
    };

export const StudentPortal: React.FC<StudentPortalProps> = ({
  user,
  activeTab,
  onNavigate,
  notifications,
  onRefreshNotifications,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [studentProfile, setStudentProfile] = useState<any>(null);
  const [enrolledSubjects, setEnrolledSubjects] = useState<Subject[]>([]);
  const [recentRecords, setRecentRecords] = useState<AttendanceRecord[]>([]);
  const [allRecords, setAllRecords] = useState<AttendanceRecord[]>([]);
  const [verificationHistory, setVerificationHistory] = useState<VerificationLog[]>([]);
  const [totalAttended, setTotalAttended] = useState<number>(0);
  const [historyViewMode, setHistoryViewMode] = useState<'by-subject' | 'all'>('by-subject');

  // QR Scanner State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualQrInput, setManualQrInput] = useState('');
  const [flowState, setFlowState] = useState<ScanFlowState>({ step: 'idle' });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const deviceId = getOrCreateDeviceId();

  const loadStudentData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, hist] = await Promise.all([
        apiFetch('/api/student/dashboard'),
        apiFetch('/api/student/attendance'),
      ]);
      setStudentProfile(dash.student);
      setEnrolledSubjects(dash.enrolledSubjects);
      setRecentRecords(dash.recentRecords);
      setTotalAttended(dash.totalAttended);
      setVerificationHistory(dash.verificationHistory);
      setAllRecords(hist.records);
    } catch (err: any) {
      setError(err.message || 'Failed to load student data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStudentData();
  }, [loadStudentData]);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (activeTab !== 'scan') {
      stopCamera();
    }
  }, [activeTab, stopCamera]);

  const handleQrDetected = useCallback(
    (payload: string) => {
      stopCamera();
      setFlowState({ step: 'location-prompt', qrPayload: payload.trim() });
    },
    [stopCamera]
  );

  const lastScanRef = useRef<number>(0);

  const scanVideoFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    const now = performance.now();
    if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0 && now - lastScanRef.current >= 80) {
      lastScanRef.current = now;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (code && code.data) {
          handleQrDetected(code.data);
          return;
        }
      }
    }
    animFrameRef.current = requestAnimationFrame(scanVideoFrame);
  }, [handleQrDetected]);

  useEffect(() => {
    if (!cameraActive || !streamRef.current || !videoRef.current) return;
    const video = videoRef.current;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    video.srcObject = streamRef.current;

    const onReady = () => {
      video.play().catch(() => {});
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(scanVideoFrame);
    };

    if (video.readyState >= 1) {
      onReady();
    } else {
      video.onloadedmetadata = onReady;
    }

    return () => {
      video.onloadedmetadata = null;
    };
  }, [cameraActive, scanVideoFrame]);

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Camera access is unavailable in this browser context (HTTPS or localhost is required). Use QR image upload or paste the QR payload below.'
      );
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (constraintErr: any) {
        if (constraintErr?.name === 'OverconstrainedError' || constraintErr?.name === 'NotFoundError') {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } else {
          throw constraintErr;
        }
      }
      streamRef.current = stream;
      setCameraActive(true);
    } catch (err: any) {
      setCameraError(
        err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
          ? 'Camera permission denied. Enable camera access in your browser or iOS/Android site settings, or upload a QR image below.'
          : 'Unable to access camera. You can upload a QR image or paste the QR payload below.'
      );
    }
  };

  const handleQrImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCameraError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imgData.data, imgData.width, imgData.height);
        if (decoded && decoded.data) {
          handleQrDetected(decoded.data);
        } else {
          setCameraError('No valid QR code found in the selected image.');
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const submitAttendanceWithCoords = async (
    qrPayload: string,
    coords: { latitude?: number; longitude?: number; accuracy?: number; locationError?: string }
  ) => {
    setFlowState({ step: 'submitting', qrPayload });
    try {
      const res = await apiFetch('/api/student/attendance/mark', {
        method: 'POST',
        body: JSON.stringify({
          qrPayload,
          deviceId,
          ...coords,
        }),
      });
      setFlowState({
        step: 'accepted',
        message: res.message || 'Attendance Marked Successfully!',
        record: res.record,
      });
      loadStudentData();
      onRefreshNotifications();
    } catch (err: any) {
      const payload = err.payload || {};
      setFlowState({
        step: 'rejected',
        code: payload.code || 'REJECTED',
        reason: payload.reason || err.message || 'Attendance could not be verified.',
        subject: payload.subject || null,
      });
      loadStudentData();
      onRefreshNotifications();
    }
  };

  const requestLocationAndSubmit = () => {
    if (flowState.step !== 'location-prompt') return;
    const qrPayload = flowState.qrPayload;

    if (!navigator.geolocation) {
      submitAttendanceWithCoords(qrPayload, { locationError: 'POSITION_UNAVAILABLE' });
      return;
    }

    setFlowState({ step: 'locating', qrPayload });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        submitAttendanceWithCoords(qrPayload, {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (geoErr) => {
        const errorCode =
          geoErr.code === geoErr.PERMISSION_DENIED
            ? 'PERMISSION_DENIED'
            : geoErr.code === geoErr.TIMEOUT
            ? 'TIMEOUT'
            : 'POSITION_UNAVAILABLE';
        submitAttendanceWithCoords(qrPayload, { locationError: errorCode });
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  };

  const regNumber =
    studentProfile?.registration_number ||
    (user.profile && 'registration_number' in user.profile ? user.profile.registration_number : '');

  const deviceMatches =
    !studentProfile?.device_id || studentProfile.device_id === deviceId;

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {/* DASHBOARD TAB */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Student Identity & Primary Action Banner */}
          <div className="bg-navy-950 text-white rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div>
              <div className="text-xs font-mono text-blue-300">{regNumber}</div>
              <h2 className="font-display text-2xl font-bold mt-1">{user.name}</h2>
              <p className="text-xs text-slate-300 mt-1">
                {studentProfile?.department || 'University Student'} · Year{' '}
                {studentProfile?.year_of_study || 1}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setFlowState({ step: 'idle' });
                onNavigate('scan');
              }}
              className="px-5 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap self-start md:self-center"
            >
              <QrCode className="w-4 h-4" />
              <span>Scan Attendance QR</span>
            </button>
          </div>

          {/* Device Association Notice */}
          {!deviceMatches && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 leading-relaxed">
                <span className="font-semibold">Device Mismatch Detected:</span> Your registration number ({regNumber}) is already associated with a different device/browser profile. Attendance submissions from this browser will be rejected to prevent proxy attendance.
              </div>
            </div>
          )}

          {/* Summary Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Sessions Attended</div>
              <div className="font-display text-3xl font-bold text-slate-900 tabular-nums mt-2">
                {loading ? '—' : totalAttended}
              </div>
              <div className="text-xs text-slate-500 mt-1">Verified lecture check-ins</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Enrolled Subjects</div>
              <div className="font-display text-3xl font-bold text-slate-900 tabular-nums mt-2">
                {loading ? '—' : enrolledSubjects.length}
              </div>
              <div className="text-xs text-slate-500 mt-1">Active academic modules</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-blue-600" />
                <span>Device Association</span>
              </div>
              <div className="font-display text-lg font-semibold text-slate-900 mt-2">
                {deviceMatches ? 'Verified Browser Device' : 'Different Device'}
              </div>
              <div className="text-[11px] font-mono text-slate-400 truncate mt-1">
                {deviceId}
              </div>
            </div>
          </div>

          {/* Enrolled Subjects & Recent Attendance */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
              <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2 mb-4">
                <BookOpen className="w-4 h-4 text-blue-600" />
                <span>Enrolled Subjects</span>
              </h3>
              <div className="space-y-3">
                {enrolledSubjects.length === 0 ? (
                  <p className="text-sm text-slate-500">No enrolled subjects found.</p>
                ) : (
                  enrolledSubjects.map((sub) => (
                    <div
                      key={sub.id}
                      className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-semibold text-blue-700">
                          {sub.code}
                        </div>
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {sub.name}
                        </div>
                        <div className="text-xs text-slate-500 truncate mt-0.5">
                          {sub.lecturer_name || 'Lecturer TBA'} · {sub.classroom_name || 'Room TBA'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-base font-bold text-slate-900 tabular-nums">
                          {sub.attended_count ?? 0}
                        </div>
                        <div className="text-[11px] text-slate-500">attended</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                    <History className="w-4 h-4 text-blue-600" />
                    <span>Recent Attendance Records</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => onNavigate('history')}
                    className="text-xs font-semibold text-blue-700 hover:underline"
                  >
                    View all
                  </button>
                </div>

                <div className="overflow-x-auto">
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
                      {recentRecords.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-xs text-slate-500">
                            No verified attendance submissions yet.
                          </td>
                        </tr>
                      ) : (
                        recentRecords.map((rec) => {
                          const dt = formatDateTime(rec.marked_at);
                          return (
                            <tr key={rec.id}>
                              <td className="py-2.5 pr-3 text-xs">
                                <span className="font-mono font-semibold text-blue-700 mr-1">
                                  {rec.subject_code}
                                </span>
                                <span className="font-medium text-slate-900">{rec.subject_name}</span>
                              </td>
                              <td className="py-2.5 px-3 text-xs text-slate-600">
                                {rec.classroom_name}
                              </td>
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

              {/* Recent Notifications on Dashboard */}
              <div className="pt-4 border-t border-slate-100">
                <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-2 mb-3">
                  <Bell className="w-4 h-4 text-blue-600" />
                  <span>Recent Attendance Notifications</span>
                </h3>
                <div className="space-y-2">
                  {notifications.length === 0 ? (
                    <p className="text-xs text-slate-500">No notifications yet.</p>
                  ) : (
                    notifications.slice(0, 4).map((n) => {
                      const dt = formatDateTime(n.created_at);
                      return (
                        <div
                          key={n.id}
                          className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 flex items-start gap-2.5 text-xs"
                        >
                          {n.type === 'accepted' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-900">{n.title}</div>
                            <p className="text-slate-600 mt-0.5">{n.message}</p>
                          </div>
                          <span className="font-mono text-[11px] text-slate-400 shrink-0">
                            {dt.date}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SCAN QR & MARK ATTENDANCE TAB */}
      {activeTab === 'scan' && (
        <div className="max-w-2xl mx-auto space-y-6">
          {/* STEP 1: SCAN QR */}
          {flowState.step === 'idle' && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">
                  Scan Attendance QR Code
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  Scan the 30-second QR code displayed by your lecturer. Location permission will be requested immediately after scanning.
                </p>
              </div>

              {/* Live Camera Viewport */}
              <div className="border border-slate-200 rounded-xl bg-navy-950 overflow-hidden">
                {cameraActive ? (
                  <div className="relative">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      autoPlay
                      className="w-full max-h-80 object-cover block"
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="p-3 bg-navy-900 flex items-center justify-between gap-3 text-xs text-white">
                      <span>Point camera at the SmartAttend QR code...</span>
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="min-h-[40px] px-3.5 py-2 rounded-md bg-slate-700 hover:bg-slate-600 font-semibold shrink-0"
                      >
                        Stop Camera
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 px-6 text-center text-white">
                    <Camera className="w-10 h-10 text-blue-400 mx-auto" />
                    <div className="mt-3 text-sm font-semibold">Camera QR Scanner</div>
                    <p className="text-xs text-slate-300 mt-1 max-w-sm mx-auto">
                      Uses your device camera to decode the dynamic lecture QR code in real time across Android and iOS.
                    </p>
                    <button
                      type="button"
                      onClick={startCamera}
                      className="mt-5 min-h-[44px] px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center gap-2"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Open Camera Scanner</span>
                    </button>
                  </div>
                )}
              </div>

              {cameraError && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  {cameraError}
                </div>
              )}

              {/* Upload QR Image or Paste QR Payload for single-screen / desktop testing */}
              <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50">
                  <div className="text-xs font-semibold text-slate-800 mb-1">
                    Scan from QR Image
                  </div>
                  <p className="text-[11px] text-slate-500 mb-3">
                    Upload a screenshot or image of the session QR code.
                  </p>
                  <label className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Choose QR Image</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleQrImageUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (manualQrInput.trim()) {
                      handleQrDetected(manualQrInput.trim());
                    }
                  }}
                  className="p-4 rounded-lg border border-slate-200 bg-slate-50"
                >
                  <div className="text-xs font-semibold text-slate-800 mb-1">
                    Submit Scanned QR Code String
                  </div>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Paste a copied QR payload (<span className="font-mono">SA1:...</span>) for demonstration.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualQrInput}
                      onChange={(e) => setManualQrInput(e.target.value)}
                      placeholder="SA1:1:..."
                      className="flex-1 min-w-0 min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                    />
                    <button
                      type="submit"
                      className="min-h-[44px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold shrink-0"
                    >
                      Verify
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* STEP 2: LOCATION PROMPT & ACQUISITION */}
          {(flowState.step === 'location-prompt' ||
            flowState.step === 'locating' ||
            flowState.step === 'submitting') && (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-5">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center mx-auto">
                {flowState.step === 'location-prompt' ? (
                  <MapPin className="w-6 h-6" />
                ) : (
                  <Loader2 className="w-6 h-6 animate-spin" />
                )}
              </div>

              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">
                  {flowState.step === 'location-prompt'
                    ? 'Location Verification Required'
                    : flowState.step === 'locating'
                    ? 'Retrieving Your Classroom Location...'
                    : 'Verifying QR Token, Device & Perimeter...'}
                </h2>
                <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto leading-relaxed">
                  {flowState.step === 'location-prompt'
                    ? 'QR code captured. Please turn on location services and grant browser location permission so SmartAttend can verify you are inside the classroom.'
                    : 'Please keep this screen open while we verify your one-time location check.'}
                </p>
              </div>

              <div className="text-xs font-mono text-slate-400">
                QR Payload: {flowState.qrPayload.slice(0, 26)}...
              </div>

              {flowState.step === 'location-prompt' && (
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setFlowState({ step: 'idle' })}
                    className="px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={requestLocationAndSubmit}
                    className="px-5 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold inline-flex items-center gap-2"
                  >
                    <MapPin className="w-4 h-4" />
                    <span>Enable Location & Mark Attendance</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 3A: ACCEPTED RESULT */}
          {flowState.step === 'accepted' && (
            <div className="bg-white border border-emerald-300 rounded-xl p-8 text-center space-y-5">
              <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h2 className="font-display text-2xl font-bold text-emerald-800">
                  {flowState.message}
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  Your attendance has been recorded and an in-app notification was sent.
                </p>
              </div>

              <div className="max-w-sm mx-auto bg-slate-50 border border-slate-200 rounded-xl p-4 text-left space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Subject</span>
                  <span className="font-semibold text-slate-900 text-right">
                    {flowState.record.subjectCode} — {flowState.record.subjectName}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Classroom</span>
                  <span className="font-medium text-slate-800 text-right">
                    {flowState.record.classroomName}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Date</span>
                  <span className="font-mono tabular-nums text-slate-800">
                    {flowState.record.date}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Time</span>
                  <span className="font-mono tabular-nums text-slate-800">
                    {flowState.record.time}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Verified Distance</span>
                  <span className="font-mono tabular-nums text-emerald-700 font-semibold">
                    {flowState.record.distanceMeters} m from room
                  </span>
                </div>
              </div>

              <div className="flex justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onNavigate('dashboard')}
                  className="px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700"
                >
                  Back to Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setManualQrInput('');
                    setFlowState({ step: 'idle' });
                  }}
                  className="px-4 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold"
                >
                  Scan Another Code
                </button>
              </div>
            </div>
          )}

          {/* STEP 3B: REJECTED RESULT */}
          {flowState.step === 'rejected' && (
            <div className="bg-white border border-red-300 rounded-xl p-8 text-center space-y-5">
              <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
                <XCircle className="w-8 h-8" />
              </div>
              <div>
                <div className="text-xs font-mono font-semibold text-red-600">
                  {flowState.code}
                </div>
                <h2 className="font-display text-2xl font-bold text-red-800 mt-1">
                  Attendance Rejected
                </h2>
                {flowState.subject && (
                  <p className="text-xs font-semibold text-slate-700 mt-1">{flowState.subject}</p>
                )}
              </div>

              <div className="max-w-md mx-auto p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 leading-relaxed">
                {flowState.reason}
              </div>

              <p className="text-xs text-slate-500">
                An attendance rejection notification has been added to your notification bell.
              </p>

              <div className="flex justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onNavigate('dashboard')}
                  className="px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700"
                >
                  Back to Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setManualQrInput('');
                    setFlowState({ step: 'idle' });
                  }}
                  className="px-4 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STUDENT ATTENDANCE HISTORY TAB */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  My Verified Attendance History
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Showing only your successful attendance records ({allRecords.length} total sessions attended).
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
                <button
                  type="button"
                  onClick={() => setHistoryViewMode('by-subject')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    historyViewMode === 'by-subject'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  By Subject
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryViewMode('all')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    historyViewMode === 'all'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Records
                </button>
              </div>
            </div>

            {historyViewMode === 'by-subject' ? (
              <SubjectGroupedRecords
                records={allRecords}
                showStudentColumn={false}
                emptyMessage="You have no recorded attendance sessions yet."
              />
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 pr-3 font-medium">Subject</th>
                    <th className="py-2.5 px-3 font-medium">Classroom</th>
                    <th className="py-2.5 px-3 font-medium">Date</th>
                    <th className="py-2.5 px-3 font-medium">Time</th>
                    <th className="py-2.5 px-3 font-medium text-right">Distance</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allRecords.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                        You have no recorded attendance sessions yet.
                      </td>
                    </tr>
                  ) : (
                    allRecords.map((r) => {
                      const dt = formatDateTime(r.marked_at);
                      return (
                        <tr key={r.id}>
                          <td className="py-2.5 pr-3 text-xs">
                            <span className="font-mono font-semibold text-blue-700 mr-1.5">
                              {r.subject_code}
                            </span>
                            <span className="font-medium text-slate-900">{r.subject_name}</span>
                          </td>
                          <td className="py-2.5 px-3 text-xs text-slate-700">{r.classroom_name}</td>
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
            )}
          </div>

          {/* Student Verification Attempts Log */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="font-display text-base font-semibold text-slate-900 mb-3">
              Verification Attempt Log
            </h2>
            <div className="space-y-2.5">
              {verificationHistory.length === 0 ? (
                <p className="text-xs text-slate-500">No verification attempts recorded yet.</p>
              ) : (
                verificationHistory.map((v) => {
                  const dt = formatDateTime(v.created_at);
                  return (
                    <div
                      key={v.id}
                      className="flex items-start justify-between gap-3 py-2.5 border-b border-slate-100 last:border-0 text-xs"
                    >
                      <div className="flex items-start gap-2.5">
                        {v.outcome === 'accepted' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="font-semibold text-slate-900">
                            {v.subject_code ? `${v.subject_code} — ${v.subject_name}` : 'Attendance Scan'}
                          </div>
                          <div
                            className={
                              v.outcome === 'accepted' ? 'text-emerald-700 mt-0.5' : 'text-red-700 mt-0.5'
                            }
                          >
                            {v.reason}
                          </div>
                        </div>
                      </div>
                      <span className="font-mono text-slate-400 tabular-nums shrink-0">
                        {dt.date} · {dt.time}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
