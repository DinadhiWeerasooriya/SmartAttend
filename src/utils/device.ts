const DEVICE_STORAGE_KEY = 'smartattend_device_id';

/**
 * Generates and persists a browser-based device identifier in localStorage.
 *
 * Demonstration Limitation:
 * This identifier is stored in browser storage and demonstrates 1-to-1 student-to-device
 * association logic on the backend. Clearing browser storage, using private/incognito mode,
 * or switching browsers on the same physical phone/laptop will produce a different identifier,
 * so it does not guarantee cryptographic hardware identity.
 */
export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (existing && existing.length >= 12) {
      return existing;
    }
    const randomPart =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const deviceId = `SA-DEV-${randomPart}`;
    localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
    return deviceId;
  } catch {
    return 'SA-DEV-FALLBACK';
  }
}
