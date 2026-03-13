import React from 'react';

export default function CustomNode({ data }) {
  const shape = (data && data.shape) || 'rect';
  const label = (data && (data.label || data.label === 0)) ? data.label : '';
  return (
    <div className={`customNode shape-${shape}`} title={String(label)}>
      <div className="customNodeLabel">{label}</div>
    </div>
  );
}
