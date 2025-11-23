'use client';

import { useState, useEffect, useRef } from 'react';

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'log' | 'error' | 'warn' | 'info';
}

export function DebugConsole() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const logIdCounter = useRef(0);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Intercept console methods
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;

    const addLog = (message: any, type: LogEntry['type']) => {
      const timestamp = new Date().toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
      
      const messageStr = typeof message === 'object' 
        ? JSON.stringify(message, null, 2) 
        : String(message);

      setLogs(prev => {
        const newLog: LogEntry = {
          id: logIdCounter.current++,
          timestamp,
          message: messageStr,
          type
        };
        
        // Keep only last 100 logs
        const updated = [...prev, newLog];
        return updated.slice(-100);
      });
    };

    console.log = (...args) => {
      originalLog.apply(console, args);
      addLog(args.join(' '), 'log');
    };

    console.error = (...args) => {
      originalError.apply(console, args);
      addLog(args.join(' '), 'error');
    };

    console.warn = (...args) => {
      originalWarn.apply(console, args);
      addLog(args.join(' '), 'warn');
    };

    console.info = (...args) => {
      originalInfo.apply(console, args);
      addLog(args.join(' '), 'info');
    };

    // Capture window errors
    const handleError = (event: ErrorEvent) => {
      addLog(`Error: ${event.message} at ${event.filename}:${event.lineno}`, 'error');
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      addLog(`Unhandled Promise Rejection: ${event.reason}`, 'error');
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // Initial log
    console.log('🐛 Debug Console initialized');

    return () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      console.info = originalInfo;
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom
    if (consoleEndRef.current && isOpen && !isMinimized) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isOpen, isMinimized]);

  const clearLogs = () => {
    setLogs([]);
    console.log('🧹 Console cleared');
  };

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'error':
        return 'text-red-400';
      case 'warn':
        return 'text-yellow-400';
      case 'info':
        return 'text-blue-400';
      default:
        return 'text-green-400';
    }
  };

  const getLogIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'error':
        return '❌';
      case 'warn':
        return '⚠️';
      case 'info':
        return '🔵';
      default:
        return '🟢';
    }
  };

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 z-[9999] bg-orange-600 hover:bg-orange-700 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg transition-transform hover:scale-110"
        aria-label="Toggle Debug Console"
      >
        <span className="text-2xl">{isOpen ? '🐛' : '🔧'}</span>
      </button>

      {/* Debug Console */}
      {isOpen && (
        <div className="fixed bottom-20 right-4 z-[9998] bg-black/95 border-2 border-orange-500 rounded-lg shadow-2xl flex flex-col"
          style={{
            width: isMinimized ? '320px' : '90vw',
            maxWidth: isMinimized ? '320px' : '600px',
            height: isMinimized ? 'auto' : '60vh',
            maxHeight: isMinimized ? 'auto' : '500px'
          }}
        >
          {/* Header */}
          <div className="bg-orange-600 text-white px-4 py-2 flex items-center justify-between rounded-t-md">
            <div className="flex items-center gap-2">
              <span className="text-xl">🐛</span>
              <h3 className="font-bold">Debug Console</h3>
              <span className="text-xs bg-black/30 px-2 py-1 rounded">
                {logs.length} logs
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="hover:bg-orange-700 px-2 py-1 rounded text-sm"
              >
                {isMinimized ? '▼' : '▲'}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="hover:bg-orange-700 px-2 py-1 rounded text-sm"
              >
                ✕
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Logs */}
              <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1">
                {logs.length === 0 ? (
                  <div className="text-gray-500 text-center py-8">
                    No logs yet...
                  </div>
                ) : (
                  logs.map(log => (
                    <div key={log.id} className="flex gap-2 hover:bg-white/5 px-2 py-1 rounded">
                      <span className="text-gray-500 shrink-0">
                        {log.timestamp}
                      </span>
                      <span className="shrink-0">{getLogIcon(log.type)}</span>
                      <span className={`${getLogColor(log.type)} break-all`}>
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
                <div ref={consoleEndRef} />
              </div>

              {/* Footer */}
              <div className="border-t border-orange-500 px-3 py-2 flex justify-between items-center">
                <button
                  onClick={clearLogs}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-bold transition"
                >
                  Clear
                </button>
                <div className="text-gray-400 text-xs">
                  Scroll for more logs
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

