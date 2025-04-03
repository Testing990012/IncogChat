import { useState, useEffect, useCallback, useRef } from "react";
import { WsMessage, WsMessageType } from "@shared/schema";

interface WebSocketHookOptions {
  onOpen?: (event: any) => void;
  onMessage?: (event: any) => void;
  onClose?: (event: any) => void;
  onError?: (event: any) => void;
  reconnectAttempts?: number;
  reconnectInterval?: number;
  manualReconnect?: boolean;
}

type ConnectionStatus = "connecting" | "open" | "closing" | "closed" | "reconnecting";

// In Replit's environment, WebSockets are unreliable with frequent code 1001 disconnects
// This hook provides a hybrid approach using HTTP polling as a fallback
export default function useWebSocket(options: WebSocketHookOptions = {}) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const messageQueueRef = useRef<WsMessage[]>([]);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPollTimeRef = useRef<number>(0);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const maxReconnectAttempts = options.reconnectAttempts || 5;
  const reconnectInterval = options.reconnectInterval || 3000; // Default: 3 seconds
  const POLL_INTERVAL = 3000; // Poll every 3 seconds

  // Get connection ID using HTTP for our fallback approach
  const getConnectionId = useCallback(async () => {
    try {
      const response = await fetch('/api/ws/connect', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const data = await response.json();
        connectionIdRef.current = data.connectionId;
        console.log("HTTP fallback: Received connectionId", connectionIdRef.current);
        return true;
      } else {
        console.error("HTTP fallback: Failed to get connection ID");
        return false;
      }
    } catch (error) {
      console.error("HTTP fallback: Error getting connection ID", error);
      return false;
    }
  }, []);

  // Poll for messages using HTTP
  const pollForMessages = useCallback(async () => {
    if (!connectionIdRef.current) return;
    
    try {
      const response = await fetch(`/api/ws/poll?connectionId=${connectionIdRef.current}&since=${lastPollTimeRef.current}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const data = await response.json();
        const now = Date.now();
        lastPollTimeRef.current = now;
        
        if (data.messages && data.messages.length > 0) {
          console.log(`HTTP fallback: Received ${data.messages.length} messages`);
          
          // Process each message
          for (const message of data.messages) {
            if (options.onMessage) {
              const event = {
                data: JSON.stringify(message),
                type: 'message',
                timeStamp: Date.now()
              };
              options.onMessage(event);
            }
          }
        }
      } else {
        console.warn("HTTP fallback: Failed to poll for messages", await response.text());
      }
    } catch (error) {
      console.error("HTTP fallback: Error polling for messages", error);
    }
  }, [options.onMessage]);

  // Send queued messages via HTTP
  const sendQueuedMessages = useCallback(async () => {
    if (!connectionIdRef.current || messageQueueRef.current.length === 0) return;
    
    // Make a copy to avoid race conditions
    const queuedMessages = [...messageQueueRef.current];
    
    for (const message of queuedMessages) {
      try {
        const response = await fetch('/api/ws/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionId: connectionIdRef.current,
            message
          })
        });
        
        if (response.ok) {
          // Remove from queue
          messageQueueRef.current = messageQueueRef.current.filter(m => m !== message);
          console.log("HTTP fallback: Successfully sent message", message.type);
        } else {
          console.warn("HTTP fallback: Failed to send message", message.type, await response.text());
        }
      } catch (error) {
        console.error("HTTP fallback: Error sending message", error);
      }
    }
  }, []);

  // Start polling using HTTP as a fallback
  const startPolling = useCallback(async () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    
    // First get a connection ID if we don't have one
    if (!connectionIdRef.current) {
      const success = await getConnectionId();
      if (!success) {
        console.error("HTTP fallback: Failed to initialize polling, couldn't get connection ID");
        setConnectionStatus("closed");
        return;
      }
    }
    
    // Notify that we're "connected" via HTTP polling
    setConnectionStatus("open");
    if (options.onOpen) {
      options.onOpen({
        type: 'open',
        data: 'HTTP polling connection established'
      });
    }
    
    // Start polling interval
    lastPollTimeRef.current = Date.now();
    pollIntervalRef.current = setInterval(async () => {
      await sendQueuedMessages();
      await pollForMessages();
    }, POLL_INTERVAL);
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [getConnectionId, sendQueuedMessages, pollForMessages, options.onOpen, POLL_INTERVAL]);

  // Try WebSocket first, fall back to HTTP polling
  const connect = useCallback(async () => {
    try {
      // Clean up any existing connections
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
      
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      
      // Clear any existing reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      setConnectionStatus("connecting");
      
      // Get a connection ID first for our HTTP fallback
      await getConnectionId();
      
      // Immediately start polling - this ensures we have a working communication channel
      startPolling();
    } catch (error) {
      console.error("Error connecting to chat:", error);
      setConnectionStatus("closed");
    }
  }, [getConnectionId, startPolling]);

  // Initialize connection
  useEffect(() => {
    connect();
    
    // Handle visibility change to reconnect when tab becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (connectionStatus !== "open") {
          console.log("Tab became visible, reconnecting...");
          reconnectAttemptsRef.current = 0;
          connect();
        }
      }
    };
    
    // Handle online status change to reconnect when connection is restored
    const handleOnline = () => {
      console.log("Browser went online, reconnecting...");
      reconnectAttemptsRef.current = 0;
      connect();
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    
    return () => {
      console.log("Cleaning up connection");
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      
      // Clean up HTTP polling
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      
      // Clean up reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // Clean up WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      // Send disconnect message if we have a connection ID
      if (connectionIdRef.current) {
        fetch('/api/ws/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: connectionIdRef.current })
        }).catch(err => console.error("Error disconnecting:", err));
      }
    };
  }, [connect, connectionStatus]);

  // Send message function - use HTTP fallback
  const sendMessage = useCallback((message: WsMessage) => {
    console.log("Sending message:", message);
    
    if (!connectionIdRef.current) {
      console.warn("Cannot send message, not connected - queuing for later");
      messageQueueRef.current.push(message);
      return false;
    }
    
    // Add to queue for next poll
    messageQueueRef.current.push(message);
    
    // Try to send immediately
    fetch('/api/ws/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: connectionIdRef.current,
        message
      })
    }).then(response => {
      if (response.ok) {
        console.log("Successfully sent message:", message.type);
        // Remove from queue if successfully sent
        messageQueueRef.current = messageQueueRef.current.filter(m => m !== message);
      } else {
        console.warn("Failed to send message:", message.type);
        // Will retry on next poll
      }
    }).catch(error => {
      console.error("Error sending message:", error);
      // Will retry on next poll
    });
    
    return true;
  }, []);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    console.log("Manual reconnection initiated");
    reconnectAttemptsRef.current = 0;
    
    // Clean up existing connections
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    connect();
  }, [connect]);

  return {
    connectionStatus,
    sendMessage,
    reconnect,
  };
}
