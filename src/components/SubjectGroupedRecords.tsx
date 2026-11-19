import React, { useMemo } from 'react';
import { BookOpen } from 'lucide-react';
import type { AttendanceRecord } from '../types';
import { formatDateTime } from '../utils/api';

interface SubjectGroupedRecordsProps {
  records: AttendanceRecord[];
  showStudentColumn?: boolean;
  onSelectStudent?: (record: AttendanceRecord) => void;
  emptyMessage?: string;
}

export const SubjectGroupedRecords: React.FC<SubjectGroupedRecordsProps> = ({
  records,
  showStudentColumn = true,
  onSelectStudent,
  emptyMessage = 'No verified attendance records found.',
}) => {
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { code: string; name: string; records: AttendanceRecord[] }
    >();
    for (const r of records) {
      const key = `${r.subject_code}::${r.subject_name}`;
      if (!map.has(key)) {
        map.set(key, { code: r.subject_code, name: r.subject_name, records: [] });
      }
      map.get(key)!.records.push(r);
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [records]);

  if (groups.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-slate-500">{emptyMessage}</div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div
          key={group.code}
          className="border border-slate-200 rounded-xl overflow-hidden bg-white"
        >
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <BookOpen className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="font-mono text-xs font-semibold text-blue-700 shrink-0">
                {group.code}
              </span>
              <span className="text-sm font-semibold text-slate-900 truncate">
                {group.name}
              </span>
            </div>
            <span className="font-mono text-xs font-semibold tabular-nums text-slate-600 shrink-0">
              {group.records.length} {group.records.length === 1 ? 'record' : 'records'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  {showStudentColumn && (
                    <>
                      <th className="py-2.5 pl-4 pr-3 font-medium">Student Name</th>
                      <th className="py-2.5 px-3 font-medium">Reg. Number</th>
                    </>
                  )}
                  <th className={`py-2.5 ${showStudentColumn ? 'px-3' : 'pl-4 pr-3'} font-medium`}>
                    Classroom
                  </th>
                  <th className="py-2.5 px-3 font-medium">Date</th>
                  <th className="py-2.5 px-3 font-medium">Time</th>
                  <th className="py-2.5 px-3 font-medium text-right">Distance</th>
                  <th className="py-2.5 pl-3 pr-4 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {group.records.map((r) => {
                  const dt = formatDateTime(r.marked_at);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      {showStudentColumn && (
                        <>
                          <td className="py-2.5 pl-4 pr-3">
                            {onSelectStudent ? (
                              <button
                                type="button"
                                onClick={() => onSelectStudent(r)}
                                className="font-medium text-blue-700 hover:underline text-left"
                              >
                                {r.student_name}
                              </button>
                            ) : (
                              <span className="font-medium text-slate-900">{r.student_name}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-slate-700">
                            {r.registration_number}
                          </td>
                        </>
                      )}
                      <td
                        className={`py-2.5 ${
                          showStudentColumn ? 'px-3' : 'pl-4 pr-3'
                        } text-xs text-slate-700`}
                      >
                        {r.classroom_name}
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
                      <td className="py-2.5 pl-3 pr-4 text-right text-xs font-semibold text-emerald-700">
                        {r.verification_status}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};
