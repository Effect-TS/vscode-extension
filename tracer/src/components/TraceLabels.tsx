import React, { useRef, useState, useEffect } from 'react';
import type { TraceEvent, ViewState, TraceViewerOptions } from './TraceViewer';
import { getVisibleTraces, getTraceYPosition } from './TraceViewer';

interface TraceLabelsProps {
  traces: TraceEvent[];
  viewState: ViewState;
  options?: TraceViewerOptions;
  width: number;
}

const TraceLabels: React.FC<TraceLabelsProps> = ({
  traces,
  viewState,
  options = {},
  width
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const { barHeight = 30, timelineHeight = 25 } = options;

  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.offsetHeight);
      }
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  // Get visible traces
  const visibleTraces = getVisibleTraces(traces, viewState, containerHeight, options);

  return (
    <div
      ref={containerRef}
      style={{
        width: `${width}px`,
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#fafafa'
      }}
    >
      {/* Timeline header */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: `${timelineHeight}px`,
          borderBottom: '1px solid #e0e0e0'
        }}
      />

      {/* Trace labels */}
      {visibleTraces.map(trace => {
        const y = getTraceYPosition(trace, viewState, options);
        
        return (
          <div
            key={trace.id}
            style={{
              position: 'absolute',
              top: `${y}px`,
              left: 0,
              right: 0,
              height: `${barHeight}px`,
              borderBottom: '1px solid #e0e0e0',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '5px',
              paddingRight: '5px',
              boxSizing: 'border-box'
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontFamily: 'Arial, sans-serif',
                color: '#333333',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                width: '100%'
              }}
              title={trace.name}
            >
              {trace.name}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TraceLabels;