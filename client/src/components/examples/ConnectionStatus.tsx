import ConnectionStatus from '../ConnectionStatus';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function ConnectionStatusExample() {
  const [isConnected, setIsConnected] = useState(true);

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        <Button 
          size="sm" 
          onClick={() => setIsConnected(!isConnected)}
          data-testid="button-toggle-connection"
        >
          Toggle Connection
        </Button>
      </div>
      <ConnectionStatus isConnected={isConnected} />
    </div>
  );
}