import { useState, useEffect } from 'react';

export function useElapsedTime(timestamp: Date | number): string {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const updateElapsed = () => {
      const now = Date.now();
      const ts = timestamp instanceof Date ? timestamp.getTime() : timestamp;
      const diff = now - ts;

      if (diff < 1000) {
        setElapsed('now');
      } else if (diff < 60000) {
        const seconds = Math.floor(diff / 1000);
        setElapsed(`${seconds}s ago`);
      } else if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        setElapsed(`${minutes}m ago`);
      } else if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        setElapsed(`${hours}h ago`);
      } else {
        const days = Math.floor(diff / 86400000);
        setElapsed(`${days}d ago`);
      }
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [timestamp]);

  return elapsed;
}
