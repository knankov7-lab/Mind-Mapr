import React from 'react';
import { Handle, Position } from 'reactflow';

export default function CustomNode({ data }) {
  const shape = (data && data.shape) || 'rect';
  const label = (data && (data.label || data.label === 0)) ? data.label : '';
  return (
    <div className={`customNode shape-${shape}`} title={String(label)}>
      <Handle type="target" position={Position.Top} style={{ background: '#555' }} />
      <div className="customNodeLabel">{label}</div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} />
    </div>
  );
}
