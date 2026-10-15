'use client';

interface BadgeProps {
  variant?: 'coral' | 'teal' | 'gray';
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'gray', children, className = '' }: BadgeProps) {
  const variantStyles = {
    coral: 'bg-coral text-white',
    teal: 'bg-teal text-white',
    gray: 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
