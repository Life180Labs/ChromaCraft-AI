import React from 'react';
import clsx from 'clsx';

type InputProps = {
  id?: string;
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties; // Added style prop to fix TypeScript error
};

export const Input: React.FC<InputProps> = ({
  id,
  type = 'text',
  placeholder,
  value,
  onChange,
  className = '',
  required = false,
  disabled = false,
  style, // Destructure the style prop
}) => {
  return (
    <input
      id={id}
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      required={required}
      disabled={disabled}
      className={clsx('input', className)}
      style={style} // Pass the style prop to the DOM element
    />
  );
};