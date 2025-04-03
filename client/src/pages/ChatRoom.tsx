import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Room } from "@shared/schema";
import ChatInterface from "@/components/ChatInterface";
import Sidebar from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, ArrowLeft } from "lucide-react";

export default function ChatRoom() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [nickname, setNickname] = useState<string>(() => {
    return localStorage.getItem("chatvault-nickname") || "";
  });
  const [joinSubmitted, setJoinSubmitted] = useState<boolean>(false);

  // Fetch room data
  const { data: roomData, isLoading, error } = useQuery<{ room: Room }>({
    queryKey: [`/api/rooms/${id}`],
    retry: false,
  });

  const handleSetNickname = (name: string) => {
    setNickname(name);
    localStorage.setItem("chatvault-nickname", name);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname) {
      toast({
        title: "Nickname Required",
        description: "Please enter a nickname to join the chat room.",
        variant: "destructive",
      });
      return;
    }
    setJoinSubmitted(true);
  };

  // Handle errors
  useEffect(() => {
    if (error) {
      toast({
        title: "Room Error",
        description: "This chat room doesn't exist or has expired.",
        variant: "destructive",
      });
      setTimeout(() => setLocation("/"), 3000);
    }
  }, [error, setLocation, toast]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral">
        <div className="text-center">
          <div className="loader h-12 w-12 rounded-full border-4 border-neutral-dark inline-block mb-4"></div>
          <h2 className="text-lg font-medium text-secondary">Loading chat room...</h2>
          <p className="text-neutral-darker">This will only take a moment</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (error || !roomData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertCircle className="h-8 w-8 text-error" />
              <h1 className="text-2xl font-bold text-gray-900">Chat Room Not Found</h1>
            </div>
            <p className="mt-4 text-sm text-gray-600">
              This chat room doesn't exist or has expired.
            </p>
            <Button className="mt-4 w-full" onClick={() => setLocation("/")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show join form if not submitted
  if (!joinSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <h1 className="text-2xl font-bold text-primary mb-4">Join Chat Room</h1>
            <p className="mb-4 text-secondary">
              You are joining <strong>{roomData.room.name}</strong>
            </p>
            
            <form onSubmit={handleJoinRoom}>
              <div className="mb-4">
                <label htmlFor="nickname" className="block text-sm font-medium text-secondary mb-1">
                  Your Display Name
                </label>
                <Input
                  id="nickname"
                  value={nickname}
                  onChange={(e) => handleSetNickname(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-dark rounded-md"
                  placeholder="Enter a nickname"
                  required
                />
              </div>
              
              <Button type="submit" className="w-full bg-accent hover:bg-accent-dark text-white">
                Join Chat
              </Button>
              
              <Button 
                variant="outline" 
                className="w-full mt-2" 
                onClick={() => setLocation("/")}
              >
                Cancel
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show chat interface
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-neutral font-primary text-primary">
      <Sidebar activeItem="chat-rooms" />
      <main className="flex-grow">
        <ChatInterface 
          room={roomData.room}
          nickname={nickname}
        />
      </main>
    </div>
  );
}
