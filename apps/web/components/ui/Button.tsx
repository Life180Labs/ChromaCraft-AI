import React from 'react';
import clsx from 'clsx';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger-outline';
  size?: 'sm' | 'md' | 'lg'; // Added size prop to fix TypeScript error
}

export const Button: React.FC<ButtonProps> = ({
  variant,
  size, // Destructure the size prop
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
      // Add the size prop to clsx so it applies classes like 'sm'
      className={clsx(baseClasses, variantClass && ` ${variantClass}`, size, className)}
      {...props}
    >
      {children}
    </button>
  );
};