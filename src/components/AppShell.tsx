import React, { useState, useRef, useEffect } from 'react';
import {
  Bell,
  LogOut,
  Menu,
  X,
  CheckCircle2,
  XCircle,
  Info,
  ShieldCheck,
} from 'lucide-react';
import type { AuthUser, NotificationItem } from '../types';
import { formatDateTime } from '../utils/api';
import { PWAInstallButton } from './PWAInstallButton';
import { OfflineIndicator } from './OfflineIndicator';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface AppShellProps {
  user: AuthUser;
  navItems: NavItem[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  pageTitle: string;
  notifications: NotificationItem[];
  unreadCount: number;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  user,
  navItems,
  activeTab,
  onSelectTab,
  pageTitle,
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onLogout,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const roleLabel =
    user.role === 'admin'
      ? 'Administrator'
      : user.role === 'lecturer'
      ? 'Lecturer'
      : 'Student';

  const identitySubtitle =
    user.role === 'student' && user.profile && 'registration_number' in user.profile
      ? user.profile.registration_number
      : user.role === 'lecturer' && user.profile && 'staff_id' in user.profile
      ? user.profile.staff_id
      : user.email || '';

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-navy-950 text-slate-100 border-r border-navy-800">
        <div className="h-16 flex items-center gap-3 px-6 border-b border-navy-800">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
            SmartAttend
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-navy-900 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-navy-800 bg-navy-900/50">
          <div className="text-sm font-semibold text-white truncate">{user.name}</div>
          <div className="mt-0.5 text-xs text-slate-300 flex items-center gap-1.5">
            <span>{roleLabel}</span>
            {identitySubtitle && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums truncate">{identitySubtitle}</span>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-navy-950 text-slate-100 flex flex-col h-full z-10">
            <div className="h-16 flex items-center justify-between px-5 border-b border-navy-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-white" />
                </div>
                <span className="font-display text-lg font-bold text-white">SmartAttend</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-slate-300 hover:text-white rounded-lg"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelectTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-navy-900 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-navy-800">
              <div className="text-sm font-semibold text-white">{user.name}</div>
              <div className="text-xs text-slate-300 mt-0.5">
                {roleLabel} · <span className="font-mono">{identitySubtitle}</span>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <OfflineIndicator />
        <header className="h-16 pt-[env(safe-area-inset-top)] bg-white border-b border-slate-200 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-2 sm:gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-w-[44px] min-h-[44px] inline-flex items-center justify-center -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 min-w-0 text-sm">
              <span className="hidden sm:inline text-slate-400">{roleLabel}</span>
              <span className="hidden sm:inline text-slate-300">/</span>
              <h1 className="font-display text-base sm:text-lg font-semibold text-slate-900 truncate">
                {pageTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <PWAInstallButton variant="header" />

            {/* Notification Bell */}
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => setNotifOpen((prev) => !prev)}
                className="relative min-w-[40px] min-h-[40px] p-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors inline-flex items-center justify-center"
                aria-label="Open notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-blue-600 text-white text-[11px] font-mono font-semibold tabular-nums flex items-center justify-center">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg z-40 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                    <span className="text-sm font-semibold text-slate-900">
                      Notifications ({unreadCount} unread)
                    </span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={onMarkAllRead}
                        className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        No notifications yet.
                      </div>
                    ) : (
                      notifications.map((n) => {
                        const dt = formatDateTime(n.created_at);
                        return (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => {
                              if (n.is_read === 0) onMarkRead(n.id);
                            }}
                            className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3 ${
                              n.is_read === 0 ? 'bg-blue-50/40' : 'bg-white'
                            }`}
                          >
                            <div className="mt-0.5 shrink-0">
                              {n.type === 'accepted' ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              ) : n.type === 'rejected' ? (
                                <XCircle className="w-4 h-4 text-red-600" />
                              ) : (
                                <Info className="w-4 h-4 text-blue-600" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-900 truncate">
                                  {n.title}
                                </span>
                                {n.is_read === 0 && (
                                  <span className="text-[11px] font-medium text-blue-700 shrink-0">
                                    New
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                                {n.message}
                              </p>
                              <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1.5">
                                {dt.date} · {dt.time}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center justify-center gap-2 min-h-[40px] px-3 sm:px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
              aria-label="Sign Out"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
