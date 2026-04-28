import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import type { Account, RolePermissions } from '../../types'

interface SidebarProps {
  activePage: 'home' | 'fulfillment' | 'shipments' | 'stores' | 'directories' | 'products' | 'reviews' | 'roles' | 'stickers' | 'admin'
  onSelectPage: (page: 'home' | 'fulfillment' | 'shipments' | 'stores' | 'directories' | 'products' | 'reviews' | 'roles' | 'stickers' | 'admin') => void
  onOpenAddCompany: () => void
  onSignOut: () => void
  accounts: Account[]
  activeAccount: Account | null
  onSelectAccount: (accountId: string) => void
  onDeleteActiveCompany: (id: string) => void
  onEditCompany: (account: Account) => void
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
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h10" />
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
    label: 'Стикеры',
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
  activeAccount,
  onSelectAccount,
  onDeleteActiveCompany,
  onEditCompany,
  permissions,
  isAdmin = false,
}: SidebarProps) => {
  const [isCompanyOpen, setIsCompanyOpen] = useState(false)
  const companyRef = useRef<HTMLDivElement | null>(null)
  const hasActiveAccount = Boolean(activeAccount)
  const companyName = activeAccount ? activeAccount.name : 'Нет компании'
  const companyIdLabel = activeAccount ? `ID: ${activeAccount.id.slice(0, 8)}` : 'Создайте компанию'

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!companyRef.current?.contains(event.target as Node)) {
        setIsCompanyOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [])

  return (
    <aside className="flex h-full w-[234px] shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white/95">
      <div className="border-b border-slate-200 px-5 py-4">
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
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-5 rounded-[24px] bg-[#F7F8FC] py-[14px]">
          <div className="mb-2 px-[16px] text-[10px] font-semibold uppercase tracking-[0.18em] text-[#98A5CC]">
            Моя компания
          </div>
          <div ref={companyRef} className="relative">
            <button
              type="button"
              onClick={() => {
                if (hasActiveAccount) {
                  setIsCompanyOpen((current) => !current)
                }
              }}
              className={cn(
                'flex w-full items-center justify-between rounded-[16px] px-[14px] py-[11px] text-left transition-colors duration-150',
                isCompanyOpen ? 'bg-[#EEF2FB]' : 'bg-transparent hover:bg-[#EEF2FB]',
              )}
            >
              <span>
                <span className="block text-[15px] font-bold text-slate-900">{companyName}</span>
                <span className="mt-0.5 block text-[11px] text-[#61729E]">{companyIdLabel}</span>
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

            {hasActiveAccount && isCompanyOpen ? (
              <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 rounded-[12px] border border-[#BCD2FF] bg-white shadow-[0_8px_20px_rgba(36,72,146,0.14)]">
                {accounts.map((account) => {
                  const isSelected = activeAccount?.id === account.id
                  const listCompanyIdLabel = `ID: ${account.id.slice(0, 8)}`

                  const isOwner = account.my_role === 'owner'

                  return (
                    <button
                      type="button"
                      key={account.id}
                      onClick={() => {
                        onSelectAccount(account.id)
                        setIsCompanyOpen(false)
                      }}
                      className="group flex w-full items-center justify-between rounded-[12px] px-[16px] py-[13px] text-left transition hover:bg-[#F8FAFF]"
                    >
                      <span>
                        <span className="block text-[15px] font-bold text-slate-900">{account.name}</span>
                        <span className="mt-0.5 block text-[12px] text-[#61729E]">{listCompanyIdLabel}</span>
                      </span>

                      <span className="relative flex h-6 w-16 items-center justify-end">
                        {isSelected ? (
                          <svg
                            viewBox="0 0 24 24"
                            className={cn('h-4 w-4 text-[#4A73FF]', isOwner ? 'transition-opacity group-hover:opacity-0' : '')}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="m5 13 4 4L19 7" />
                          </svg>
                        ) : null}
                      {isOwner ? (
                        <span className={`absolute inset-0 flex items-center justify-center gap-1 transition-opacity ${isSelected ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
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
                            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[10px] bg-[#FFF1F1] text-[#FF5B5B] transition hover:bg-[#FFE7E7]"
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
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onOpenAddCompany}
            className="mt-[4px] inline-flex origin-left scale-[0.85] cursor-pointer items-center px-[16px] text-[10px] font-medium tracking-[0.01em] text-[#6C84E8] transition hover:text-[#5B74DD]"
          >
            <span className="whitespace-nowrap">Добавить компанию</span>
          </button>
        </div>

        <nav className="flex flex-col gap-0.5">
          {items.filter((item) => item.permKey === null || permissions[item.permKey]).map((item) => (
            <button
              type="button"
              key={item.key}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium transition',
                activePage === item.key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
              onClick={() => onSelectPage(item.key)}
            >
              <span
                className={cn(
                  'flex h-6.5 w-6.5 items-center justify-center rounded-md',
                  activePage === item.key ? 'bg-white/15' : 'bg-slate-100 text-slate-500',
                )}
              >
                {item.icon}
              </span>
              <span className="font-medium tracking-normal">{item.label}</span>
            </button>
          ))}

        </nav>
      </div>

      <div className="mt-auto border-t border-slate-200 px-4 py-4">
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <span className="flex h-6.5 w-6.5 items-center justify-center rounded-md bg-slate-100 text-slate-500">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M10 17l5-5-5-5" />
              <path d="M15 12H3" />
              <path d="M20 4v16" />
            </svg>
          </span>
          <span>Выход</span>
        </button>
      </div>
    </aside>
  )
}
