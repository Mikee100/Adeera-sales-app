import React from 'react';
import { cn } from '../../lib/utils';

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => <div className={cn('rounded-2xl border border-slate-200 bg-white shadow-soft', className)} {...props} />;

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => <div className={cn('px-4 py-3 border-b border-slate-100', className)} {...props} />;

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className,
  ...props
}) => <h3 className={cn('text-lg font-semibold text-slate-900', className)} {...props} />;

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => <div className={cn('p-4', className)} {...props} />;
