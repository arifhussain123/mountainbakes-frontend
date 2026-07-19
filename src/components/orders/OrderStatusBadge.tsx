import type { OrderStatus } from '@mb/shared';

const CONFIGS: Record<OrderStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  preparing: { label: 'Preparing', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  ready: { label: 'Ready', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  delivered: { label: 'Delivered', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { label, className } = CONFIGS[status] || { label: status, className: '' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${className}`}>
      {label}
    </span>
  );
}
