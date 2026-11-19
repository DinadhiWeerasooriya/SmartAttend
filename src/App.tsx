import { useEffect, useState, useCallback, useRef } from 'react';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  FileBarChart,
  QrCode,
  History,
} from 'lucide-react';
import type { AuthUser, NotificationItem } from './types';
import { apiFetch, getAuthToken, setAuthToken } from './utils/api';
import { AppShell, type NavItem } from './components/AppShell';
import { LoginPage } from './components/LoginPage';
import { AdminPortal, type AdminTab } from './components/AdminPortal';
import { LecturerPortal, type LecturerTab } from './components/LecturerPortal';
import { StudentPortal, type StudentTab } from './components/StudentPortal';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [booting, setBooting] = useState(true);

  const [adminTab, setAdminTab] = useState<AdminTab>('dashboard');
  const [lecturerTab, setLecturerTab] = useState<LecturerTab>('dashboard');
  const [studentTab, setStudentTab] = useState<StudentTab>('dashboard');

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [realtimeEvent, setRealtimeEvent] = useState<{
    type: string;
    data: any;
    ts: number;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      const res = await apiFetch<{ notifications: NotificationItem[]; unreadCount: number }>(
        '/api/notifications'
      );
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch {
      // ignore transient error
    }
  }, []);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setBooting(false);
      return;
    }
    apiFetch<{ user: AuthUser }>('/api/auth/me')
      .then((res) => {
        setUser(res.user);
      })
      .catch(() => {
        setAuthToken(null);
        setUser(null);
      })
      .finally(() => setBooting(false));
  }, []);

  // Connect WebSocket when authenticated
  useEffect(() => {
    if (!user) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    fetchNotifications();

    let closedIntentionally = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWs = () => {
      const token = getAuthToken();
      if (!token) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'notification:new') {
            setNotifications((prev) => [msg.data, ...prev]);
            setUnreadCount((c) => c + 1);
          } else if (
            msg.type === 'attendance:marked' ||
            msg.type === 'verification:logged' ||
            msg.type === 'session:ended'
          ) {
            setRealtimeEvent({ type: msg.type, data: msg.data, ts: Date.now() });
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!closedIntentionally) {
          reconnectTimer = setTimeout(connectWs, 3000);
        }
      };
    };

    connectWs();

    return () => {
      closedIntentionally = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [user, fetchNotifications]);

  const handleMarkRead = async (id: number) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    } catch {
      fetchNotifications();
    }
  };

  const handleMarkAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    setUnreadCount(0);
    try {
      await apiFetch('/api/notifications/read-all', { method: 'PATCH' });
    } catch {
      fetchNotifications();
    }
  };

  const handleLogout = () => {
    setAuthToken(null);
    setUser(null);
    setNotifications([]);
    setUnreadCount(0);
    setAdminTab('dashboard');
    setLecturerTab('dashboard');
    setStudentTab('dashboard');
  };

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600 text-sm">
        Loading SmartAttend...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        onLoginSuccess={(loggedInUser) => {
          setUser(loggedInUser);
          setAdminTab('dashboard');
          setLecturerTab('dashboard');
          setStudentTab('dashboard');
        }}
      />
    );
  }

  const adminNav: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'students', label: 'Students', icon: Users },
    { id: 'lecturers', label: 'Lecturers', icon: GraduationCap },
    { id: 'academics', label: 'Subjects & Rooms', icon: BookOpen },
    { id: 'reports', label: 'Attendance & Reports', icon: FileBarChart },
  ];

  const lecturerNav: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'live-session', label: 'Live QR Session', icon: QrCode },
    { id: 'reports', label: 'History & Reports', icon: FileBarChart },
  ];

  const studentNav: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'scan', label: 'Scan QR Code', icon: QrCode },
    { id: 'history', label: 'Attendance History', icon: History },
  ];

  const navItems =
    user.role === 'admin'
      ? adminNav
      : user.role === 'lecturer'
      ? lecturerNav
      : studentNav;

  const activeTab =
    user.role === 'admin'
      ? adminTab
      : user.role === 'lecturer'
      ? lecturerTab
      : studentTab;

  const currentNav = navItems.find((n) => n.id === activeTab);

  return (
    <AppShell
      user={user}
      navItems={navItems}
      activeTab={activeTab}
      onSelectTab={(id) => {
        if (user.role === 'admin') setAdminTab(id as AdminTab);
        else if (user.role === 'lecturer') setLecturerTab(id as LecturerTab);
        else setStudentTab(id as StudentTab);
      }}
      pageTitle={currentNav?.label || 'Dashboard'}
      notifications={notifications}
      unreadCount={unreadCount}
      onMarkRead={handleMarkRead}
      onMarkAllRead={handleMarkAllRead}
      onLogout={handleLogout}
    >
      {user.role === 'admin' && (
        <AdminPortal activeTab={adminTab} onNavigate={setAdminTab} />
      )}
      {user.role === 'lecturer' && (
        <LecturerPortal
          activeTab={lecturerTab}
          onNavigate={setLecturerTab}
          realtimeEvent={realtimeEvent}
        />
      )}
      {user.role === 'student' && (
        <StudentPortal
          user={user}
          activeTab={studentTab}
          onNavigate={setStudentTab}
          notifications={notifications}
          onRefreshNotifications={fetchNotifications}
        />
      )}
    </AppShell>
  );
}
