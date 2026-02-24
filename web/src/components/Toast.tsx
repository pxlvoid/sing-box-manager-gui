import { CheckCircle, XCircle, AlertCircle, X } from 'lucide-react';
import { create } from 'zustand';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = Math.random().toString(36).substring(7);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, toast.duration || 3000);
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

// Convenience methods
export const toast = {
  success: (message: string) => useToast.getState().addToast({ type: 'success', message }),
  error: (message: string, duration = 5000) => useToast.getState().addToast({ type: 'error', message, duration }),
  info: (message: string) => useToast.getState().addToast({ type: 'info', message }),
};

// Toast single item component
const ToastItem = ({ toast, onClose }: { toast: Toast; onClose: () => void }) => {
  const icons = {
    success: <CheckCircle className="w-5 h-5 text-green-500" />,
    error: <XCircle className="w-5 h-5 text-red-500" />,
    info: <AlertCircle className="w-5 h-5 text-blue-500" />,
  };

  const bgColors = {
    success: 'bg-green-50 border-green-200 dark:bg-green-900/50 dark:border-green-800',
    error: 'bg-red-50 border-red-200 dark:bg-red-900/50 dark:border-red-800',
    info: 'bg-blue-50 border-blue-200 dark:bg-blue-900/50 dark:border-blue-800',
  };

  const textColors = {
    success: 'text-green-800 dark:text-green-200',
    error: 'text-red-800 dark:text-red-200',
    info: 'text-blue-800 dark:text-blue-200',
  };

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg ${bgColors[toast.type]} animate-slide-in`}
    >
      {icons[toast.type]}
      <span className={`flex-1 text-sm ${textColors[toast.type]}`}>{toast.message}</span>
      <button
        onClick={onClose}
        className="p-1 hover:bg-black/10 rounded transition-colors"
      >
        <X className="w-4 h-4 text-gray-500" />
      </button>
    </div>
  );
};

// Toast container component
export const ToastContainer = () => {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={() => removeToast(t.id)} />
      ))}
    </div>
  );
};
