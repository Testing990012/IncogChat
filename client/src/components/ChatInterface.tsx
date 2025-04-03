import { useState, useEffect, useRef, ChangeEvent } from "react";
import { useLocation } from "wouter";
import { Room, WsMessage, WsMessageType, Message, User, MessageType } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import useWebSocketWithFallback from "@/hooks/useWebSocketWithFallback";
import { formatDistanceToNow, format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { X, Users, Clock, Paperclip, Image, File, Video, Send as SendIcon, PhoneCall } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import VoiceCall from "@/components/VoiceCall";

interface ChatInterfaceProps {
  room: Room;
  nickname: string;
}

export default function ChatInterface({ room, nickname }: ChatInterfaceProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [connected, setConnected] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isVoiceCallActive, setIsVoiceCallActive] = useState(false);
  const [lastVoiceCallMessage, setLastVoiceCallMessage] = useState<WsMessage | null>(null);
  const [activeCallInfo, setActiveCallInfo] = useState<{
    isCallActive: boolean;
    participants: string[];
    initiatedBy: string;
    startTime?: Date;
  }>({
    isCallActive: false,
    participants: [],
    initiatedBy: ''
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageContainerRef = useRef<HTMLDivElement>(null);

  // Calculate expiration time display
  const expiresAt = new Date(room.expiresAt);
  const expiresText = formatDistanceToNow(expiresAt, { addSuffix: true });

  // WebSocket connection with fallback handling
  const { sendMessage, connectionStatus, reconnect, fallbackMode, joinRoom, ws, connectionId } = useWebSocketWithFallback({
    reconnectAttempts: 10, // Increased attempts
    reconnectInterval: 2000, // Faster reconnect
    onOpen: () => {
      console.log("Connection opened in ChatInterface, fallback mode:", fallbackMode);
      setConnected(true);
      
      // Join the room (only through WebSocket - HTTP joinRoom is handled separately)
      if (!fallbackMode) {
        setTimeout(() => {
          sendMessage({
            type: WsMessageType.JOIN,
            payload: { roomId: room.id, username: nickname }
          });
        }, 50); // Small delay to ensure connection is stable
      }
    },
    onMessage: (event: any) => {
      try {
        let data: WsMessage;
        
        if (event.parsedData) {
          // Using the pre-parsed data from HTTP fallback
          data = event.parsedData;
        } else if (event.data) {
          // Standard WebSocket message
          data = JSON.parse(event.data);
        } else {
          console.error("Unknown message format:", event);
          return;
        }
        
        console.log("Received message type:", data.type);
        
        switch (data.type) {
          case WsMessageType.CHAT_MESSAGE:
            setMessages(prev => [...prev, data.payload as Message]);
            break;
          
          case WsMessageType.IMAGE_MESSAGE:
          case WsMessageType.DOCUMENT_MESSAGE:
          case WsMessageType.FILE_MESSAGE:
            setMessages(prev => [...prev, data.payload as Message]);
            break;
            
          case WsMessageType.USER_LIST:
            setUsers(data.payload.users);
            break;
            
          case WsMessageType.JOIN:
            // Only show system message for other users joining
            if (data.payload.username !== nickname) {
              toast({
                title: "User Joined",
                description: `${data.payload.username} joined the chat`,
              });
              // Update users list if needed
              setUsers(prev => {
                const userExists = prev.some(u => u.username === data.payload.username);
                if (!userExists && data.payload.userId) {
                  return [...prev, { 
                    id: Number(data.payload.userId), 
                    username: data.payload.username, 
                    roomId: room.id,
                    connected: true,
                    connectionId: '',
                    lastActivity: new Date()
                  }];
                }
                return prev;
              });
            }
            break;
            
          case WsMessageType.LEAVE:
            toast({
              title: "User Left",
              description: `${data.payload.username} left the chat`,
            });
            // Update users list
            setUsers(prev => prev.filter(u => u.id !== data.payload.userId));
            break;
            
          case WsMessageType.ROOM_CLOSED:
            toast({
              title: "Room Closed",
              description: "This chat room has been closed.",
              variant: "destructive",
            });
            navigate("/");
            break;
            
          case WsMessageType.ERROR:
            toast({
              title: "Error",
              description: data.payload.message,
              variant: "destructive",
            });
            break;
            
          // Video call signaling messages
          case WsMessageType.VIDEO_CALL_START:
          case WsMessageType.VIDEO_CALL_ANSWER:
          case WsMessageType.VIDEO_CALL_ICE:
          case WsMessageType.VIDEO_CALL_HANGUP:
            // Process in voice call component
            console.log("Received voice call signal:", data.type);
            handleVoiceCallMessage(data);
            break;
        }
      } catch (error) {
        console.error("Failed to parse message:", error, event);
      }
    },
    onClose: (event: any) => {
      console.log("Connection closed in ChatInterface:", event);
      setConnected(false);
      
      toast({
        title: "Disconnected",
        description: "You've been disconnected from the chat. Attempting to reconnect...",
        variant: "destructive",
      });
    },
    onError: (event: any) => {
      console.error("Connection error in ChatInterface:", event);
      toast({
        title: "Connection Error",
        description: "Failed to establish a connection to the chat server.",
        variant: "destructive",
      });
    }
  });
  
  // Connection status effect
  useEffect(() => {
    if (connectionStatus === "open") {
      setConnected(true);
      
      // If we're in fallback mode and just connected, join the room
      if (fallbackMode) {
        console.log("Joining room via HTTP fallback...");
        joinRoom(room.id, nickname)
          .then(result => {
            if (result) {
              console.log("Joined room via HTTP fallback:", result);
              
              // Set initial data from join response
              if (result.users) {
                setUsers(result.users);
              }
              
              if (result.messages) {
                setMessages(result.messages);
              }
            }
          })
          .catch(error => {
            console.error("Failed to join room via HTTP fallback:", error);
            toast({
              title: "Join Error",
              description: "Failed to join the chat room. Please try again.",
              variant: "destructive",
            });
          });
      }
    } else if (connectionStatus === "closed" || connectionStatus === "closing") {
      setConnected(false);
    }
    
    console.log("Connection status:", connectionStatus, "Fallback mode:", fallbackMode);
  }, [connectionStatus, fallbackMode, room.id, nickname, joinRoom, toast]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messageContainerRef.current) {
      messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle file upload
  const handleFileUpload = async (file: File) => {
    if (!connected || !file) return;
    
    try {
      setIsUploading(true);
      
      // Create form data for the file upload
      const formData = new FormData();
      formData.append('file', file);
      
      // Get connection ID - either from WebSocket connection or from localStorage if in fallback mode
      const uploadConnectionId = fallbackMode 
        ? localStorage.getItem('connectionId') || '' 
        : connectionId || '';
      
      console.log('Uploading with connectionId:', uploadConnectionId, 'roomId:', room.id);
      
      // Ensure connectionId is a string and not null
      formData.append('connectionId', uploadConnectionId || '');
      formData.append('roomId', room.id);
      
      // Upload the file
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Failed to upload file');
      }
      
      const result = await response.json();
      
      // If we're in WebSocket mode, the server will broadcast the message
      // If we're in HTTP fallback mode, we need to send a message
      if (fallbackMode) {
        // Send message via HTTP fallback based on file type
        let messageType: WsMessageType;
        
        if (file.type.startsWith('image/')) {
          messageType = WsMessageType.IMAGE_MESSAGE;
        } else if (
          file.type === 'application/pdf' || 
          file.type === 'application/msword' ||
          file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          file.type === 'text/plain'
        ) {
          messageType = WsMessageType.DOCUMENT_MESSAGE;
        } else {
          messageType = WsMessageType.FILE_MESSAGE;
        }
        
        sendMessage({
          type: messageType,
          payload: { 
            fileUrl: result.fileUrl,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type
          }
        });
      }
      
      toast({
        title: "File uploaded",
        description: "Your file has been sent",
      });
    } catch (error) {
      console.error('Error uploading file:', error);
      toast({
        title: "Upload failed",
        description: "Failed to upload file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };
  
  // Handle file input change
  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };
  
  // Trigger file selection
  const handleAttachClick = (type: 'document' | 'image') => {
    if (!connected) return;
    
    // Set accepted file types
    if (fileInputRef.current) {
      if (type === 'image') {
        fileInputRef.current.accept = 'image/*';
      } else {
        fileInputRef.current.accept = '.pdf,.doc,.docx,.txt,.xls,.xlsx';
      }
      
      fileInputRef.current.click();
    }
  };

  // Handle send message
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!message.trim()) return;
    
    sendMessage({
      type: WsMessageType.CHAT_MESSAGE,
      payload: { content: message.trim() }
    });
    
    setMessage("");
  };

  // Handle closing room
  const handleCloseRoom = async () => {
    try {
      await apiRequest("POST", `/api/rooms/${room.id}/close`, {});
      toast({
        title: "Room Closed",
        description: "The chat room has been closed."
      });
      navigate("/");
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to close the room. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Create avatar initials
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Generate random color for avatar based on username
  const getUserColor = (username: string) => {
    const colors = [
      "bg-accent-light", 
      "bg-secondary", 
      "bg-success", 
      "bg-primary-light", 
      "bg-warning"
    ];
    
    const index = username
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    
    return colors[index];
  };

  // This state was moved to the top of the component
  
  // Handle voice call message
  const handleVoiceCallMessage = (data: WsMessage) => {
    console.log("Voice call message received:", data.type);
    
    // Update active call info based on message type
    switch (data.type) {
      case WsMessageType.VIDEO_CALL_START:
        // Update call status - call is now active
        setActiveCallInfo(prev => {
          // If joining flag is set, this is someone trying to join an existing call
          // In this case, don't reset the startTime
          if (data.payload?.joining) {
            return {
              ...prev,
              isCallActive: true
            };
          }
          
          // For new calls, set new start time and participants
          return {
            isCallActive: true,
            participants: [data.payload?.caller || '', ...(prev.isCallActive ? prev.participants : [])].filter((p, i, arr) => arr.indexOf(p) === i), // Ensure unique values
            initiatedBy: data.payload?.caller || '',
            startTime: prev.startTime || new Date()
          };
        });
        
        // Add the caller as participant if not already present
        if (data.payload?.caller) {
          setActiveCallInfo(prev => {
            const caller = data.payload?.caller || '';
            if (!prev.participants.includes(caller)) {
              return {
                ...prev,
                participants: [...prev.participants, caller].filter((p, i, arr) => arr.indexOf(p) === i)
              };
            }
            return prev;
          });
        }
        
        // If we're not already in the call UI, show incoming call notification
        if (!isVoiceCallActive && data.payload?.caller !== nickname) {
          // Notify the user about incoming call
          toast({
            title: "Incoming Voice Call",
            description: `${data.payload?.caller || 'Someone'} is calling you`,
          });
          
          // Auto-show voice call UI
          setIsVoiceCallActive(true);
        }
        break;
        
      case WsMessageType.VIDEO_CALL_ANSWER:
        // Call was answered, add answerer to participants if not already there
        setActiveCallInfo(prev => {
          const answerer = data.payload?.answerer || '';
          if (!prev.participants.includes(answerer)) {
            return {
              ...prev,
              participants: [...prev.participants, answerer].filter((p, i, arr) => arr.indexOf(p) === i)
            };
          }
          return prev;
        });
        break;
        
      case WsMessageType.VIDEO_CALL_HANGUP:
        // User leaving doesn't necessarily end the call for everyone
        const sender = data.payload?.from || '';
        
        setActiveCallInfo(prev => {
          // Only update if we had an active call to begin with
          if (!prev.isCallActive) {
            return prev;
          }
          
          // Remove the participant who hung up
          const updatedParticipants = prev.participants.filter(p => p !== sender);
          
          // Keep call active if there's at least one other participant still in the call
          const hasActiveParticipants = updatedParticipants.length > 0;
          
          if (!hasActiveParticipants) {
            // No one left in the call, mark it as inactive
            return {
              isCallActive: false,
              participants: [],
              initiatedBy: '',
              startTime: undefined
            };
          }
          
          // Otherwise, update participants but keep call active
          return {
            ...prev,
            participants: updatedParticipants
          };
        });
        
        // If we're in the voice call UI and all other participants left, ask if we want to stay
        if (isVoiceCallActive && data.payload?.from !== nickname) {
          setActiveCallInfo(prev => {
            const otherParticipants = prev.participants.filter(p => p !== nickname);
            if (otherParticipants.length === 0) {
              toast({
                title: "Call Update",
                description: "All other participants have left the call.",
              });
            }
            return prev;
          });
        }
        break;
    }
    
    // Store the last voice call message for the VoiceCall component to process
    setLastVoiceCallMessage(data);
  };

  return (
    <div className="bg-gradient-to-b from-background to-muted rounded-lg shadow-lg overflow-hidden h-screen flex flex-col">
      {/* Voice Call Overlay */}
      {isVoiceCallActive && (
        <VoiceCall
          roomId={room.id}
          nickname={nickname}
          sendMessage={sendMessage}
          onClose={() => setIsVoiceCallActive(false)}
          connectionStatus={connectionStatus}
          lastVoiceCallMessage={lastVoiceCallMessage}
          activeCallInfo={activeCallInfo}
        />
      )}
      {/* Header */}
      <div className="bg-primary text-white p-4 flex justify-between items-center">
        <div>
          <h2 className="font-bold text-lg">{room.name}</h2>
          <p className="text-xs opacity-90">Room Code: {room.id}</p>
        </div>
        <div className="flex items-center space-x-3">
          {connected && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-auto py-1 px-2 text-white border-white hover:bg-primary-dark flex items-center"
              onClick={() => setIsVoiceCallActive(true)}
              disabled={isVoiceCallActive}
            >
              <PhoneCall className="h-3 w-3 mr-1" />
              Voice Call
            </Button>
          )}
          <div className="flex items-center">
            <div className={`w-2 h-2 rounded-full mr-1 ${connected ? 'bg-emerald-400' : 'bg-rose-500'}`}></div>
            <span className="text-xs">{users.length} online</span>
          </div>
          {fallbackMode && (
            <div className="text-xs bg-violet-700 text-white px-2 py-1 rounded-full">
              Fallback
            </div>
          )}
          <div className="text-xs bg-amber-600 text-white px-2 py-1 rounded-full flex items-center">
            <Clock className="h-3 w-3 mr-1" />
            Expires {expiresText}
          </div>
          {connectionStatus === 'closed' && (
            <Button 
              variant="outline" 
              size="sm"
              className="text-xs h-auto py-1 px-2 text-white border-white hover:bg-primary-dark"
              onClick={reconnect}
            >
              Reconnect
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            className="text-white hover:text-neutral transition-colors"
            onClick={handleCloseRoom}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>
      
      {/* Messages */}
      <div 
        ref={messageContainerRef}
        className="h-[calc(100vh-144px)] overflow-y-auto p-4 bg-muted/50"
      >
        {messages.map((msg, index) => {
          const isCurrentUser = msg.username === nickname;
          
          return (
            <div key={index} className={`chat-message mb-4 ${isCurrentUser ? 'flex justify-end' : ''}`}>
              {isCurrentUser ? (
                // Outgoing message (right side)
                <div className="max-w-[80%]">
                  <div className="flex items-center justify-end mb-1">
                    <span className="text-xs text-muted-foreground mr-2">
                      {format(msg.timestamp ? new Date(msg.timestamp) : new Date(), 'h:mm a')}
                    </span>
                    <span className="font-semibold text-primary">You</span>
                  </div>
                  <div className="bg-primary text-white p-3 rounded-lg rounded-tr-none shadow-md relative">
                    {msg.messageType === 'image' && msg.fileUrl ? (
                      <div className="mb-2">
                        <img 
                          src={msg.fileUrl || ''} 
                          alt={msg.fileName || 'Image'} 
                          className="rounded max-w-full max-h-64 cursor-pointer" 
                          onClick={() => window.open(msg.fileUrl || '', '_blank')}
                        />
                        <p className="mt-1 text-sm">{msg.content}</p>
                      </div>
                    ) : msg.messageType === 'document' && msg.fileUrl ? (
                      <div className="flex flex-col">
                        <a 
                          href={msg.fileUrl || ''} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center p-2 bg-primary-dark rounded mb-1 hover:bg-primary-light/80 transition-colors"
                        >
                          <File className="w-5 h-5 mr-2" />
                          <span className="text-sm truncate max-w-[200px]">{msg.fileName}</span>
                        </a>
                        <p className="text-sm">{msg.content}</p>
                      </div>
                    ) : (
                      <p>{msg.content}</p>
                    )}
                    <div className="absolute top-0 right-0 w-3 h-3 bg-primary rounded-bl-full transform translate-x-[-2px] translate-y-[-1px]"></div>
                  </div>
                </div>
              ) : (
                // Incoming message (left side)
                <div className="flex items-start max-w-[80%]">
                  <div className="flex-shrink-0 mr-3">
                    <Avatar className={`w-8 h-8 ${getUserColor(msg.username)}`}>
                      <AvatarFallback className="text-white font-medium text-sm">
                        {getInitials(msg.username)}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <div>
                    <div className="flex items-center mb-1">
                      <span className="font-semibold mr-2 text-foreground">{msg.username}</span>
                      <span className="text-xs text-muted-foreground">
                        {format(msg.timestamp ? new Date(msg.timestamp) : new Date(), 'h:mm a')}
                      </span>
                    </div>
                    <div className="bg-card p-3 rounded-lg rounded-tl-none shadow-md border border-muted relative">
                      {msg.messageType === 'image' && msg.fileUrl ? (
                        <div className="mb-2">
                          <img 
                            src={msg.fileUrl || ''} 
                            alt={msg.fileName || 'Image'} 
                            className="rounded max-w-full max-h-64 cursor-pointer" 
                            onClick={() => window.open(msg.fileUrl || '', '_blank')}
                          />
                          <p className="mt-1 text-sm text-foreground">{msg.content}</p>
                        </div>
                      ) : msg.messageType === 'document' && msg.fileUrl ? (
                        <div className="flex flex-col">
                          <a 
                            href={msg.fileUrl || ''} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center p-2 bg-muted rounded mb-1 hover:bg-muted/80 transition-colors"
                          >
                            <File className="w-5 h-5 mr-2" />
                            <span className="text-sm truncate max-w-[200px]">{msg.fileName}</span>
                          </a>
                          <p className="text-sm text-foreground">{msg.content}</p>
                        </div>
                      ) : (
                        <p className="text-foreground">{msg.content}</p>
                      )}
                      <div className="absolute top-0 left-0 w-3 h-3 bg-card border-l border-t border-muted rounded-br-full transform translate-x-[-5px] translate-y-[-1px]"></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        
        {messages.length === 0 && (
          <div className="flex justify-center items-center h-full text-muted-foreground">
            <div className="text-center">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No messages yet.</p>
              <p className="text-sm">Be the first to send a message!</p>
            </div>
          </div>
        )}
        
        {/* Ongoing call notification */}
        {activeCallInfo.isCallActive && !isVoiceCallActive && (
          <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-primary text-white px-4 py-3 rounded-lg shadow-lg z-10 flex items-center gap-3">
            <div className="flex-shrink-0">
              <div className="relative">
                <div className="w-10 h-10 bg-primary-light rounded-full flex items-center justify-center">
                  <PhoneCall className="h-5 w-5 text-white" />
                </div>
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-pulse"></span>
              </div>
            </div>
            <div>
              <p className="font-medium">Active voice call</p>
              <p className="text-xs opacity-90">
                {activeCallInfo.participants.filter(p => p !== nickname).join(', ')} {activeCallInfo.participants.length > 2 ? 'are' : 'is'} in the call
              </p>
            </div>
            <Button 
              size="sm" 
              variant="secondary" 
              className="ml-2 bg-white text-primary hover:bg-gray-100"
              onClick={() => setIsVoiceCallActive(true)}
            >
              Join Call
            </Button>
          </div>
        )}
      </div>
      
      {/* Input area */}
      <div className="p-4 border-t border-muted/70 bg-card">
        {/* Hidden file input */}
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileInputChange}
        />
        
        <div className="flex items-center mb-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                className="text-xs mr-2 flex items-center"
                disabled={!connected || isUploading}
              >
                <Paperclip className="h-4 w-4 mr-1" />
                Attach
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2">
              <div className="flex flex-col space-y-1">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="justify-start"
                  onClick={() => handleAttachClick('image')}
                  disabled={isUploading}
                >
                  <Image className="h-4 w-4 mr-2" />
                  <span>Image</span>
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="justify-start"
                  onClick={() => handleAttachClick('document')}
                  disabled={isUploading}
                >
                  <File className="h-4 w-4 mr-2" />
                  <span>Document</span>
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          
          {isUploading && (
            <div className="text-xs text-muted-foreground animate-pulse">
              Uploading file...
            </div>
          )}
        </div>
        
        <form className="flex items-center" onSubmit={handleSendMessage}>
          <Input
            type="text"
            placeholder="Type your message here..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="flex-grow px-4 py-2 border-0 bg-muted/50 focus:ring-2 focus:ring-primary/70 rounded-l-md"
            disabled={!connected || isUploading}
          />
          <Button 
            type="submit" 
            className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-r-md"
            disabled={!connected || !message.trim() || isUploading}
          >
            <SendIcon className="h-5 w-5" />
          </Button>
        </form>
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>Press Enter to send</span>
          <span>Messages will expire with the room</span>
        </div>
      </div>
    </div>
  );
}
