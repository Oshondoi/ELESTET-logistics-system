import { Button } from './Button'
import { Modal } from './Modal'

interface DeleteConfirmModalProps {
  open: boolean
  title: string
  description: string
  isSubmitting: boolean
  error?: string | null
  onClose: () => void
  onConfirm: () => void
}

export const DeleteConfirmModal = ({
  open,
  title,
  description,
  isSubmitting,
  error,
  onClose,
  onConfirm,
}: DeleteConfirmModalProps) => (
  <Modal
    open={open}
    onClose={onClose}
    title={title}
    description={description}
  >
    <div className="space-y-4 pt-1">
      {error ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {error}
        </div>
      ) : null}

      <div className="flex justify-center gap-3">
        <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
          Отмена
        </Button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-xl border border-[#FF5B5B] bg-[#FF5B5B] px-4 py-2 text-sm font-medium text-white transition hover:border-[#F04444] hover:bg-[#F04444] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Удаление...' : 'Удалить'}
        </button>
      </div>
    </div>
  </Modal>
)