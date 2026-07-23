-- Novo tipo de notificação para o fluxo de solicitação de estorno (aditivo, não destrutivo).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFUND_REQUESTED';
