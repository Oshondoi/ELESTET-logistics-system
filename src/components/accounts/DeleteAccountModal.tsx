import { DeleteConfirmModal } from '../ui/DeleteConfirmModal'

interface DeleteAccountModalProps {
  open: boolean
  accountName: string
  isSubmitting: boolean
  error?: string | null
  password: string
  onPasswordChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}

export const DeleteAccountModal = ({
  open,
  accountName,
  isSubmitting,
  error,
  password,
  onPasswordChange,
  onClose,
  onConfirm,
}: DeleteAccountModalProps) => (
  <DeleteConfirmModal
    open={open}
    title="Удалить компанию?"
    description={`Компания «${accountName}» будет помещена в архив на 15 дней, после чего удалена безвозвратно. Только владелец может выполнить это действие.`}
    isSubmitting={isSubmitting}
    error={error}
    onClose={onClose}
    onConfirm={onConfirm}
    requirePassword
    passwordValue={password}
    onPasswordChange={onPasswordChange}
  />
)
