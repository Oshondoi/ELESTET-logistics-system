import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'
import { getWhitelabelLogoUrl } from '../../lib/companyLogo'
import type { Account, RolePermissions } from '../../types'

interface SidebarProps {
  activePage: 'home' | 'fulfillment' | 'shipments' | 'stores' | 'directories' | 'products' | 'reviews' | 'invoices' | 'roles' | 'stickers' | 'admin' | 'glossary' | 'diary' | 'finance_report' | 'subscription' | 'payment_result'
  onSelectPage: (page: 'home' | 'fulfillment' | 'shipments' | 'stores' | 'directories' | 'products' | 'reviews' | 'invoices' | 'roles' | 'stickers' | 'admin' | 'glossary' | 'diary' | 'finance_report' | 'subscription') => void
  onOpenAddCompany: () => void
  onSignOut: () => void
  accounts: Account[]
  archivedAccounts?: Account[]
  activeAccount: Account | null
  onSelectAccount: (accountId: string) => void
  onDeleteActiveCompany: (id: string) => void
  onEditCompany: (account: Account) => void
  onRestoreAccount?: (accountId: string) => Promise<void>
  permissions: RolePermissions
  isAdmin?: boolean
}

const items = [
  {
    key: 'home',
    label: 'Главная',
    permKey: null,
    icon: (
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 10.5 12 4l9 6.5" />
        <path d="M5.5 9.5V20h13V9.5" />
        <path d="M9.5 20v-5h5V20" />
      </svg>
    ),
  },
  {
    key: 'fulfillment',
    label: 'Фулфилмент',
    permKey: 'shipments_view' as keyof import('../../types').RolePermissions,
    icon: (
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3 4.5 7v10L12 21l7.5-4V7L12 3Z" />
        <path d="M4.5 7 12 11l7.5-4" />
        <path d="M12 11v10" />
      </svg>
    ),
  },
  {
    key: 'shipments',
    label: 'Логистика',
    permKey: 'shipments_view' as keyof import('../../types').RolePermissions,
    icon: (
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="1" y="9" width="14" height="10" rx="1.5" />
        <path d="M15 13h4.5L22 16.5V19h-7" />
        <circle cx="5.5" cy="20.5" r="1.5" />
        <circle cx="18.5" cy="20.5" r="1.5" />
        <path d="M15 9V5H1" />
      </svg>
    ),
  },
  {
    key: 'stores',
    label: 'Магазины',
    permKey: 'stores_view' as keyof import('../../types').RolePermissions,
    icon: (
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 10.5 6 5h12l2 5.5" />
        <path d="M5 10h14v9H5z" />
        <path d="M9 14h6" />
      </svg>
    ),
  },
  {
    key: 'products',
    label: 'Товары',
    permKey: 'stores_view' as keyof import('../../types').RolePermissions,
    icon: (
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 6h18" />
        <path d="M3 12h18" />
        <path d="M3 18h18" />
        <rect x="3" y="3" width="4" height="4" rx="0.5" />
        <rect x="3" y="9" width="4" height="4" rx="0.5" />
        <rect x="3" y="15" width="4" height="4" rx="0.5" />
      </svg>
    ),
  },
  {
    key: 'directories',
    label: 'Справочники',
    permKey: 'directories_view' as keyof import('../../types').RolePermissions,
    icon: (
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6h16" />
        <path d="M4 10h16" />
        <path d="M4 14h10" />
        <path d="M4 18h7" />
      </svg>
    ),
  },
  {
    key: 'stickers',
    label: 'Стикеры и КИЗы',
    permKey: 'stickers_view' as keyof import('../../types').RolePermissions,
    icon: (
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M7 7h2" />
        <path d="M7 12h10" />
        <path d="M7 17h6" />
        <path d="M13 7h4" />
      </svg>
    ),
  },
  {
    key: 'reviews',
    label: 'Отзывы',
    permKey: null,
    icon: (
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M8 10h8" />
        <path d="M8 14h5" />
      </svg>
    ),
  },
  {
    key: 'invoices',
    label: 'Счета',
    permKey: null,
    icon: (
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    key: 'roles',
    label: 'Роли',
    permKey: 'roles_manage' as keyof import('../../types').RolePermissions,
    icon: (
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
        <circle cx="9.5" cy="7" r="3.5" />
        <path d="M20 8v6" />
        <path d="M17 11h6" />
      </svg>
    ),
  },
] as const

export const Sidebar = ({
  activePage,
  onSelectPage,
  onOpenAddCompany,
  onSignOut,
  accounts,
  archivedAccounts = [],
  activeAccount,
  onSelectAccount,
  onDeleteActiveCompany,
  onEditCompany,
  onRestoreAccount,
  permissions,
  isAdmin = false,
}: SidebarProps) => {
  const [isCompanyOpen, setIsCompanyOpen] = useState(false)
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false)
  const [restoringAccountId, setRestoringAccountId] = useState<string | null>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const companyRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const hasActiveAccount = Boolean(activeAccount)
  const companyName = activeAccount ? activeAccount.name : 'Нет компании'
  const companyIdLabel = activeAccount ? (activeAccount.short_id != null ? `ID: C-${activeAccount.short_id}` : `ID: ${activeAccount.id.slice(0, 8)}`) : 'Создайте компанию'

  const openDropdown = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setDropdownPos({ top: rect.bottom + 8, left: rect.left, width: rect.width })
    setIsCompanyOpen(true)
  }

  useEffect(() => {
    if (!isCompanyOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        !companyRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setIsCompanyOpen(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [isCompanyOpen])

  useEffect(() => {
    if (!isCompanyOpen) return
    const handleScroll = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 8, left: rect.left, width: rect.width })
    }
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [isCompanyOpen])

  return (
    <aside className="flex h-full w-[200px] shrink-0 flex-col border-r border-slate-200 bg-white/95">
      <div className="border-b border-slate-200 px-5 py-4">
        {(() => {
          const whitelabelUrl = activeAccount ? getWhitelabelLogoUrl(activeAccount) : null
          if (whitelabelUrl) {
            return (
              <button type="button" className="flex items-center gap-3">
                <img
                  src={whitelabelUrl}
                  alt={activeAccount?.name ?? ''}
                  className="h-9 w-9 rounded-xl object-cover"
                />
                <div className="text-left">
                  <div className="text-[15px] font-black leading-tight tracking-tight text-slate-900 truncate max-w-[110px]">
                    {activeAccount?.name ?? 'ELESTET'}
                  </div>
                </div>
              </button>
            )
          }
          return (
            <button type="button" className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-white">
                E
              </div>
              <div className="text-left">
                <div className="text-[28px] font-black uppercase leading-none tracking-tight text-slate-900">
                  ELESTET
                </div>
              </div>
            </button>
          )
        })()}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-4">
        <div className="mb-3 border-b border-slate-200 pb-3 -mx-2 px-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#98A5CC]">
            Моя компания
          </div>
          <div ref={companyRef} className="relative">
            <button
              ref={triggerRef}
              type="button"
              onClick={() => {
                if (hasActiveAccount) {
                  if (isCompanyOpen) setIsCompanyOpen(false)
                  else openDropdown()
                }
              }}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-left transition-colors duration-150',
                isCompanyOpen ? 'bg-slate-100' : 'bg-transparent hover:bg-slate-100',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-slate-900">{companyName}</span>
                <span className="mt-0.5 block text-[10px] text-[#61729E]">{companyIdLabel}</span>
              </span>
              {hasActiveAccount ? (
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 text-[#7A8BB8]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  {isCompanyOpen ? <path d="m8 14 4-4 4 4" /> : <path d="m8 10 4 4 4-4" />}
                </svg>
              ) : null}
            </button>

            {hasActiveAccount && isCompanyOpen && dropdownPos ? createPortal(
              <div
                ref={dropdownRef}
                style={{
                  position: 'fixed',
                  top: dropdownPos.top,
                  left: dropdownPos.left,
                  minWidth: dropdownPos.width,
                  zIndex: 9999,
                }}
                className="max-h-[50vh] overflow-y-auto rounded-[12px] border border-[#BCD2FF] bg-white shadow-[0_8px_20px_rgba(36,72,146,0.14)]"
              >
                {accounts.map((account) => {
                  const isSelected = activeAccount?.id === account.id
                  const listCompanyIdLabel = account.short_id != null ? `ID: C-${account.short_id}` : `ID: ${account.id.slice(0, 8)}`

                  const isOwner = account.my_role === 'owner'

                  return (
                    <button
                      type="button"
                      key={account.id}
                      onClick={() => {
                        onSelectAccount(account.id)
                        setIsCompanyOpen(false)
                      }}
                      className="group flex w-full items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-left transition hover:bg-[#F8FAFF]"
                    >
                      <span className="min-w-0">
                        <span className="block text-[15px] font-bold text-slate-900">{account.name}</span>
                        <span className="mt-0.5 block text-[12px] text-[#61729E]">{listCompanyIdLabel}</span>
                      </span>

                      <span className="relative flex h-6 w-16 items-center justify-end">
                        {isSelected ? (
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4 text-[#4A73FF]"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="m5 13 4 4L19 7" />
                          </svg>
                        ) : null}
                      {isOwner ? (
                        <span className="absolute inset-0 flex items-center justify-center gap-1">
                          <button
                            type="button"
                            aria-label="Редактировать компанию"
                            title="Редактировать"
                            onClick={(event) => {
                              event.stopPropagation()
                              setIsCompanyOpen(false)
                              onEditCompany(account)
                            }}
                            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[10px] bg-[#EEF5FF] text-[#4A73FF] transition hover:bg-[#D8E8FF]"
                          >
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            aria-label="Удалить компанию"
                            title="Удалить компанию"
                            onClick={(event) => {
                              event.stopPropagation()
                              onDeleteActiveCompany(account.id)
                            }}
                            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-[10px] bg-[#FFF1F1] text-[#FF5B5B] transition hover:bg-[#FFE7E7] ${accounts.length <= 1 ? 'opacity-40 !cursor-not-allowed' : ''}`}
                            disabled={accounts.length <= 1}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M9 4h6" />
                              <path d="M5 7h14" />
                              <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                              <path d="M10 11v4" />
                              <path d="M14 11v4" />
                            </svg>
                          </button>
                        </span>
                      ) : null}
                      </span>
                    </button>
                  )
                })}

                {archivedAccounts.length > 0 && onRestoreAccount && (
                  <>
                    <div className="mx-3 my-1 border-t border-slate-100" />
                    <button
                      type="button"
                      onClick={() => {
                        setIsCompanyOpen(false)
                        setIsArchiveModalOpen(true)
                      }}
                      className="flex w-full items-center gap-2 px-[16px] py-[11px] text-left text-[13px] font-medium text-slate-400 transition hover:bg-[#F8FAFF] hover:text-slate-600"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 8v13H3V8" />
                        <path d="M23 3H1v5h22z" />
                        <path d="M10 12h4" />
                      </svg>
                      Архив
                    </button>
                  </>
                )}
              </div>,
              document.body
            ) : null}
          </div>

          {isArchiveModalOpen && onRestoreAccount && archivedAccounts.length > 0 ? createPortal(
            <div
              className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4"
              onPointerDown={(e) => { if (e.target === e.currentTarget) setIsArchiveModalOpen(false) }}
            >
              <div className="w-full max-w-sm rounded-[20px] bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                  <span className="text-[16px] font-bold text-slate-900">Архив компаний</span>
                  <button
                    type="button"
                    onClick={() => setIsArchiveModalOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
                  {archivedAccounts.map((account) => {
                    const msLeft = account.deleted_at
                      ? new Date(account.deleted_at).getTime() + 15 * 24 * 60 * 60 * 1000 - Date.now()
                      : 0
                    const days = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)))
                    const isRestoring = restoringAccountId === account.id
                    return (
                      <div key={account.id} className="flex items-center justify-between rounded-[14px] px-3 py-3 transition hover:bg-[#F8FAFF]">
                        <span>
                          <span className="block text-[14px] font-semibold text-slate-700">{account.name}</span>
                          <span className={`mt-0.5 block text-[11px] ${days <= 3 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {days} дн. до удаления
                          </span>
                        </span>
                        <button
                          type="button"
                          disabled={isRestoring}
                          onClick={async () => {
                            setRestoringAccountId(account.id)
                            try {
                              await onRestoreAccount(account.id)
                            } finally {
                              setRestoringAccountId(null)
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className={`h-3.5 w-3.5 ${isRestoring ? 'animate-spin' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            {isRestoring ? (
                              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            ) : (
                              <>
                                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                                <path d="M21 3v5h-5" />
                              </>
                            )}
                          </svg>
                          {isRestoring ? '...' : 'Восстановить'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>,
            document.body
          ) : null}

          <button
            type="button"
            onClick={onOpenAddCompany}
            className="mt-1 inline-flex cursor-pointer items-center text-[11px] font-medium text-[#6C84E8] transition hover:text-[#5B74DD]"
          >
            <span>Добавить компанию</span>
          </button>
        </div>

        <nav className="flex flex-col gap-0.5">
          {items.filter((item) => item.permKey === null || permissions[item.permKey]).map((item) => (
            <button
              type="button"
              key={item.key}
              className={cn(
                'flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left font-medium transition',
                activePage === item.key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
              onClick={() => onSelectPage(item.key)}
            >
              <span
                className={cn(
                  'flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md',
                  activePage === item.key ? 'bg-white/15' : 'bg-slate-100 text-slate-500',
                )}
              >
                {item.icon}
              </span>
              <span className="text-[15px] font-medium tracking-normal">{item.label}</span>
            </button>
          ))}



        </nav>
      </div>

      <div className="mt-auto border-t border-slate-200 px-4 py-4 flex flex-col gap-1">
        {activeAccount?.my_role === 'owner' && (
        <button
          type="button"
          onClick={() => onSelectPage('subscription')}
          className={cn(
            'flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left font-medium transition',
            activePage === 'subscription'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          )}
        >
          <span className={cn(
            'flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md',
            activePage === 'subscription' ? 'bg-white/15' : 'bg-slate-100 text-slate-500',
          )}>
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="2" y="6" width="20" height="14" rx="2" />
              <path d="M2 10h20" />
              <path d="M6 14h4" />
            </svg>
          </span>
          <span className="text-[15px]">Подписка</span>
        </button>
        )}
        <a
          href="https://t.me/+4e0mYW-2Bjw3NTYy"
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md bg-sky-100 text-sky-500">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2Zm4.93 7.13-1.68 7.93c-.12.56-.46.7-.93.43l-2.57-1.89-1.24 1.19c-.14.14-.25.25-.51.25l.18-2.6 4.72-4.26c.2-.18-.05-.28-.32-.1L7.77 14.6 5.23 13.8c-.56-.18-.57-.56.12-.83l9.67-3.73c.46-.17.86.11.71.83-.01.02 0 .02-.1.06Z" />
            </svg>
          </span>
          <span className="text-[15px]">Telegram-канал</span>
        </a>
      </div>
    </aside>
  )
}
