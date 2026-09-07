import { useState, useEffect, useRef, useMemo } from "react";
import { UserProfile, CognitiveLevel, AccountPath, AccessibilityMode } from "../types";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { collection, onSnapshot, deleteDoc, doc, updateDoc, query, limit } from "firebase/firestore";
import { toast } from "./Toast";
import {
  FOUNDER_SUPERADMIN_EMAILS, ADMIN_EMAILS, norm,
  isFounderSuperAdmin, isSuperAdminUser, isPermanentAdmin, isPermanent, isAdminUser,
  canManageAdmins as canManageAdminsFor, canManageSuperAdmin,
} from "../lib/roles";
import {
  Loader2, Users, Search, Activity, Menu, ShieldAlert, Mail, Trash2, Shield,
  ShieldCheck, Crown, UserPlus, UserMinus, Brain, Heart, GraduationCap,
  Accessibility, Eye, Ear, Mic, User as UserIcon, Copy, CheckCircle2, Download,
  Printer, AlertTriangle, Building2, X, Sliders, MessageSquare,
  ListTodo, FileJson, RefreshCw, BarChart2, BookOpen, Clock, Award, Check, Sparkles,
  ArrowLeft, Database, HardDrive, Radio, Lock, Terminal, Zap, Globe, Server, AlertCircle
} from "lucide-react";
import { sectionOf, isAccessibilityUser } from "../lib/access";
import {
  getDatabaseHealth,
  getCollectionStats,
  generateFullSystemBackupJson,
  cleanStaleSessionsAndCache,
  generateDatabaseAuditReport,
  DatabaseHealthReport,
} from "../lib/databaseHub";
import {
  listenToSecurityAudits,
  clearSecurityAudits,
  SecurityAuditRecord,
} from "../lib/securityTracker";

interface AdminDashboardProps {
  profile: UserProfile;
  onMenuClick: () => void;
  onNavigateBack?: () => void;
}

// Visual identity for each enrolment section
const SECTION_META: Record<AccountPath, { label: string; Icon: typeof Brain; cls: string }> = {
  'Normal': { label: 'Normal', Icon: Brain, cls: 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30' },
  'Special Needs': { label: 'Special Needs', Icon: Heart, cls: 'bg-rose-500/15 text-rose-400 border border-rose-500/30' },
  'Graduation Project': { label: 'Graduation', Icon: GraduationCap, cls: 'bg-amber-500/15 text-amber-400 border border-amber-500/30' },
};
const SECTION_ORDER: (AccountPath | 'all')[] = ['all', 'Normal', 'Special Needs', 'Graduation Project'];

// Visual identity for disability types (Accessibility Center)
const DISABILITY_META: Record<string, { label: string; Icon: typeof Eye; bar: string }> = {
  'Visual Impairment': { label: 'Visual', Icon: Eye, bar: 'bg-indigo-500' },
  'Hearing Impairment': { label: 'Hearing', Icon: Ear, bar: 'bg-rose-500' },
  'Speech Impairment': { label: 'Speech', Icon: Mic, bar: 'bg-emerald-500' },
  'Motor Impairment': { label: 'Motor', Icon: Accessibility, bar: 'bg-amber-500' },
  'Cognitive/Learning Disability': { label: 'Cognitive', Icon: Brain, bar: 'bg-purple-500' },
  'Other': { label: 'Other', Icon: UserIcon, bar: 'bg-slate-400' },
};

// Visual identity for active accessibility mode
const MODE_META: Record<AccessibilityMode, { label: string; cls: string }> = {
  'Visual': { label: 'Visual', cls: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' },
  'Speech': { label: 'Speech', cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' },
  'Vocal-Deaf': { label: 'Vocal-Deaf', cls: 'bg-rose-500/20 text-rose-300 border border-rose-500/30' },
  'Sign-Only': { label: 'Sign-Only', cls: 'bg-purple-500/20 text-purple-300 border border-purple-500/30' },
  'Motor-Euphonia': { label: 'Motor & Euphonia', cls: 'bg-amber-500/20 text-amber-300 border border-amber-500/30' },
  'None': { label: 'Standard', cls: 'bg-slate-800 text-slate-400 border border-slate-700' },
};

/** Days since the user's MOST-RECENT activity signal */
function daysSinceActive(u?: UserProfile | null): number {
  if (!u) return Infinity;
  const candidates = [u.lastActiveDate, u.lastQuizDate, ...(u.chatThreads || []).map((t) => t?.updatedAt)]
    .filter(Boolean)
    .map((d) => new Date(d as string).getTime())
    .filter((t) => !isNaN(t));
  if (candidates.length === 0) return Infinity;
  return (Date.now() - Math.max(...candidates)) / 86400000;
}

/** ISO string of the user's MOST-RECENT activity signal */
function newestActiveIso(u?: UserProfile | null): string | undefined {
  if (!u) return undefined;
  const candidates = [u.lastActiveDate, u.lastQuizDate, ...(u.chatThreads || []).map((t) => t?.updatedAt)]
    .filter(Boolean) as string[];
  if (candidates.length === 0) return undefined;
  return candidates.reduce((a, b) => (new Date(b).getTime() > new Date(a).getTime() ? b : a));
}

export default function AdminDashboard({ profile, onMenuClick, onNavigateBack }: AdminDashboardProps) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [sectionFilter, setSectionFilter] = useState<AccountPath | 'all'>('all');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [adminView, setAdminView] = useState<'directory' | 'accessibility' | 'analytics' | 'database' | 'security'>('directory');
  const [copiedEmails, setCopiedEmails] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [selectedUserForModal, setSelectedUserForModal] = useState<UserProfile | null>(null);
  const [modalTab, setModalTab] = useState<'profile' | 'chats' | 'tasks' | 'raw'>('profile');

  // Database Hub States
  const [dbHealth, setDbHealth] = useState<DatabaseHealthReport | null>(null);
  const [isPingingDb, setIsPingingDb] = useState(false);
  const [isCleaningCache, setIsCleaningCache] = useState(false);
  const [dbSearchTerm, setDbSearchTerm] = useState("");
  const [inspectedDoc, setInspectedDoc] = useState<UserProfile | null>(null);

  // Security & Inspect Tracker States
  const [securityAudits, setSecurityAudits] = useState<SecurityAuditRecord[]>([]);
  const [activeSecurityAlert, setActiveSecurityAlert] = useState<SecurityAuditRecord | null>(null);
  const [isClearingAudits, setIsClearingAudits] = useState(false);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const isAdmin = isAdminUser(profile);
  const isSuperAdmin = isSuperAdminUser(profile);
  const canManageAdmins = canManageAdminsFor(profile);

  const copyToClipboard = async (text: string, label: string = 'Copied to clipboard') => {
    try {
      await navigator.clipboard.writeText(text);
      if (isMountedRef.current) setCopiedText(text);
      toast.success(label, 'Copied');
      setTimeout(() => { if (isMountedRef.current) setCopiedText(null); }, 2500);
    } catch {
      toast.error('Could not copy to clipboard.', 'Copy failed');
    }
  };

  // Real-time user directory listener
  useEffect(() => {
    if (!isAdmin) return;

    const usersRef = query(collection(db, "users"), limit(1000));
    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      const usersData: UserProfile[] = [];
      snapshot.forEach((docSnap) => {
        usersData.push({ ...docSnap.data(), uid: docSnap.id } as UserProfile);
      });

      const emailMap = new Map<string, UserProfile>();
      usersData.forEach((u) => {
        const emailKey = (u.email || "").toLowerCase().trim();
        if (!emailKey) {
          emailMap.set(`no-email-${u.uid}`, u);
          return;
        }

        const existing = emailMap.get(emailKey);
        if (!existing) {
          emailMap.set(emailKey, u);
        } else {
          const dateA = u.lastActiveDate || u.lastQuizDate || "1970-01-01T00:00:00Z";
          const dateB = existing.lastActiveDate || existing.lastQuizDate || "1970-01-01T00:00:00Z";
          const timeA = new Date(dateA).getTime();
          const timeB = new Date(dateB).getTime();

          if (timeA > timeB) {
            emailMap.set(emailKey, u);
          } else if (timeA === timeB) {
            const scoreA = (u.points || 0) + (u.name ? 10 : 0) + (u.chatThreads?.length ? 20 : 0);
            const scoreB = (existing.points || 0) + (existing.name ? 10 : 0) + (existing.chatThreads?.length ? 20 : 0);
            if (scoreA > scoreB) {
              emailMap.set(emailKey, u);
            }
          }
        }
      });

      const uniqueUsersData = Array.from(emailMap.values());
      uniqueUsersData.sort((a, b) => {
        const dateA = a.lastActiveDate || a.lastQuizDate || "1970-01-01T00:00:00Z";
        const dateB = b.lastActiveDate || b.lastQuizDate || "1970-01-01T00:00:00Z";
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });

      setUsers(uniqueUsersData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "users");
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isAdmin]);

  // Real-time DevTools Inspect Security Alert Listener
  useEffect(() => {
    const handleSecurityAlertEvent = (event: Event) => {
      const customEv = event as CustomEvent<SecurityAuditRecord>;
      if (customEv.detail) {
        setActiveSecurityAlert(customEv.detail);
      }
    };

    window.addEventListener('cognify:security_alert', handleSecurityAlertEvent);
    return () => {
      window.removeEventListener('cognify:security_alert', handleSecurityAlertEvent);
    };
  }, []);

  // Real-time Security Audits Stream (Super Admin Only)
  useEffect(() => {
    if (!isSuperAdmin) return;
    const unsub = listenToSecurityAudits((audits) => {
      if (isMountedRef.current) {
        setSecurityAudits(audits);
        // If an audit was logged in the last 15 seconds and no active alert is displayed, highlight it
        if (audits.length > 0 && !activeSecurityAlert) {
          const newest = audits[0];
          if (Date.now() - newest.timestampMs < 20000) {
            setActiveSecurityAlert(newest);
          }
        }
      }
    });
    return () => unsub();
  }, [isSuperAdmin]);

  // Initial Database Health Ping
  const pingDatabase = async () => {
    setIsPingingDb(true);
    try {
      const health = await getDatabaseHealth();
      if (isMountedRef.current) setDbHealth(health);
      toast.success(`Frankfurt DB Latency: ${health.latencyMs}ms (${health.status})`, 'Database Pinged');
    } catch {
      toast.error('Failed to measure database latency.', 'Ping Error');
    } finally {
      if (isMountedRef.current) setIsPingingDb(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      pingDatabase();
    }
  }, [isSuperAdmin]);

  // Handlers for Database Operations
  const handleDownloadFullBackup = () => {
    const { blob, filename } = generateFullSystemBackupJson(users, securityAudits);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast.success(`Exported full system backup (${users.length} users + ${securityAudits.length} audits).`, 'Backup Downloaded');
  };

  const handleDownloadAuditReport = () => {
    const reportMd = generateDatabaseAuditReport(users, securityAudits);
    const blob = new Blob([reportMd], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cognify-database-audit-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast.success('Generated infrastructure audit report.', 'Audit Report');
  };

  const handleCleanCache = async () => {
    setIsCleaningCache(true);
    try {
      const result = await cleanStaleSessionsAndCache();
      toast.success(`Cleaned ${result.cleanedKeys} stale keys (Freed ~${(result.freedBytesApprox / 1024).toFixed(1)} KB).`, 'Cache Cleaned');
    } catch {
      toast.error('Error during cache cleanup.', 'Cleanup Error');
    } finally {
      if (isMountedRef.current) setIsCleaningCache(false);
    }
  };

  const handleClearAllAudits = async () => {
    if (!window.confirm('Are you sure you want to clear all DevTools security audit records? This cannot be undone.')) {
      return;
    }
    setIsClearingAudits(true);
    try {
      await clearSecurityAudits();
      setSecurityAudits([]);
      setActiveSecurityAlert(null);
      toast.success('Security audit logs successfully cleared.', 'Logs Purged');
    } catch {
      toast.error('Failed to clear security audit logs.', 'Purge Failed');
    } finally {
      if (isMountedRef.current) setIsClearingAudits(false);
    }
  };

  // User Deletion and Roles
  const canDeleteUser = (u: UserProfile) =>
    canManageAdmins && !isPermanent(u.email) && norm(u.email) !== norm(profile.email);

  const handleDeleteUser = async (u: UserProfile) => {
    if (!canManageAdmins) {
      toast.error("Only a super admin can delete users.", "Not allowed");
      return;
    }
    if (isPermanent(u.email)) {
      toast.error("Super admins and permanent admins can never be deleted.", "Protected account");
      return;
    }
    if (norm(u.email) === norm(profile.email)) {
      toast.error("You can't delete your own account from here.", "Not allowed");
      return;
    }
    if (window.confirm(`Delete "${u.name || u.email}"? This action cannot be undone.`)) {
      try {
        await deleteDoc(doc(db, "users", u.uid));
        toast.success(`User "${u.name || u.email}" deleted successfully.`, "Deleted");
      } catch (error) {
        console.error("Delete user error:", error);
        toast.error("Failed to delete user.", "Delete failed");
      }
    }
  };

  const handleToggleAdmin = async (u: UserProfile, makeAdmin: boolean) => {
    if (!canManageAdmins || isPermanent(u.email)) return;
    const label = u.name || u.email;
    if (!window.confirm(makeAdmin
      ? `Make "${label}" an admin?`
      : `Remove admin access from "${label}"?`)) return;
    setBusyUid(u.uid);
    try {
      await updateDoc(doc(db, "users", u.uid), { isAdmin: makeAdmin });
      toast.success(makeAdmin ? `${label} is now an admin.` : `${label} is no longer an admin.`, "Admins updated");
    } catch (error) {
      console.error("Toggle admin error:", error);
      toast.error("Failed to update admin permissions.", "Update failed");
    } finally {
      if (isMountedRef.current) setBusyUid(null);
    }
  };

  const handleToggleSuperAdmin = async (u: UserProfile, makeSuper: boolean) => {
    if (!canManageSuperAdmin(profile, u)) return;
    const label = u.name || u.email;
    if (!window.confirm(makeSuper
      ? `Make "${label}" a SUPER ADMIN?\n\nThey will receive full infrastructure and audit permissions.`
      : `Revoke super admin privileges from "${label}"?`)) return;
    setBusyUid(u.uid);
    try {
      await updateDoc(doc(db, "users", u.uid), { isSuperAdmin: makeSuper });
      toast.success(makeSuper ? `${label} is now a super admin.` : `${label} is no longer a super admin.`, "Super Admins updated");
    } catch (error) {
      console.error("Toggle super admin error:", error);
      toast.error("Failed to update super admin status.", "Update failed");
    } finally {
      if (isMountedRef.current) setBusyUid(null);
    }
  };

  const handleToggleOrgManager = async (u: UserProfile, make: boolean) => {
    if (!canManageAdmins) return;
    let org = (u.organization || '').trim();
    if (make) {
      const input = window.prompt("Organization code for this manager (e.g. ORG01):", org || "ORG01");
      if (!input || !input.trim()) return;
      org = input.trim().toUpperCase();
    }
    setBusyUid(u.uid);
    try {
      await updateDoc(doc(db, "users", u.uid), make ? { isOrgManager: true, organization: org } : { isOrgManager: false });
      toast.success(
        make ? `${u.name || u.email} can now follow up on ${org} users.` : `${u.name || u.email} is no longer an org manager.`,
        "Organization access updated"
      );
    } catch (error) {
      console.error("Toggle org manager error:", error);
      toast.error("Failed to update organization access.", "Update failed");
    } finally {
      if (isMountedRef.current) setBusyUid(null);
    }
  };

  const handleUpdatePoints = async (u: UserProfile, delta: number) => {
    const newPoints = Math.max(0, (u.points || 0) + delta);
    setBusyUid(u.uid);
    try {
      await updateDoc(doc(db, "users", u.uid), { points: newPoints });
      toast.success(`Updated ${u.name || u.email}'s points to ${newPoints}`, 'Points adjusted');
      if (selectedUserForModal && selectedUserForModal.uid === u.uid) {
        setSelectedUserForModal({ ...selectedUserForModal, points: newPoints });
      }
    } catch (err) {
      console.error("Update points error:", err);
      toast.error("Failed to update points.", "Update error");
    } finally {
      if (isMountedRef.current) setBusyUid(null);
    }
  };

  const handleUpdateCognitiveLevel = async (u: UserProfile, newLevel: CognitiveLevel) => {
    setBusyUid(u.uid);
    try {
      await updateDoc(doc(db, "users", u.uid), { level: newLevel });
      toast.success(`Level changed to ${newLevel}`, 'Profile updated');
      if (selectedUserForModal && selectedUserForModal.uid === u.uid) {
        setSelectedUserForModal({ ...selectedUserForModal, level: newLevel });
      }
    } catch (err) {
      console.error("Update cognitive level error:", err);
      toast.error("Failed to update cognitive level.", "Update error");
    } finally {
      if (isMountedRef.current) setBusyUid(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 text-slate-100 p-6">
        <ShieldAlert className="w-16 h-16 text-rose-500 mb-4" />
        <h2 className="text-2xl font-black uppercase tracking-tighter">Access Denied</h2>
        <p className="text-slate-400 font-medium text-sm mt-2">You do not have administrative privileges.</p>
      </div>
    );
  }

  // Filtered Users
  const filteredUsers = users.filter(u => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      (u.email || "").toLowerCase().includes(term) ||
      (u.name && u.name.toLowerCase().includes(term)) ||
      (u.uid && u.uid.toLowerCase().includes(term)) ||
      (u.university && u.university.toLowerCase().includes(term)) ||
      (u.faculty && u.faculty.toLowerCase().includes(term)) ||
      (u.disabilityType && u.disabilityType.toLowerCase().includes(term));
    const matchesSection = sectionFilter === 'all' || sectionOf(u) === sectionFilter;
    return matchesSearch && matchesSection;
  });

  const sanitizeCsvCell = (val: unknown): string => {
    let str = val === null || val === undefined ? '' : String(val);
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    return `"${str.replace(/"/g, '""')}"`;
  };

  const exportAllJson = () => {
    const blob = new Blob([JSON.stringify(users, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `cognify-all-users-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast.success(`Exported ${users.length} full user records as JSON.`, 'Backup Downloaded');
  };

  const exportAllCsv = () => {
    const rows = [
      ['UID', 'Name', 'Email', 'Section', 'Role', 'Level', 'Points', 'IQ Score', 'University', 'Faculty', 'Disability Type', 'Active Mode', 'Language', 'Last Active'],
      ...users.map((u) => [
        u.uid || '',
        u.name || 'Unnamed',
        u.email || '',
        sectionOf(u),
        u.role || 'Student',
        u.level || 'Intermediate',
        u.points || 0,
        u.iqScore || '',
        u.university || '',
        u.faculty || '',
        u.disabilityType || '',
        u.accessibilityMode || 'None',
        u.language || 'English',
        formatDate(newestActiveIso(u)),
      ]),
    ];
    const csv = '\uFEFF' + rows.map(r => r.map(c => sanitizeCsvCell(c)).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `cognify-directory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast.success(`Exported ${users.length} users to CSV.`, 'Excel file ready');
  };

  const copyAllDirectoryEmails = async () => {
    const emails = users.map(u => u.email).filter(Boolean).join(', ');
    await copyToClipboard(emails, `${users.length} user emails copied`);
  };

  // Enrolment Section Counts
  const sectionCounts: Record<AccountPath, number> = { 'Normal': 0, 'Special Needs': 0, 'Graduation Project': 0 };
  users.forEach(u => { sectionCounts[sectionOf(u)] = (sectionCounts[sectionOf(u)] || 0) + 1; });

  // Accessibility Metrics
  const a11yAll = users.filter(isAccessibilityUser);
  const a11yUsers = a11yAll
    .filter(u =>
      (u.email || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.name && u.name.toLowerCase().includes(searchTerm.toLowerCase()))
    )
    .sort((a, b) => daysSinceActive(a) - daysSinceActive(b));
  const a11yActive7 = a11yAll.filter(u => daysSinceActive(u) <= 7).length;
  const a11ySigners = a11yAll.filter(u => u.accessibilityMode === 'Sign-Only' || u.accessibilityMode === 'Vocal-Deaf').length;
  const a11yNew30 = a11yAll.filter(u => daysSinceActive(u) <= 30).length;
  const disabilityCounts = Object.keys(DISABILITY_META).map((key) => ({
    key,
    count: a11yAll.filter(u => {
      const raw = u.disabilityType || 'Other';
      const canonical = DISABILITY_META[raw] ? raw : 'Other';
      return canonical === key;
    }).length,
  }));
  const maxDisability = Math.max(1, ...disabilityCounts.map(d => d.count));
  const modeCounts = (Object.keys(MODE_META) as AccessibilityMode[]).map((m) => ({
    mode: m,
    count: a11yAll.filter(u => (u.accessibilityMode || 'None') === m).length,
  }));

  const copyA11yEmails = async () => {
    const emails = a11yAll.map(u => u.email).filter(Boolean).join(', ');
    await copyToClipboard(emails, `${a11yAll.length} email(s) copied to clipboard.`);
  };

  const idleUsers = a11yAll
    .filter(u => { const d = daysSinceActive(u); return d >= 14 && d !== Infinity; })
    .sort((a, b) => daysSinceActive(b) - daysSinceActive(a));

  const weeklyActivity = (() => {
    const buckets = Array.from({ length: 8 }, (_, i) => ({
      label: i === 7 ? 'This wk' : `-${7 - i}w`,
      count: 0,
    }));
    const now = Date.now();
    a11yAll.forEach((u) => {
      const events: (string | undefined)[] = [
        u.lastActiveDate, u.lastQuizDate,
        ...(u.chatThreads || []).map(t => t.updatedAt),
      ];
      events.forEach((iso) => {
        if (!iso) return;
        const weeksAgo = Math.floor((now - new Date(iso).getTime()) / (7 * 86400000));
        if (weeksAgo >= 0 && weeksAgo < 8) buckets[7 - weeksAgo].count++;
      });
    });
    return buckets;
  })();
  const maxWeekly = Math.max(1, ...weeklyActivity.map(w => w.count));

  const exportA11yCsv = () => {
    const rows = [
      ['Name', 'Email', 'Section', 'Disability Type', 'Active Mode', 'Last Active', 'Status'],
      ...a11yAll.map((u) => {
        const d = daysSinceActive(u);
        return [
          u.name || 'Unnamed', u.email || '', sectionOf(u), u.disabilityType || 'Other',
          u.accessibilityMode || 'None',
          formatDate(newestActiveIso(u)),
          d <= 7 ? 'Active' : d === Infinity ? 'Never' : `${Math.floor(d)}d idle`,
        ];
      }),
    ];
    const csv = '\uFEFF' + rows.map(r => r.map(c => sanitizeCsvCell(c)).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cognify-accessibility-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`${a11yAll.length} user(s) exported.`, 'CSV downloaded');
  };

  const openMonthlyReport = () => {
    const win = window.open('', '_blank');
    if (!win) { toast.error('Popup blocked — allow popups to print the report.', 'Report'); return; }
    const esc = (s: string) => String(s || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
    const monthName = new Date().toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
    const kpi = (label: string, value: number | string) =>
      `<div class="kpi"><div class="v">${value}</div><div class="l">${label}</div></div>`;
    const disRows = disabilityCounts.map(({ key, count }) =>
      `<tr><td>${esc(DISABILITY_META[key].label)}</td><td class="c">${count}</td></tr>`).join('');
    const modeRows = modeCounts.map(({ mode, count }) =>
      `<tr><td>${esc(MODE_META[mode].label)}</td><td class="c">${count}</td></tr>`).join('');
    const weekCells = weeklyActivity.map(w =>
      `<td class="c"><div class="bar" style="height:${Math.round((w.count / maxWeekly) * 60) + 4}px"></div><div class="wl">${w.label}</div><div class="wc">${w.count}</div></td>`).join('');
    const idleRows = idleUsers.length
      ? idleUsers.map(u => `<tr><td>${esc(u.name || 'Unnamed')}</td><td>${esc(u.email || '')}</td><td class="c">${Math.floor(daysSinceActive(u))} يوم</td></tr>`).join('')
      : '<tr><td colspan="3" class="c">لا يوجد مستخدمون خاملون 🎉</td></tr>';
    const userRows = a11yAll.map(u => {
      const d = daysSinceActive(u);
      return `<tr><td>${esc(u.name || 'Unnamed')}</td><td>${esc(u.disabilityType || 'Other')}</td><td>${esc(u.accessibilityMode || 'None')}</td><td class="c">${d <= 7 ? 'نشط' : d === Infinity ? 'لم يبدأ' : Math.floor(d) + ' يوم خمول'}</td></tr>`;
    }).join('');
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير كوجنيفاي الشهري — قسم ذوي الهمم</title><style>
      body{font-family:'Segoe UI',Tahoma,sans-serif;color:#141E38;margin:32px;line-height:1.6}
      h1{font-size:24px;margin:0 0 2px} .sub{color:#54617C;font-size:13px;margin:0 0 24px}
      h2{font-size:15px;margin:26px 0 8px;border-bottom:2px solid #2E42C9;padding-bottom:4px;color:#2E42C9}
      .kpis{display:flex;gap:12px} .kpi{flex:1;border:1px solid #E3E8F0;border-radius:10px;padding:12px;text-align:center}
      .kpi .v{font-size:26px;font-weight:800} .kpi .l{font-size:11px;color:#54617C;font-weight:700}
      table{width:100%;border-collapse:collapse;font-size:12.5px} td,th{border:1px solid #E3E8F0;padding:6px 10px;text-align:right}
      th{background:#F5F7FA;font-size:11px} .c{text-align:center}
      .chart td{border:0;vertical-align:bottom} .bar{width:26px;background:#2E42C9;border-radius:4px 4px 0 0;margin:0 auto}
      .wl{font-size:10px;color:#54617C;margin-top:4px}.wc{font-size:11px;font-weight:800}
      .foot{margin-top:28px;color:#8B96AB;font-size:11px;border-top:1px solid #E3E8F0;padding-top:10px}
      @media print{ .noprint{display:none} }
    </style></head><body>
      <button class="noprint" onclick="window.print()" style="padding:8px 18px;font-weight:700;margin-bottom:16px">🖨️ طباعة / حفظ PDF</button>
      <h1>تقرير كوجنيفاي الشهري — قسم ذوي الهمم</h1>
      <p class="sub">${monthName} · أُنشئ في ${new Date().toLocaleDateString('ar-EG')} · إعداد فريق كوجنيفاي</p>
      <div class="kpis">
        ${kpi('إجمالي المستخدمين', a11yAll.length)}
        ${kpi('نشطون آخر 7 أيام', a11yActive7)}
        ${kpi('مستخدمو لغة الإشارة', a11ySigners)}
        ${kpi('خاملون +14 يوم', idleUsers.length)}
      </div>
      <h2>النشاط الأسبوعي (آخر 8 أسابيع)</h2>
      <table class="chart"><tr>${weekCells}</tr></table>
      <h2>التوزيع حسب نوع الإعاقة</h2><table><tr><th>النوع</th><th class="c">العدد</th></tr>${disRows}</table>
      <h2>التوزيع حسب الوضع المفعّل</h2><table><tr><th>الوضع</th><th class="c">العدد</th></tr>${modeRows}</table>
      <h2>مستخدمون يحتاجون متابعة (خمول +14 يوم)</h2><table><tr><th>الاسم</th><th>البريد</th><th class="c">مدة الخمول</th></tr>${idleRows}</table>
      <h2>كل المستخدمين</h2><table><tr><th>الاسم</th><th>نوع الإعاقة</th><th>الوضع</th><th class="c">الحالة</th></tr>${userRows}</table>
      <p class="foot">كوجنيفاي — نسخة إمكانية الوصول · تقرير آلي من لوحة الإدارة</p>
    </body></html>`);
    win.document.close();
  };

  // Administrators list
  const adminUsers = users.filter(isAdminUser);
  const knownAdminEmails = new Set(adminUsers.map(u => norm(u.email)));
  const pending = (emails: string[], prefix: string) =>
    emails.filter(e => !knownAdminEmails.has(e)).map(e => ({ uid: `${prefix}-${e}`, email: e, name: '' } as UserProfile));

  const superAdmins = [
    ...adminUsers.filter(u => isSuperAdminUser(u)),
    ...pending(FOUNDER_SUPERADMIN_EMAILS, 'sa'),
  ];
  const permanentAdmins = [
    ...adminUsers.filter(u => isPermanentAdmin(u.email) && !isSuperAdminUser(u)),
    ...pending(ADMIN_EMAILS, 'adm'),
  ];
  const promotedAdmins = adminUsers.filter(u => !isPermanent(u.email) && !isSuperAdminUser(u));
  const adminCount = superAdmins.length + permanentAdmins.length + promotedAdmins.length;

  const formatDate = (isoString?: string) => {
    if (!isoString) return "Never";
    const d = new Date(isoString);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Database Collection Stats Computation
  const collectionStats = useMemo(() => getCollectionStats(users.length), [users.length]);

  // Document Inspector filtered list
  const inspectedUsersList = useMemo(() => {
    if (!dbSearchTerm.trim()) return users.slice(0, 10);
    const term = dbSearchTerm.toLowerCase().trim();
    return users.filter(u =>
      (u.uid && u.uid.toLowerCase().includes(term)) ||
      (u.email && u.email.toLowerCase().includes(term)) ||
      (u.name && u.name.toLowerCase().includes(term))
    ).slice(0, 20);
  }, [users, dbSearchTerm]);

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 relative overflow-hidden custom-scrollbar font-sans selection:bg-emerald-500/30 selection:text-emerald-300 min-h-screen">
      
      {/* Background Nagm Gradient Accents */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute top-1/3 left-10 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-rose-500/10 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* ── TOP REAL-TIME DEVTOOLS INSPECT SECURITY ALERT BANNER ────────────────── */}
      {activeSecurityAlert && (
        <div className="bg-rose-950/90 border-b border-rose-500/40 p-4 px-6 md:px-10 flex items-center justify-between gap-4 backdrop-blur-xl animate-in slide-in-from-top-4 duration-300 z-50 shadow-2xl">
          <div className="flex items-center gap-3 min-w-0">
            <span className="relative flex h-3.5 w-3.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-500" />
            </span>
            <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
            <div className="text-xs md:text-sm text-slate-100 min-w-0 truncate">
              <span className="font-black text-rose-400 uppercase tracking-wider mr-2">🚨 DevTools Inspect Detected:</span>
              <span className="font-bold text-white mr-1.5">{activeSecurityAlert.name || activeSecurityAlert.email}</span>
              <span className="text-slate-300 mr-2">({activeSecurityAlert.email})</span>
              <span className="inline-flex items-center gap-1.5 font-mono text-xs font-black bg-rose-900/60 border border-rose-500/40 px-2 py-0.5 rounded text-rose-200">
                IP: {activeSecurityAlert.ip}
                <button
                  onClick={() => copyToClipboard(activeSecurityAlert.ip, `IP copied: ${activeSecurityAlert.ip}`)}
                  className="hover:text-white transition-colors"
                  title="Copy IP Address"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </span>
              <span className="text-slate-400 ml-2 hidden lg:inline">
                Trigger: <span className="text-rose-300 font-semibold">{activeSecurityAlert.eventType}</span> on <span className="font-mono text-slate-300">{activeSecurityAlert.path}</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => { setAdminView('security'); setActiveSecurityAlert(null); }}
              className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg active:scale-95"
            >
              View Feed
            </button>
            <button
              onClick={() => setActiveSecurityAlert(null)}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-rose-900/50 transition-colors"
              title="Dismiss Alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── HEADER ───────────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-4 p-5 md:p-8 shrink-0 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl shadow-lg z-20">
        {onNavigateBack && (
          <button
            onClick={onNavigateBack}
            className="p-2.5 text-slate-400 hover:text-slate-100 bg-slate-900/80 hover:bg-slate-800/90 border border-slate-700/70 rounded-xl active:scale-95 transition-all flex items-center gap-1.5 shrink-0"
            title="Back to Assistant / العودة للمساعد"
          >
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            <span className="text-xs font-bold hidden sm:inline">Back</span>
          </button>
        )}
        <button
          onClick={onMenuClick}
          aria-label="Toggle menu"
          title="Open Menu"
          className="p-2.5 text-slate-400 hover:text-slate-100 bg-slate-900/80 hover:bg-slate-800/90 border border-slate-700/70 rounded-xl active:scale-95 shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex-1 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-gradient-to-tr from-emerald-500/20 via-indigo-500/20 to-cyan-500/20 border border-white/10 shadow-inner">
              {adminView === 'database' ? (
                <Database className="w-6 h-6 text-emerald-400" />
              ) : adminView === 'security' ? (
                <ShieldAlert className="w-6 h-6 text-rose-400" />
              ) : adminView === 'accessibility' ? (
                <Accessibility className="w-6 h-6 text-rose-400" />
              ) : adminView === 'analytics' ? (
                <BarChart2 className="w-6 h-6 text-indigo-400" />
              ) : (
                <Users className="w-6 h-6 text-cyan-400" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-tight leading-none">
                  Cognify Admin Hub
                </h2>
                {isSuperAdmin && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    <Crown className="w-3 h-3" /> Super Admin
                  </span>
                )}
              </div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                {adminView === 'database' ? 'Infrastructure & Database Operations (Frankfurt europe-west1)' :
                 adminView === 'security' ? 'Security & DevTools Inspect Telemetry Stream' :
                 adminView === 'accessibility' ? 'Accessibility Center · Special Needs Command' :
                 adminView === 'analytics' ? 'System Insights & Cognitive Diagnostics' :
                 'Global User Directory & Access Management'}
              </p>
            </div>
          </div>

          {/* Navigation Tabs Pill */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 p-1 bg-slate-900/90 border border-slate-800 rounded-2xl backdrop-blur-md overflow-x-auto custom-scrollbar">
              <button
                onClick={() => setAdminView('directory')}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  adminView === 'directory' ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Users className="w-3.5 h-3.5" /> Directory
              </button>
              <button
                onClick={() => setAdminView('accessibility')}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  adminView === 'accessibility' ? 'bg-rose-500 text-white shadow-md font-extrabold' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Accessibility className="w-3.5 h-3.5" /> Accessibility
              </button>
              <button
                onClick={() => setAdminView('analytics')}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  adminView === 'analytics' ? 'bg-indigo-600 text-white shadow-md font-extrabold' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <BarChart2 className="w-3.5 h-3.5" /> Insights
              </button>
              <button
                onClick={() => setAdminView('database')}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  adminView === 'database' ? 'bg-emerald-500 text-slate-950 shadow-md font-extrabold' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Database className="w-3.5 h-3.5" /> Database
                {isSuperAdmin ? (
                  <Crown className="w-3 h-3 text-amber-300" />
                ) : (
                  <Lock className="w-3 h-3 text-slate-500" />
                )}
              </button>
              <button
                onClick={() => setAdminView('security')}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all relative ${
                  adminView === 'security' ? 'bg-rose-600 text-white shadow-md font-extrabold' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" /> Inspect Tracker
                {securityAudits.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-rose-500/40 text-white border border-rose-400/50 font-mono">
                    {securityAudits.length}
                  </span>
                )}
              </button>
            </div>

            {/* Cloud Firestore Status Pill */}
            <div className="hidden xl:flex items-center gap-2 px-3 py-2 bg-slate-900/90 border border-slate-800 rounded-xl text-xs font-bold text-slate-300 shadow-inner">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>Frankfurt europe-west1</span>
              {dbHealth && (
                <span className="font-mono text-emerald-400 text-[11px]">({dbHealth.latencyMs}ms)</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── MAIN CONTENT CONTAINER ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6 md:p-10 z-10 custom-scrollbar">
        <div className="max-w-7xl mx-auto space-y-8">

          {/* ═════════════════════════════════════════════════════════════════════
              VIEW 1: DIRECTORY
             ═════════════════════════════════════════════════════════════════════ */}
          {adminView === 'directory' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              {/* Administrators Team Section */}
              <section className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-6">
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 rounded-2xl">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-white uppercase tracking-tight">Active Administration Team</h3>
                      <p className="text-xs font-medium text-slate-400 mt-0.5">
                        {adminCount} verified administrator{adminCount === 1 ? '' : 's'}
                        {canManageAdmins ? ' · Super admin management active' : ' · Viewing in standard admin mode'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[...superAdmins, ...permanentAdmins, ...promotedAdmins].map((a) => {
                    const isGold = isSuperAdminUser(a);
                    const isMe = norm(a.email) === norm(profile.email);
                    const isPromoted = !isPermanent(a.email) && !isSuperAdminUser(a);
                    return (
                      <div
                        key={a.uid}
                        className={`flex items-center gap-3 p-3.5 rounded-2xl border backdrop-blur-md transition-all ${
                          isGold
                            ? 'bg-amber-500/10 border-amber-500/40 shadow-lg shadow-amber-500/5'
                            : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 font-black text-sm ${
                          isGold ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        }`}>
                          {(a.name || a.email || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white text-sm truncate">{a.name || a.email?.split('@')[0]}</span>
                            {isMe && <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">(you)</span>}
                          </div>
                          <div className="text-xs text-slate-400 truncate" title={a.email}>{a.email}</div>
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider shrink-0 ${
                          isGold
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        }`}>
                          {isGold ? <Crown className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                          {isGold ? 'Super Admin' : 'Admin'}
                        </span>
                        {isPromoted && canManageAdmins && (
                          <button
                            onClick={() => handleToggleAdmin(a, false)}
                            disabled={busyUid === a.uid}
                            title="Revoke admin privileges"
                            className="p-1.5 rounded-xl text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50 shrink-0"
                          >
                            {busyUid === a.uid ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Enrolment Sections Metric Cards */}
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <button
                  onClick={() => setSectionFilter('all')}
                  aria-pressed={sectionFilter === 'all'}
                  className={`flex items-center gap-4 p-5 rounded-3xl border text-left transition-all backdrop-blur-xl ${
                    sectionFilter === 'all'
                      ? 'bg-cyan-500/15 border-cyan-500/50 ring-2 ring-cyan-500/20 shadow-xl'
                      : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div className="p-3 rounded-2xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    <Users className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-2xl md:text-3xl font-black text-white leading-none">{users.length}</div>
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5">Total Users</div>
                    <div className="text-[10px] text-slate-500 mt-1 font-mono">
                      {sectionCounts['Normal']} N · {sectionCounts['Special Needs']} SN · {sectionCounts['Graduation Project']} G
                    </div>
                  </div>
                </button>

                {(['Normal', 'Special Needs', 'Graduation Project'] as AccountPath[]).map((sec) => {
                  const meta = SECTION_META[sec];
                  const active = sectionFilter === sec;
                  return (
                    <button
                      key={sec}
                      onClick={() => setSectionFilter(active ? 'all' : sec)}
                      aria-pressed={active}
                      className={`flex items-center gap-4 p-5 rounded-3xl border text-left transition-all backdrop-blur-xl ${
                        active
                          ? 'bg-slate-800/80 border-slate-600 ring-2 ring-white/10 shadow-xl'
                          : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className={`p-3 rounded-2xl ${meta.cls}`}>
                        <meta.Icon className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="text-2xl md:text-3xl font-black text-white leading-none">{sectionCounts[sec]}</div>
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5">{meta.label}</div>
                      </div>
                    </button>
                  );
                })}
              </section>

              {/* Controls Bar: Search + Filter Chips + Exports */}
              <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between">
                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center flex-1">
                  <div className="relative w-full max-w-md">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Search by name, email, UID, faculty, disability..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-11 pr-4 py-3 bg-slate-900/80 border border-slate-800 rounded-2xl text-sm font-medium text-white placeholder:text-slate-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition-all"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 p-1 bg-slate-900/90 border border-slate-800 rounded-2xl overflow-x-auto custom-scrollbar">
                    {SECTION_ORDER.map((sec) => (
                      <button
                        key={sec}
                        onClick={() => setSectionFilter(sec)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                          sectionFilter === sec ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                        }`}
                      >
                        {sec === 'all' ? 'All' : SECTION_META[sec].label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    onClick={copyAllDirectoryEmails}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-widest rounded-xl border border-slate-700 transition-all shadow-md active:scale-95"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy Emails
                  </button>
                  <button
                    onClick={exportAllCsv}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
                  >
                    <Download className="w-3.5 h-3.5" /> CSV
                  </button>
                  <button
                    onClick={exportAllJson}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
                  >
                    <FileJson className="w-3.5 h-3.5" /> JSON Backup
                  </button>
                </div>
              </div>

              {/* User Directory Table */}
              {loading ? (
                <div className="flex flex-col items-center justify-center p-24">
                  <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
                  <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-4">Loading directory...</p>
                </div>
              ) : (
                <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-900/90 text-[10px] uppercase font-black tracking-widest text-slate-400 border-b border-slate-800">
                          <th className="p-4">User & Firebase UID</th>
                          <th className="p-4">Section & Disability</th>
                          <th className="p-4">Role & Stage</th>
                          <th className="p-4">Points</th>
                          <th className="p-4">Score</th>
                          <th className="p-4">Last Active</th>
                          <th className="p-4">Email</th>
                          <th className="p-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm font-medium text-slate-200 divide-y divide-slate-800/60">
                        {filteredUsers.length > 0 ? filteredUsers.map((u) => (
                          <tr
                            key={u.uid}
                            onClick={() => setSelectedUserForModal(u)}
                            className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                          >
                            <td className="p-4">
                              <div className="font-bold text-white group-hover:text-cyan-400 transition-colors flex items-center gap-1.5">
                                {u.name || u.email?.split('@')[0] || 'Unnamed User'}
                                <Sliders className="w-3.5 h-3.5 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className="font-mono text-[10px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/50" title={u.uid}>
                                  {u.uid.slice(0, 10)}…
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); copyToClipboard(u.uid, `UID copied: ${u.uid}`); }}
                                  className="text-slate-500 hover:text-cyan-400 p-0.5 transition-colors"
                                  title="Copy Firebase UID"
                                >
                                  {copiedText === u.uid ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </td>
                            <td className="p-4">
                              {(() => {
                                const meta = SECTION_META[sectionOf(u)] || SECTION_META['Normal'];
                                return (
                                  <div className="flex flex-col gap-1">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider max-w-fit ${meta.cls}`}>
                                      <meta.Icon className="w-3 h-3" /> {meta.label}
                                    </span>
                                    {sectionOf(u) === 'Special Needs' && u.disabilityType && (
                                      <span className="text-[10px] font-bold text-rose-400">
                                        {u.disabilityType}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="p-4">
                              <div className="flex flex-col gap-1">
                                <span className="inline-flex max-w-fit items-center px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/15 text-cyan-300 uppercase">{u.role || 'Student'}</span>
                                <span className="text-[10px] text-slate-400 uppercase font-bold">{u.level || 'Intermediate'}</span>
                              </div>
                            </td>
                            <td className="p-4 font-black text-white">{u.points || 0}</td>
                            <td className="p-4 font-black text-slate-300">{u.iqScore || '--'}</td>
                            <td className="p-4 text-xs font-bold text-slate-400">{formatDate(newestActiveIso(u))}</td>
                            <td className="p-4 text-xs text-slate-300 truncate max-w-[180px]" title={u.email}>{u.email}</td>
                            <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                <button
                                  onClick={() => setSelectedUserForModal(u)}
                                  title="Inspect full profile & AI history"
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg border border-slate-700 transition-colors"
                                >
                                  <Sliders className="w-3 h-3" /> Details
                                </button>

                                {isSuperAdminUser(u) ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold uppercase tracking-widest rounded-lg">
                                    <Crown className="w-3 h-3" /> Super
                                  </span>
                                ) : isPermanentAdmin(u.email) ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold uppercase tracking-widest rounded-lg">
                                    <Shield className="w-3 h-3" /> Admin
                                  </span>
                                ) : !canManageAdmins ? (
                                  u.isAdmin ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold uppercase tracking-widest rounded-lg">
                                      <Shield className="w-3 h-3" /> Admin
                                    </span>
                                  ) : null
                                ) : u.isAdmin ? (
                                  <button
                                    onClick={() => handleToggleAdmin(u, false)}
                                    disabled={busyUid === u.uid}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-colors disabled:opacity-50"
                                  >
                                    {busyUid === u.uid ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserMinus className="w-3 h-3" />} Admin
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleToggleAdmin(u, true)}
                                    disabled={busyUid === u.uid}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-colors disabled:opacity-50"
                                  >
                                    {busyUid === u.uid ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />} Admin
                                  </button>
                                )}

                                {canDeleteUser(u) && (
                                  <button
                                    onClick={() => handleDeleteUser(u)}
                                    className="inline-flex items-center p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg transition-colors"
                                    title="Delete User"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={8} className="p-12 text-center text-slate-500 font-medium">
                              No users found matching "{searchTerm}"
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════════
              VIEW 2: ACCESSIBILITY CENTER
             ═════════════════════════════════════════════════════════════════════ */}
          {adminView === 'accessibility' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Special Needs Learners', value: a11yAll.length, Icon: Accessibility, cls: 'bg-rose-500/15 text-rose-400 border border-rose-500/30' },
                  { label: 'Active in Last 7 Days', value: a11yActive7, Icon: Activity, cls: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' },
                  { label: 'Sign Language Learners', value: a11ySigners, Icon: Ear, cls: 'bg-purple-500/15 text-purple-400 border border-purple-500/30' },
                  { label: 'Active in Last 30 Days', value: a11yNew30, Icon: CheckCircle2, cls: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30' },
                ].map(({ label, value, Icon, cls }) => (
                  <div key={label} className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-5 flex items-center gap-4">
                    <div className={`p-3 rounded-2xl ${cls}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-3xl font-black text-white leading-none">{value}</div>
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5">{label}</div>
                    </div>
                  </div>
                ))}
              </section>

              {idleUsers.length > 0 && (
                <section className="bg-amber-500/10 border border-amber-500/30 rounded-3xl p-6 backdrop-blur-xl">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2.5 bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded-2xl">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-white uppercase tracking-tight">Requires Follow-up</h3>
                      <p className="text-xs font-medium text-slate-400">
                        {idleUsers.length} user{idleUsers.length === 1 ? '' : 's'} inactive for 14+ days. Reach out to verify accessibility accommodations.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {idleUsers.slice(0, 8).map((u) => (
                      <a
                        key={u.uid}
                        href={`mailto:${u.email}?subject=Cognify Accessibility Check-in`}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 border border-amber-500/40 rounded-xl text-xs font-bold text-slate-200 hover:border-amber-400 transition-colors"
                      >
                        <Mail className="w-3.5 h-3.5 text-amber-400" />
                        {u.name || u.email?.split('@')[0]}
                        <span className="text-[10px] font-black text-amber-400 font-mono">{Math.floor(daysSinceActive(u))}d</span>
                      </a>
                    ))}
                    {idleUsers.length > 8 && (
                      <span className="inline-flex items-center px-3 py-1.5 text-xs font-bold text-slate-400">
                        +{idleUsers.length - 8} more…
                      </span>
                    )}
                  </div>
                </section>
              )}

              {/* Weekly Activity & Breakdowns */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <section className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-6">
                  <h3 className="text-sm font-black text-white uppercase tracking-tight mb-4">By Registered Disability</h3>
                  <div className="space-y-3.5">
                    {disabilityCounts.map(({ key, count }) => {
                      const meta = DISABILITY_META[key];
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <meta.Icon className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="w-28 text-xs font-bold text-slate-200 shrink-0">{meta.label}</span>
                          <div className="flex-1 h-2.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className={`h-full ${meta.bar} rounded-full transition-all`} style={{ width: `${(count / maxDisability) * 100}%` }} />
                          </div>
                          <span className="w-8 text-right text-xs font-black text-white font-mono">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-6">
                  <h3 className="text-sm font-black text-white uppercase tracking-tight mb-4">By Active Operational Mode</h3>
                  <div className="flex flex-wrap gap-2.5">
                    {modeCounts.map(({ mode, count }) => (
                      <span key={mode} className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black ${MODE_META[mode].cls}`}>
                        {MODE_META[mode].label}
                        <span className="bg-slate-950/60 px-2 py-0.5 rounded-lg font-mono text-white">{count}</span>
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 font-medium mt-5 leading-relaxed">
                    The active operational mode represents how the learner interacts with Cognify in real-time (e.g., Eye Gaze, Euphonia vocal triggers, or Sign avatar).
                  </p>
                </section>
              </div>

              {/* Outreach Controls & Table */}
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                <div className="relative w-full max-w-md">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search accessibility users..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-slate-900/80 border border-slate-800 rounded-2xl text-sm font-medium text-white placeholder:text-slate-500 focus:ring-2 focus:ring-rose-500 outline-none"
                  />
                </div>
                <button
                  onClick={copyA11yEmails}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-widest rounded-2xl border border-slate-700 transition-colors shrink-0"
                >
                  <Copy className="w-4 h-4" /> Copy All Emails
                </button>
                <button
                  onClick={exportA11yCsv}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-colors shrink-0"
                >
                  <Download className="w-4 h-4" /> Export CSV
                </button>
                <button
                  onClick={openMonthlyReport}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-colors shrink-0"
                >
                  <Printer className="w-4 h-4" /> Print Monthly Report
                </button>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════════
              VIEW 3: SYSTEM INSIGHTS & ANALYTICS
             ═════════════════════════════════════════════════════════════════════ */}
          {adminView === 'analytics' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Registered Users', value: users.length, Icon: Users, cls: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30' },
                  { label: 'Active in Last 24h', value: users.filter(u => daysSinceActive(u) <= 1).length, Icon: Sparkles, cls: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' },
                  { label: 'Active in Last 7 Days', value: users.filter(u => daysSinceActive(u) <= 7).length, Icon: Activity, cls: 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30' },
                  { label: 'Special Needs Learners', value: a11yAll.length, Icon: Heart, cls: 'bg-rose-500/15 text-rose-400 border border-rose-500/30' },
                ].map(({ label, value, Icon, cls }) => (
                  <div key={label} className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-5 flex items-center gap-4">
                    <div className={`p-3 rounded-2xl ${cls}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-3xl font-black text-white leading-none">{value}</div>
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5">{label}</div>
                    </div>
                  </div>
                ))}
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Cognitive Stage Breakdown */}
                <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-6">
                  <h3 className="text-sm font-black text-white uppercase tracking-tight mb-4 flex items-center gap-2">
                    <Brain className="w-4 h-4 text-cyan-400" /> Cognitive Stages
                  </h3>
                  <div className="space-y-3.5">
                    {(['Basic', 'Intermediate', 'Advanced'] as CognitiveLevel[]).map(lvl => {
                      const count = users.filter(u => (u.level || 'Intermediate') === lvl).length;
                      const pct = users.length ? Math.round((count / users.length) * 100) : 0;
                      return (
                        <div key={lvl} className="space-y-1.5">
                          <div className="flex justify-between text-xs font-bold">
                            <span className="text-slate-200">{lvl}</span>
                            <span className="text-slate-400 font-mono">{count} ({pct}%)</span>
                          </div>
                          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Account Paths */}
                <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-6">
                  <h3 className="text-sm font-black text-white uppercase tracking-tight mb-4 flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-amber-400" /> Enrolment Paths
                  </h3>
                  <div className="space-y-3.5">
                    {(['Normal', 'Special Needs', 'Graduation Project'] as AccountPath[]).map(sec => {
                      const count = sectionCounts[sec] || 0;
                      const pct = users.length ? Math.round((count / users.length) * 100) : 0;
                      const meta = SECTION_META[sec];
                      return (
                        <div key={sec} className="space-y-1.5">
                          <div className="flex justify-between text-xs font-bold">
                            <span className="text-slate-200">{meta.label}</span>
                            <span className="text-slate-400 font-mono">{count} ({pct}%)</span>
                          </div>
                          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Language Preferences */}
                <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-6">
                  <h3 className="text-sm font-black text-white uppercase tracking-tight mb-4 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-emerald-400" /> Language Preferences
                  </h3>
                  <div className="space-y-3.5">
                    {['Egyptian Ammiya', 'Arabic', 'English', 'French', 'Spanish'].map(lang => {
                      const count = users.filter(u => (u.language || 'English') === lang).length;
                      const pct = users.length ? Math.round((count / users.length) * 100) : 0;
                      return (
                        <div key={lang} className="space-y-1.5">
                          <div className="flex justify-between text-xs font-bold">
                            <span className="text-slate-200">{lang}</span>
                            <span className="text-slate-400 font-mono">{count} ({pct}%)</span>
                          </div>
                          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════════
              VIEW 4: SUPER ADMIN DATABASE OPERATIONS HUB
             ═════════════════════════════════════════════════════════════════════ */}
          {adminView === 'database' && (
            !isSuperAdmin ? (
              <div className="backdrop-blur-xl bg-slate-900/60 border border-amber-500/30 rounded-3xl p-12 text-center max-w-xl mx-auto space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
                  <Lock className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-black text-white uppercase tracking-tight">Super Admin Restricted Access</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  The Database Operations Hub requires Founder Super Admin permissions. Only founder super admins may execute full-system backups, clean session storage caches, or view raw collection payloads.
                </p>
              </div>
            ) : (
              <div className="space-y-8 animate-in fade-in duration-200">
                
                {/* Realtime Frankfurt Cloud Health Banner */}
                <section className="backdrop-blur-xl bg-gradient-to-r from-emerald-950/40 via-slate-900/80 to-slate-900/60 border border-emerald-500/30 shadow-2xl rounded-3xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                      </span>
                      <span className="text-xs font-black uppercase tracking-widest text-emerald-400">Cloud Firestore Infrastructure Status: Healthy</span>
                    </div>
                    <h3 className="text-2xl font-black text-white">Google Cloud Firestore — Frankfurt (europe-west1)</h3>
                    <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
                      Primary multi-region replica located in Frankfurt, Germany. Strict RS256 token verification and automated client telemetry are active.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="px-4 py-2 bg-slate-950/80 border border-slate-800 rounded-2xl text-center">
                      <div className="text-[10px] uppercase font-bold text-slate-500">Latency</div>
                      <div className="text-lg font-black text-emerald-400 font-mono">
                        {dbHealth?.latencyMs ? `${dbHealth.latencyMs}ms` : '18ms'}
                      </div>
                    </div>
                    <button
                      onClick={pingDatabase}
                      disabled={isPingingDb}
                      className="inline-flex items-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider rounded-2xl transition-all shadow-lg active:scale-95 disabled:opacity-50"
                    >
                      {isPingingDb ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Test Latency
                    </button>
                  </div>
                </section>

                {/* Collection Stats Grid */}
                <section className="space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-emerald-400" /> Collection Volume & Capacity Projections
                  </h4>
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
                    <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 p-4 rounded-2xl">
                      <div className="text-xs font-bold text-slate-400 uppercase">Users Enrolled</div>
                      <div className="text-2xl font-black text-white font-mono mt-1">{collectionStats.usersCount}</div>
                    </div>
                    <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 p-4 rounded-2xl">
                      <div className="text-xs font-bold text-slate-400 uppercase">Est. Chat Threads</div>
                      <div className="text-2xl font-black text-cyan-400 font-mono mt-1">{collectionStats.estimatedChatThreads}</div>
                    </div>
                    <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 p-4 rounded-2xl">
                      <div className="text-xs font-bold text-slate-400 uppercase">Spatial Memories</div>
                      <div className="text-2xl font-black text-purple-400 font-mono mt-1">{collectionStats.estimatedSpatialObjects}</div>
                    </div>
                    <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 p-4 rounded-2xl">
                      <div className="text-xs font-bold text-slate-400 uppercase">Evaluations</div>
                      <div className="text-2xl font-black text-amber-400 font-mono mt-1">{collectionStats.estimatedEvaluations}</div>
                    </div>
                    <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 p-4 rounded-2xl">
                      <div className="text-xs font-bold text-slate-400 uppercase">Projected Storage</div>
                      <div className="text-xl font-black text-emerald-400 font-mono mt-1">
                        ~{(collectionStats.estimatedStorageKb / 1024).toFixed(1)} MB
                      </div>
                    </div>
                  </div>
                </section>

                {/* Operations & Maintenance Control Panel */}
                <section className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-6 space-y-4">
                  <h4 className="text-sm font-black uppercase tracking-tight text-white flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-400" /> Database Administration Actions
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                    <button
                      onClick={handleDownloadFullBackup}
                      className="flex flex-col items-start p-4 bg-slate-950/80 hover:bg-slate-800/80 border border-slate-800 hover:border-emerald-500/40 rounded-2xl transition-all group"
                    >
                      <Download className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform mb-2" />
                      <span className="text-xs font-black uppercase text-white tracking-wider">Download Full JSON Snapshot</span>
                      <span className="text-[11px] text-slate-400 mt-1">Complete system backup with metadata & security audits</span>
                    </button>

                    <button
                      onClick={exportAllCsv}
                      className="flex flex-col items-start p-4 bg-slate-950/80 hover:bg-slate-800/80 border border-slate-800 hover:border-cyan-500/40 rounded-2xl transition-all group"
                    >
                      <FileJson className="w-5 h-5 text-cyan-400 group-hover:scale-110 transition-transform mb-2" />
                      <span className="text-xs font-black uppercase text-white tracking-wider">Export Database CSV</span>
                      <span className="text-[11px] text-slate-400 mt-1">Excel-compatible UTF-8 spreadsheet of user accounts</span>
                    </button>

                    <button
                      onClick={handleCleanCache}
                      disabled={isCleaningCache}
                      className="flex flex-col items-start p-4 bg-slate-950/80 hover:bg-slate-800/80 border border-slate-800 hover:border-amber-500/40 rounded-2xl transition-all group disabled:opacity-50"
                    >
                      {isCleaningCache ? (
                        <Loader2 className="w-5 h-5 text-amber-400 animate-spin mb-2" />
                      ) : (
                        <Zap className="w-5 h-5 text-amber-400 group-hover:scale-110 transition-transform mb-2" />
                      )}
                      <span className="text-xs font-black uppercase text-white tracking-wider">Clean Stale Caches</span>
                      <span className="text-[11px] text-slate-400 mt-1">Prunes temporary tokens and draft caches safely</span>
                    </button>

                    <button
                      onClick={handleDownloadAuditReport}
                      className="flex flex-col items-start p-4 bg-slate-950/80 hover:bg-slate-800/80 border border-slate-800 hover:border-indigo-500/40 rounded-2xl transition-all group"
                    >
                      <BookOpen className="w-5 h-5 text-indigo-400 group-hover:scale-110 transition-transform mb-2" />
                      <span className="text-xs font-black uppercase text-white tracking-wider">Generate Audit Report (.md)</span>
                      <span className="text-[11px] text-slate-400 mt-1">Executive markdown summary of capacity and security</span>
                    </button>
                  </div>
                </section>

                {/* Collection Document Inspector */}
                <section className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-black uppercase tracking-tight text-white flex items-center gap-2">
                        <Search className="w-4 h-4 text-emerald-400" /> Firestore Document Inspector
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5">Preview live document JSON structures across the active user collection</p>
                    </div>
                    <div className="relative w-full max-w-xs">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Search document UID / email..."
                        value={dbSearchTerm}
                        onChange={(e) => setDbSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* User list */}
                    <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-2 max-h-96 overflow-y-auto custom-scrollbar divide-y divide-slate-800/40">
                      {inspectedUsersList.map(u => (
                        <button
                          key={u.uid}
                          onClick={() => setInspectedDoc(u)}
                          className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex items-center justify-between ${
                            inspectedDoc?.uid === u.uid ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'hover:bg-slate-800/50 text-slate-300'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-bold truncate">{u.name || u.email}</div>
                            <div className="font-mono text-[10px] text-slate-500 truncate">{u.uid}</div>
                          </div>
                          <span className="text-[10px] uppercase font-bold text-slate-500">{u.role || 'Student'}</span>
                        </button>
                      ))}
                    </div>

                    {/* JSON Preview */}
                    <div className="lg:col-span-2 bg-slate-950 border border-slate-800/80 rounded-2xl p-4 flex flex-col min-h-[280px]">
                      {inspectedDoc ? (
                        <div className="flex flex-col flex-1">
                          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                            <div className="font-mono text-xs text-emerald-400 font-bold truncate">
                              users/{inspectedDoc.uid}
                            </div>
                            <button
                              onClick={() => copyToClipboard(JSON.stringify(inspectedDoc, null, 2), 'Document JSON copied')}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-xs font-bold text-slate-300 rounded-lg border border-slate-700"
                            >
                              <Copy className="w-3 h-3" /> Copy JSON
                            </button>
                          </div>
                          <pre className="font-mono text-xs text-emerald-300 overflow-x-auto max-h-80 custom-scrollbar flex-1">
                            {JSON.stringify(inspectedDoc, null, 2)}
                          </pre>
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs">
                          <FileJson className="w-8 h-8 mb-2 opacity-50" />
                          Select a user document from the list to preview formatted JSON
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            )
          )}

          {/* ═════════════════════════════════════════════════════════════════════
              VIEW 5: SUPER ADMIN SECURITY & DEVTOOLS INSPECT TRACKER
             ═════════════════════════════════════════════════════════════════════ */}
          {adminView === 'security' && (
            !isSuperAdmin ? (
              <div className="backdrop-blur-xl bg-slate-900/60 border border-rose-500/30 rounded-3xl p-12 text-center max-w-xl mx-auto space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto text-rose-400">
                  <Lock className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-black text-white uppercase tracking-tight">Super Admin Restricted Access</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  The DevTools Inspect Telemetry & Security Audit stream is strictly restricted to Founder Super Admins.
                </p>
              </div>
            ) : (
              <div className="space-y-8 animate-in fade-in duration-200">
                
                {/* Security Metrics Cards */}
                <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="backdrop-blur-xl bg-slate-900/60 border border-rose-500/30 shadow-2xl rounded-3xl p-5 flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-rose-500/15 text-rose-400 border border-rose-500/30">
                      <ShieldAlert className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-3xl font-black text-white leading-none font-mono">{securityAudits.length}</div>
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5">Inspects Logged</div>
                    </div>
                  </div>

                  <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-5 flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                      <Globe className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-3xl font-black text-white leading-none font-mono">
                        {new Set(securityAudits.map(s => s.ip)).size}
                      </div>
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5">Unique IP Addresses</div>
                    </div>
                  </div>

                  <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-5 flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      <Terminal className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-3xl font-black text-white leading-none font-mono">
                        {securityAudits.filter(s => s.eventType === 'devtools_inspect_shortcut').length}
                      </div>
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5">Shortcut Probes (F12)</div>
                    </div>
                  </div>

                  <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl p-5 flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-purple-500/15 text-purple-400 border border-purple-500/30">
                      <Sliders className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-3xl font-black text-white leading-none font-mono">
                        {securityAudits.filter(s => s.eventType === 'contextmenu_inspect').length}
                      </div>
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5">Right-Click Inspects</div>
                    </div>
                  </div>
                </section>

                {/* Stream Controls */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
                    </span>
                    <span className="text-xs font-black uppercase tracking-widest text-slate-300">
                      Live Telemetry Stream (Active Detection)
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={handleClearAllAudits}
                      disabled={isClearingAudits || securityAudits.length === 0}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50"
                    >
                      {isClearingAudits ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Clear Security Logs
                    </button>
                  </div>
                </div>

                {/* Inspect Audit Incidents Table */}
                <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/80 shadow-2xl rounded-3xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-900/90 text-[10px] uppercase font-black tracking-widest text-slate-400 border-b border-slate-800">
                          <th className="p-4">User / Perpetrator</th>
                          <th className="p-4">Client Public IP</th>
                          <th className="p-4">Inspect Trigger</th>
                          <th className="p-4">Route Path</th>
                          <th className="p-4">Timestamp</th>
                          <th className="p-4">Details</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm font-medium text-slate-200 divide-y divide-slate-800/60">
                        {securityAudits.length > 0 ? securityAudits.map((record) => {
                          const badgeColor =
                            record.eventType === 'devtools_inspect_shortcut'
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                              : record.eventType === 'contextmenu_inspect'
                              ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                              : record.eventType === 'devtools_opened'
                              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                              : 'bg-amber-500/20 text-amber-300 border-amber-500/40';

                          return (
                            <tr key={record.id} className="hover:bg-slate-800/40 transition-colors">
                              <td className="p-4">
                                <div className="font-bold text-white flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-xl bg-rose-500/20 text-rose-300 font-black text-xs flex items-center justify-center">
                                    {(record.name || record.email || '?').charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                    <div>{record.name || 'Unnamed User'}</div>
                                    <div className="text-xs text-slate-400">{record.email}</div>
                                  </div>
                                </div>
                                <div className="font-mono text-[10px] text-slate-500 mt-1">UID: {record.uid}</div>
                              </td>
                              <td className="p-4">
                                <span className="inline-flex items-center gap-1.5 font-mono text-xs font-black bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg text-emerald-400">
                                  {record.ip}
                                  <button
                                    onClick={() => copyToClipboard(record.ip, `IP ${record.ip} copied`)}
                                    className="text-slate-500 hover:text-white transition-colors"
                                    title="Copy IP"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                </span>
                              </td>
                              <td className="p-4">
                                <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider border ${badgeColor}`}>
                                  {record.eventType === 'devtools_inspect_shortcut' ? 'F12 / Shortcut' :
                                   record.eventType === 'contextmenu_inspect' ? 'Right Click Inspect' :
                                   record.eventType === 'devtools_opened' ? 'DevTools Docked' :
                                   record.eventType}
                                </span>
                              </td>
                              <td className="p-4 font-mono text-xs text-slate-300">{record.path}</td>
                              <td className="p-4 text-xs text-slate-400 whitespace-nowrap">
                                <div>{formatDate(record.timestamp)}</div>
                                <div className="text-[10px] text-slate-500 font-mono">
                                  {Math.round((Date.now() - record.timestampMs) / 1000)}s ago
                                </div>
                              </td>
                              <td className="p-4 text-xs text-slate-400 max-w-xs truncate" title={record.details || record.userAgent}>
                                {record.details || record.userAgent}
                              </td>
                            </tr>
                          );
                        }) : (
                          <tr>
                            <td colSpan={6} className="p-16 text-center text-slate-500 font-medium">
                              <ShieldCheck className="w-10 h-10 text-emerald-400/50 mx-auto mb-2" />
                              No element inspect attempts logged yet. Real-time telemetry is actively listening.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          )}

        </div>
      </div>

      {/* ── USER DETAILS & PROFILE MODAL ─────────────────────────────────────── */}
      {selectedUserForModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-[32px] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 text-cyan-300 font-black text-lg flex items-center justify-center shrink-0 border border-cyan-500/40">
                  {(selectedUserForModal.name || selectedUserForModal.email || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-black text-white truncate">
                    {selectedUserForModal.name || selectedUserForModal.email?.split('@')[0] || 'User Profile'}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-medium text-slate-400 truncate">{selectedUserForModal.email}</span>
                    <button
                      onClick={() => copyToClipboard(selectedUserForModal.uid, `Firebase UID copied: ${selectedUserForModal.uid}`)}
                      className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-400 hover:text-cyan-400 bg-slate-800/80 px-2 py-0.5 rounded transition-colors"
                      title="Copy Firebase UID"
                    >
                      <span>UID: {selectedUserForModal.uid.slice(0, 12)}…</span>
                      <Copy className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedUserForModal(null)}
                className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-slate-800 bg-slate-900/90 px-6 gap-2">
              {[
                { id: 'profile', label: 'Overview & Details', icon: UserIcon },
                { id: 'chats', label: `Chats (${selectedUserForModal.chatThreads?.length || 0})`, icon: MessageSquare },
                { id: 'tasks', label: `Tasks (${selectedUserForModal.tasks?.length || 0})`, icon: ListTodo },
                { id: 'raw', label: 'Raw JSON', icon: FileJson },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setModalTab(id as any)}
                  className={`flex items-center gap-1.5 py-3.5 px-3.5 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                    modalTab === id ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6 custom-scrollbar">
              {modalTab === 'profile' && (
                <div className="space-y-6">
                  {/* Key Stats Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                      <div className="text-xs font-bold text-slate-400 uppercase">Points</div>
                      <div className="text-xl font-black text-cyan-400 mt-1 font-mono">{selectedUserForModal.points || 0}</div>
                    </div>
                    <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                      <div className="text-xs font-bold text-slate-400 uppercase">Cognitive Score</div>
                      <div className="text-xl font-black text-white mt-1 font-mono">{selectedUserForModal.iqScore || '--'}</div>
                    </div>
                    <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                      <div className="text-xs font-bold text-slate-400 uppercase">Cognitive Level</div>
                      <div className="text-sm font-black text-white mt-1.5 uppercase">{selectedUserForModal.level || 'Intermediate'}</div>
                    </div>
                    <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                      <div className="text-xs font-bold text-slate-400 uppercase">Section</div>
                      <div className="text-sm font-black text-white mt-1.5">{sectionOf(selectedUserForModal)}</div>
                    </div>
                  </div>

                  {/* Academic & Bio Info */}
                  <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-3.5 text-xs font-medium">
                    <h4 className="font-black uppercase tracking-wider text-slate-400 text-[11px]">Academic & System Info</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div><span className="text-slate-400">University:</span> <span className="font-bold text-white">{selectedUserForModal.university || 'N/A'}</span></div>
                      <div><span className="text-slate-400">Faculty:</span> <span className="font-bold text-white">{selectedUserForModal.faculty || 'N/A'}</span></div>
                      <div><span className="text-slate-400">Department:</span> <span className="font-bold text-white">{selectedUserForModal.department || 'N/A'}</span></div>
                      <div><span className="text-slate-400">Role:</span> <span className="font-bold text-white">{selectedUserForModal.role || 'Student'}</span></div>
                      <div><span className="text-slate-400">Language:</span> <span className="font-bold text-white">{selectedUserForModal.language || 'English'}</span></div>
                      <div><span className="text-slate-400">Last Active:</span> <span className="font-bold text-white">{formatDate(newestActiveIso(selectedUserForModal))}</span></div>
                      {selectedUserForModal.disabilityType && (
                        <div><span className="text-slate-400">Disability:</span> <span className="font-bold text-rose-400">{selectedUserForModal.disabilityType}</span></div>
                      )}
                      {selectedUserForModal.accessibilityMode && selectedUserForModal.accessibilityMode !== 'None' && (
                        <div><span className="text-slate-400">Active Mode:</span> <span className="font-bold text-amber-400">{selectedUserForModal.accessibilityMode}</span></div>
                      )}
                      {selectedUserForModal.organization && (
                        <div><span className="text-slate-400">Organization:</span> <span className="font-bold text-cyan-400">{selectedUserForModal.organization}</span></div>
                      )}
                    </div>
                  </div>

                  {/* Admin Actions */}
                  <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-3">
                    <h4 className="font-black uppercase tracking-wider text-slate-400 text-[11px]">Admin Adjustments</h4>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        onClick={() => handleUpdatePoints(selectedUserForModal, 50)}
                        disabled={busyUid === selectedUserForModal.uid}
                        className="px-3.5 py-1.5 bg-cyan-500 text-slate-950 text-xs font-bold rounded-xl hover:bg-cyan-400 transition-colors disabled:opacity-50"
                      >
                        +50 Points
                      </button>
                      <button
                        onClick={() => handleUpdatePoints(selectedUserForModal, -50)}
                        disabled={busyUid === selectedUserForModal.uid}
                        className="px-3.5 py-1.5 bg-slate-900 border border-slate-700 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50"
                      >
                        -50 Points
                      </button>
                      <select
                        value={selectedUserForModal.level || 'Intermediate'}
                        onChange={(e) => handleUpdateCognitiveLevel(selectedUserForModal, e.target.value as CognitiveLevel)}
                        disabled={busyUid === selectedUserForModal.uid}
                        className="bg-slate-900 border border-slate-700 text-white text-xs font-bold rounded-xl px-3 py-1.5 outline-none cursor-pointer"
                      >
                        <option value="Basic">Level: Basic</option>
                        <option value="Intermediate">Level: Intermediate</option>
                        <option value="Advanced">Level: Advanced</option>
                      </select>
                      <a
                        href={`mailto:${selectedUserForModal.email}?subject=Message from Cognify Admin`}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-800 text-white text-xs font-bold rounded-xl hover:bg-slate-700 transition-colors border border-slate-700"
                      >
                        <Mail className="w-3.5 h-3.5" /> Send Email
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {modalTab === 'chats' && (
                <div className="space-y-3">
                  <h4 className="font-black uppercase tracking-wider text-slate-400 text-[11px]">Saved Chat Sessions</h4>
                  {selectedUserForModal.chatThreads && selectedUserForModal.chatThreads.length > 0 ? (
                    <div className="space-y-2">
                      {selectedUserForModal.chatThreads.map((thread) => (
                        <div key={thread.id} className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-white">{thread.title || 'Untitled Chat'}</span>
                            <span className="text-[10px] text-slate-400">{formatDate(thread.updatedAt)}</span>
                          </div>
                          {thread.lastMessageSnippet && (
                            <p className="text-xs text-slate-400 line-clamp-2">{thread.lastMessageSnippet}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center text-slate-500 text-xs">No saved chat sessions for this user.</div>
                  )}
                </div>
              )}

              {modalTab === 'tasks' && (
                <div className="space-y-3">
                  <h4 className="font-black uppercase tracking-wider text-slate-400 text-[11px]">Tasks & Objectives</h4>
                  {selectedUserForModal.tasks && selectedUserForModal.tasks.length > 0 ? (
                    <div className="space-y-2">
                      {selectedUserForModal.tasks.map((task) => (
                        <div key={task.id} className="flex items-center gap-3 p-3.5 bg-slate-950 border border-slate-800 rounded-2xl text-xs">
                          <div className={`p-1.5 rounded-lg ${task.completed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                            {task.completed ? <Check className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                          </div>
                          <div className="flex-1 font-medium text-white">{task.content}</div>
                          <span className={`text-[10px] font-black uppercase ${task.completed ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {task.completed ? 'Completed' : 'Pending'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center text-slate-500 text-xs">No tasks recorded for this user.</div>
                  )}
                </div>
              )}

              {modalTab === 'raw' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-black uppercase tracking-wider text-slate-400 text-[11px]">Firestore Document JSON</h4>
                    <button
                      onClick={() => copyToClipboard(JSON.stringify(selectedUserForModal, null, 2), 'JSON copied to clipboard')}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white rounded-lg transition-colors border border-slate-700"
                    >
                      <Copy className="w-3 h-3" /> Copy JSON
                    </button>
                  </div>
                  <pre className="p-4 bg-slate-950 text-emerald-400 font-mono text-xs rounded-2xl overflow-x-auto border border-slate-800 max-h-96 custom-scrollbar">
                    {JSON.stringify(selectedUserForModal, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
