export type UserRole = 'admin' | 'lecturer' | 'student';

export interface StudentProfile {
  id: number;
  registration_number: string;
  department: string;
  year_of_study: number;
  device_id: string | null;
  device_bound_at: string | null;
}

export interface LecturerProfile {
  id: number;
  staff_id: string;
  department: string;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string | null;
  role: UserRole;
  profile: StudentProfile | LecturerProfile | null;
  deviceStatus?: {
    bound: boolean;
    matchesCurrentDevice: boolean;
    boundToAnotherStudent: boolean;
  };
}

export interface NotificationItem {
  id: number;
  title: string;
  message: string;
  type: 'accepted' | 'rejected' | 'info';
  is_read: number;
  created_at: string;
}

export interface Classroom {
  id: number;
  name: string;
  building: string;
  latitude: number;
  longitude: number;
  permitted_radius_meters: number;
}

export interface Subject {
  id: number;
  code: string;
  name: string;
  department: string;
  lecturer_id: number | null;
  default_classroom_id: number | null;
  lecturer_name?: string | null;
  lecturer_staff_id?: string | null;
  classroom_name?: string | null;
  classroom_building?: string | null;
  permitted_radius_meters?: number;
  enrolled_count?: number;
  total_sessions?: number;
  attended_count?: number;
  student_ids?: number[];
}

export interface AttendanceRecord {
  id: number;
  session_id?: number;
  student_id?: number;
  subject_id?: number;
  student_name?: string;
  registration_number?: string;
  department?: string;
  subject_code: string;
  subject_name: string;
  classroom_name: string;
  classroom_building?: string;
  marked_at: string;
  distance_meters: number;
  accuracy_meters: number;
  verification_status: string;
}

export interface VerificationLog {
  id: number;
  session_id?: number | null;
  attempted_reg_number?: string | null;
  student_name?: string | null;
  subject_code?: string | null;
  subject_name?: string | null;
  outcome: 'accepted' | 'rejected';
  reason: string;
  distance_meters?: number | null;
  accuracy_meters?: number | null;
  created_at: string;
}

export interface ActiveQrData {
  payload: string;
  token: string;
  expiresAt: string;
  ttlSeconds: number;
}
