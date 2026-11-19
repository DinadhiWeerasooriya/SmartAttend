import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-600 text-white px-4 py-2 text-xs font-medium flex items-center justify-center gap-2 text-center"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>
        Offline Mode — Cached app shell active. Connect to the internet to mark attendance or sync records.
      </span>
    </div>
  );
};
