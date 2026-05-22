import React from 'react';
import clsx from 'clsx';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger-outline';
}

export const Button: React.FC<ButtonProps> = ({
  variant,
  children,
  className = '',
  ...props
}) => {
  const baseClasses = 'btn';
  const variantClass = variant
    ? {
        primary: 'primary',
        outline: 'outline',
        ghost: 'ghost',
        'danger-outline': 'danger-outline',
      }[variant]
    : '';

  return (
    <button
      className={clsx(baseClasses, variantClass && ` ${variantClass}`, className)}
      {...props}
    >
      {children}
    </button>
  );
};
