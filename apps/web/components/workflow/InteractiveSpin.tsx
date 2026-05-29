'use client';
import React, { useState, useRef } from 'react';
import { TbRefresh } from 'react-icons/tb';

export const InteractiveSpin: React.FC<{ frameIds: number[] }> = ({ frameIds }) => {
  const [index, setIndex] = useState(0);
  const startX = useRef<number | null>(null);

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    startX.current = 'touches' in e ? e.touches[0].clientX : e.clientX;
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (startX.current === null) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const diff = clientX - startX.current;
    
    // Sensitivity: how many pixels to drag to switch frame
    const sensitivity = 15;
    
    if (Math.abs(diff) > sensitivity) {
      if (diff > 0) {
        setIndex((prev) => (prev - 1 + frameIds.length) % frameIds.length);
      } else {
        setIndex((prev) => (prev + 1) % frameIds.length);
      }
      startX.current = clientX;
    }
  };

  const handleMouseUp = () => {
    startX.current = null;
  };

  if (!frameIds || frameIds.length === 0) return null;

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: '150px', overflow: 'hidden', cursor: 'ew-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchMove={handleMouseMove}
      onTouchEnd={handleMouseUp}
    >
      {frameIds.map((id, i) => (
        <img
          key={id}
          src={`/api/v1/assets?id=${id}`}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: i === index ? 'block' : 'none',
            userSelect: 'none',
            pointerEvents: 'none'
          }}
          draggable={false}
          alt={`Spin Frame ${i}`}
        />
      ))}
      <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.5)', padding: '4px 12px', borderRadius: '20px', color: '#fff', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', pointerEvents: 'none' }}>
        <TbRefresh size={14} />
        <span>Drag to rotate</span>
      </div>
    </div>
  );
};
