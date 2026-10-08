"use client";

import { Fragment, useState } from "react";
import { formatTag } from "@/lib/handle";
import UserTag from "@/components/UserTag";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { rich } from "@/lib/i18n/rich";
import SystemIcon from "@/components/versado/SystemIcon";
import AdminSection from "@/components/admin/AdminSection";
import AdminTable from "@/components/admin/AdminTable";
import AdminNotice from "@/components/admin/AdminNotice";
import SearchField from "@/components/versado/SearchField";
import { normalizeWord } from "@/lib/dictionaryView";
import { dangerOutlineButton, secondaryButton } from "@/components/versado/styles";


interface AdminUser {
  id: string;
  email: string;
  handle: string;
  discriminator: string;
  isAdmin: boolean;
  xpTotal: number;
  currentStreak: number;
  freezeCount: number;
  online: boolean;
  // null als `online` true is — dan is er niets "geleden" te tonen.
  lastSeenLabel: string | null;
  createdAt: string;
}

export default function AdminUsersClient({
  initialUsers,
  currentUserId,
}: {
  initialUsers: AdminUser[];
  currentUserId: string;
}) {
  const t = useT();
  const confirm = useConfirm();
  const [users, setUsers] = useState(initialUsers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Bij honderden accounts is zoeken de snelste weg; de filter raakt nooit de bewerkingen zelf.
  const needle = normalizeWord(query);
  const visibleUsers = needle ? users.filter((u) => normalizeWord(`${u.handle}#${u.discriminator} ${u.email}`).includes(needle)) : users;
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const [emailedResets, setEmailedResets] = useState<Record<string, string>>({});

  async function toggleAdmin(userId: string, nextIsAdmin: boolean) {
    setError(null);
    setBusyId(userId);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAdmin: nextIsAdmin }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? t("adminCommon.error"));
      return;
    }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isAdmin: nextIsAdmin } : u)));
  }

  async function resetPassword(userId: string) {
    if (!(await confirm(t("adminUsers.confirmReset")))) return;
    setError(null);
    setBusyId(userId);
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, { method: "POST" });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? t("adminCommon.error"));
      return;
    }
    const data = await res.json();
    if (data.emailed) {
      setEmailedResets((prev) => ({ ...prev, [userId]: data.email }));
    } else {
      setRevealedPasswords((prev) => ({ ...prev, [userId]: data.tempPassword }));
    }
  }

  async function deleteUser(u: AdminUser) {
    if (
      !(await confirm(
        t("adminUsers.confirmDelete", { name: formatTag(u.handle, u.discriminator) })
      ))
    ) {
      return;
    }
    setError(null);
    setBusyId(u.id);
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? t("adminCommon.error"));
      return;
    }
    setUsers((prev) => prev.filter((x) => x.id !== u.id));
  }

  return (
    <AdminSection title={t("adminUsers.title", { n: users.length })}>
      {error && <AdminNotice kind="error">{error}</AdminNotice>}
      <SearchField value={query} onChange={setQuery} placeholder={t("adminUsers.search")} label={t("adminUsers.search")} clearLabel={t("dictionary.clear")} />
      {visibleUsers.length === 0 && <AdminNotice kind="info">{t("adminUsers.noMatches")}</AdminNotice>}
      <AdminTable label={t("adminUsers.tableLabel")}>
      {/* Eén regel per gebruiker: niets breekt af, de tabel is zo breed als zijn inhoud en
          schuift zijwaarts binnen het vak. De naam blijft links staan tijdens het schuiven. */}
      <table className="w-max min-w-full text-sm [&_button]:whitespace-nowrap [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <thead>
          <tr className="text-left text-xs font-bold uppercase text-vs-fg-3 border-b border-vs-line">
            <th className="sticky left-0 z-[1] bg-vs-surface shadow-[4px_0_6px_-4px_rgb(var(--vs-shadow)/0.18)] py-2 pl-3 pr-3">{t("adminUsers.username")}</th>
            <th className="py-2 pr-3">{t("adminUsers.email")}</th>
            <th className="py-2 pr-3">{t("adminUsers.status")}</th>
            <th className="py-2 pr-3">XP</th>
            <th className="py-2 pr-3">{t("adminUsers.streak")}</th>
            <th className="py-2 pr-3">{t("adminUsers.freezes")}</th>
            <th className="py-2 pr-3">{t("adminUsers.admin")}</th>
            <th className="py-2 pr-3" colSpan={3} />
          </tr>
        </thead>
        <tbody>
          {visibleUsers.map((u) => (
            <Fragment key={u.id}>
              <tr className="border-b border-vs-line">
                <td className="sticky left-0 z-[1] bg-vs-surface shadow-[4px_0_6px_-4px_rgb(var(--vs-shadow)/0.18)] py-2 pl-3 pr-3 font-bold text-vs-fg">
                  <UserTag handle={u.handle} discriminator={u.discriminator} />
                  {u.id === currentUserId && <span className="text-vs-accent font-normal">{t("adminUsers.you")}</span>}
                </td>
                <td className="py-2 pr-3 text-vs-fg-2">{u.email}</td>
                <td className="py-2 pr-3">
                  {u.online ? (
                    <span className="text-vs-accent font-bold flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-vs-accent" aria-hidden />
                      {t("adminUsers.online")}
                    </span>
                  ) : (
                    <span className="text-vs-fg-3">{u.lastSeenLabel}</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-vs-fg">{u.xpTotal}</td>
                <td className="py-2 pr-3 text-vs-fg"><span className="inline-flex items-center gap-1"><SystemIcon kind="streak" className="h-4 w-4 text-vs-streak" fill="currentColor" aria-hidden />{u.currentStreak}</span></td>
                <td className="py-2 pr-3 text-vs-fg"><span className="inline-flex items-center gap-1"><SystemIcon kind="freeze" className="h-4 w-4 text-ice-500" aria-hidden />{u.freezeCount}</span></td>
                <td className="py-2 pr-3">
                  {u.isAdmin ? (
                    <span className="text-vs-accent font-bold">{t("adminUsers.admin")}</span>
                  ) : (
                    <span className="text-vs-fg-3">{t("adminUsers.user")}</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {u.id === currentUserId ? (
                    <span className="text-xs text-vs-fg-3">—</span>
                  ) : (
                    <button
                      className={secondaryButton}
                      disabled={busyId === u.id}
                      onClick={() => toggleAdmin(u.id, !u.isAdmin)}
                    >
                      {busyId === u.id ? t("adminCommon.busy") : u.isAdmin ? t("adminUsers.removeAdmin") : t("adminUsers.makeAdmin")}
                    </button>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <button
                    className={secondaryButton}
                    disabled={busyId === u.id}
                    onClick={() => resetPassword(u.id)}
                  >
                    {busyId === u.id ? t("adminCommon.busy") : t("adminUsers.resetPassword")}
                  </button>
                </td>
                <td className="py-2 pr-3">
                  {u.id === currentUserId ? (
                    <span className="text-xs text-vs-fg-3">—</span>
                  ) : (
                    <button
                      className={dangerOutlineButton}
                      disabled={busyId === u.id}
                      onClick={() => deleteUser(u)}
                    >
                      {busyId === u.id ? t("adminCommon.busy") : t("adminCommon.delete")}
                    </button>
                  )}
                </td>
              </tr>
              {revealedPasswords[u.id] && (
                <tr className="bg-vs-warning-soft">
                  <td colSpan={10} className="p-0 text-sm"><div className="sticky left-0 box-border w-[min(calc(100vw-3rem),40rem)] whitespace-normal px-3 py-2">
                    {rich(t("adminUsers.tempPassword"), {
                      name: <strong>{u.handle}</strong>,
                      code: (
                        <code className="bg-vs-surface px-2 py-0.5 rounded font-mono">
                          {revealedPasswords[u.id]}
                        </code>
                      ),
                    })}{" "}
                    <button
                      className="text-vs-fg-3 hover:text-vs-fg font-bold ml-2"
                      onClick={() =>
                        setRevealedPasswords((prev) => {
                          const next = { ...prev };
                          delete next[u.id];
                          return next;
                        })
                      }
                    >
                      {t("common.close")}
                    </button>
                  </div></td>
                </tr>
              )}
              {emailedResets[u.id] && (
                <tr className="bg-vs-warning-soft">
                  <td colSpan={10} className="p-0 text-sm"><div className="sticky left-0 box-border w-[min(calc(100vw-3rem),40rem)] whitespace-normal px-3 py-2">
                    {rich(t("adminUsers.resetEmailed"), { email: <strong>{emailedResets[u.id]}</strong> })}{" "}
                    <button
                      className="text-vs-fg-3 hover:text-vs-fg font-bold ml-2"
                      onClick={() =>
                        setEmailedResets((prev) => {
                          const next = { ...prev };
                          delete next[u.id];
                          return next;
                        })
                      }
                    >
                      {t("common.close")}
                    </button>
                  </div></td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      </AdminTable>
    </AdminSection>
  );
}
