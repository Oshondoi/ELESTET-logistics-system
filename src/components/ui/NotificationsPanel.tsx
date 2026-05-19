import { useEffect, useRef, useState } from 'react'
import type { BatchNotification } from '../../types'
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../../services/outsourceService'

interface NotificationsPanelProps {
  open: boolean
  accountId: string
  onClose: () => void
  onUnreadChange?: (count: number) => void
}

export const NotificationsPanel = ({ open, accountId, onClose, onUnreadChange }: NotificationsPanelProps) => {
  const [notifs, setNotifs] = useState<BatchNotification[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !accountId) return
    setIsLoading(true)
    void fetchNotifications(accountId).then((data) => {
      setNotifs(data)
      setIsLoading(false)
    })
  }, [open, accountId])


  const handleMarkRead = async (id: string) => {
    await markNotificationRead(id)
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n))
    onUnreadChange?.(notifs.filter((n) => !n.is_read && n.id !== id).length)
  }

  const handleMarkAll = async () => {
    await markAllNotificationsRead(accountId)
    setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })))
    onUnreadChange?.(0)
  }

  if (!open) return null

  const unread = notifs.filter((n) => !n.is_read).length

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-2xl border border-slate-200 bg-white shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <span className="text-sm font-semibold text-slate-900">Уведомления</span>
        {unread > 0 && (
          <button
            type="button"
            onClick={handleMarkAll}
            className="text-xs text-violet-600 hover:underline"
          >
            Прочитать все
          </button>
        )}
      </div>
      <div className="max-h-80 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-sm text-slate-400">Загрузка…</div>
        ) : notifs.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-slate-400">Нет уведомлений</div>
        ) : (
          notifs.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 border-b border-slate-50 px-4 py-3 last:border-0 ${!n.is_read ? 'bg-violet-50' : ''}`}
            >
              <div className="mt-0.5 flex h-2 w-2 flex-shrink-0 items-start">
                {!n.is_read && <div className="h-2 w-2 rounded-full bg-violet-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-700 leading-snug font-medium">{n.title}</p>
                {n.body && <p className="mt-0.5 text-xs text-slate-500 leading-snug">{n.body}</p>}
                <p className="mt-1 text-[10px] text-slate-400">
                  {new Date(n.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              {!n.is_read && (
                <button
                  type="button"
                  onClick={() => void handleMarkRead(n.id)}
                  className="flex-shrink-0 rounded-lg p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                  title="Отметить прочитанным"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
