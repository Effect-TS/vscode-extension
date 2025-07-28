import { useState } from 'react'
import TraceViewer from './components/TraceViewer'
import TraceMinimap from './components/TraceMinimap'
import TraceLabels from './components/TraceLabels'
import type { TraceEvent, ViewState, TraceViewerOptions } from './components/TraceViewer'
import './App.css'


function App() {
  // Initialize view to show the first 2 seconds of the trace
  const [viewState, setViewState] = useState<ViewState>({
    startTime: 0n,
    endTime: 2000000000n, // 2 seconds in nanoseconds
    offsetY: 0
  });

  const traces: TraceEvent[] = [
    // True waterfall pattern - each span at its own depth
    { id: '1', name: 'HTTP GET /api/products/123', startTime: 0n, endTime: 5000000000n, color: '#3498db', depth: 0 },
    { id: '2', name: 'middleware.authentication', startTime: 50000000n, endTime: 150000000n, color: '#9b59b6', depth: 1 },
    { id: '3', name: 'jwt.verify', startTime: 60000000n, endTime: 140000000n, color: '#8e44ad', depth: 2 },
    { id: '4', name: 'jwt.decode', startTime: 70000000n, endTime: 90000000n, color: '#9b59b6', depth: 3 },
    { id: '5', name: 'jwt.validateSignature', startTime: 100000000n, endTime: 130000000n, color: '#8e44ad', depth: 4 },
    { id: '6', name: 'middleware.rateLimit', startTime: 160000000n, endTime: 200000000n, color: '#e74c3c', depth: 5 },
    { id: '7', name: 'controller.getProduct', startTime: 210000000n, endTime: 4950000000n, color: '#2ecc71', depth: 6 },
    { id: '8', name: 'db.connect', startTime: 220000000n, endTime: 320000000n, color: '#f39c12', depth: 7 },
    { id: '9', name: 'db.query.findProduct', startTime: 330000000n, endTime: 580000000n, color: '#f39c12', depth: 8 },
    { id: '10', name: 'sql.prepare', startTime: 340000000n, endTime: 360000000n, color: '#d68910', depth: 9 },
    { id: '11', name: 'sql.execute', startTime: 370000000n, endTime: 550000000n, color: '#d68910', depth: 10 },
    { id: '12', name: 'sql.fetchResults', startTime: 560000000n, endTime: 570000000n, color: '#d68910', depth: 11 },
    { id: '13', name: 'cache.check', startTime: 590000000n, endTime: 650000000n, color: '#16a085', depth: 12 },
    { id: '14', name: 'redis.connect', startTime: 600000000n, endTime: 610000000n, color: '#1abc9c', depth: 13 },
    { id: '15', name: 'redis.get', startTime: 620000000n, endTime: 640000000n, color: '#1abc9c', depth: 14 },
    { id: '16', name: 'service.enrichProduct', startTime: 660000000n, endTime: 2500000000n, color: '#34495e', depth: 15 },
    { id: '17', name: 'http.getPricing', startTime: 670000000n, endTime: 1200000000n, color: '#2c3e50', depth: 16 },
    { id: '18', name: 'dns.lookup', startTime: 680000000n, endTime: 720000000n, color: '#7f8c8d', depth: 17 },
    { id: '19', name: 'tls.handshake', startTime: 730000000n, endTime: 820000000n, color: '#95a5a6', depth: 18 },
    { id: '20', name: 'http.request', startTime: 830000000n, endTime: 1150000000n, color: '#7f8c8d', depth: 19 },
    { id: '21', name: 'http.getInventory', startTime: 1210000000n, endTime: 1800000000n, color: '#2c3e50', depth: 20 },
    { id: '22', name: 'http.getReviews', startTime: 1810000000n, endTime: 2450000000n, color: '#2c3e50', depth: 21 },
    { id: '23', name: 'transform.aggregateData', startTime: 2510000000n, endTime: 3200000000n, color: '#e67e22', depth: 22 },
    { id: '24', name: 'serialize.toJSON', startTime: 3210000000n, endTime: 3400000000n, color: '#d35400', depth: 23 },
    { id: '25', name: 'compress.gzip', startTime: 3410000000n, endTime: 3600000000n, color: '#e74c3c', depth: 24 }
  ];

  const options: TraceViewerOptions = {
    barHeight: 18,
    barPadding: 4,
    timelineHeight: 16
  };

  const handleTraceClick = (trace: TraceEvent) => {
    console.log('Trace clicked:', trace);
  };

  const handleTraceHover = (trace: TraceEvent | null) => {
    if (trace) {
      console.log('Hovering over trace:', trace);
    } else {
      console.log('No longer hovering over any trace');
    }
  };


  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ height: '80px', borderBottom: '1px solid #e0e0e0' }}>
        <TraceMinimap
          traces={traces}
          viewState={viewState}
          onViewStateChange={setViewState}
          height={80}
          barHeight={options.barHeight || 18}
          barPadding={options.barPadding || 4}
        />
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: '250px', borderRight: '1px solid #e0e0e0' }}>
          <TraceLabels
            traces={traces}
            viewState={viewState}
            options={options}
            width={250}
          />
        </div>
        <div style={{ flex: 1 }}>
          <TraceViewer 
            traces={traces}
            viewState={viewState}
            onViewStateChange={setViewState}
            options={options}
            onTraceClick={handleTraceClick}
            onTraceHover={handleTraceHover}
          />
        </div>
      </div>
    </div>
  );
}

export default App
