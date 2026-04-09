import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

interface DeleteAccountModalProps {
  open: boolean
  accountName: string
  isSubmitting: boolean
  onClose: () => void
  onConfirm: () => void
}

export const DeleteAccountModal = ({
  open,
  accountName,
  isSubmitting,
  onClose,
  onConfirm,
}: DeleteAccountModalProps) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Удалить компанию?"
    description={`Компания "${accountName}" будет удалена. Это действие нельзя отменить.`}
  >
    <div className="flex justify-center gap-3 pt-1">
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
  </Modal>
)
